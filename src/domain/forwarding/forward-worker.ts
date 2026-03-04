import type pg from 'pg';
import type { Logger } from 'pino';
import type { PgNotifyListener } from '../../core/pg-notify.js';
import type { AppMetrics } from '../../core/metrics.js';

export interface ForwardTarget {
  tenant_id: string;
  url: string;
  auth_header: string;
  enabled: boolean;
  last_forwarded_stored: Date | null;
}

interface BufferedNotification {
  tenant_id: string;
  id: string;
}

const BATCH_WINDOW_MS = 500;
const CATCHUP_BATCH_SIZE = 200;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1_000;

export class ForwardWorker {
  private targets = new Map<string, ForwardTarget>();
  private notifyHandler: ((payload: string) => void) | null = null;
  private buffer: BufferedNotification[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly notifyListener: PgNotifyListener,
    private readonly logger: Logger,
    private readonly metrics?: AppMetrics,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.loadTargets();

    // Catch-up each enabled target from its watermark
    for (const target of this.targets.values()) {
      if (target.enabled) {
        await this.catchUp(target);
      }
    }

    // Subscribe to live notifications
    this.notifyHandler = (payload: string) => {
      this.handleNotification(payload);
    };
    this.notifyListener.on('xapi_statements_new', this.notifyHandler);
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Unsubscribe from notifications
    if (this.notifyHandler) {
      this.notifyListener.off('xapi_statements_new', this.notifyHandler);
      this.notifyHandler = null;
    }

    // Clear batch timer and flush remaining
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }
  }

  async reloadTargets(): Promise<void> {
    await this.loadTargets();

    // Catch-up newly enabled targets
    for (const target of this.targets.values()) {
      if (target.enabled) {
        await this.catchUp(target);
      }
    }
  }

  private async loadTargets(): Promise<void> {
    const { rows } = await this.pool.query<ForwardTarget>(
      `SELECT tenant_id, url, auth_header, enabled, last_forwarded_stored
       FROM tenant.forward_targets
       WHERE enabled = TRUE`,
    );
    this.targets.clear();
    for (const row of rows) {
      this.targets.set(row.tenant_id, row);
    }
    this.logger.info({ count: this.targets.size }, 'Loaded forward targets');
  }

  private async catchUp(target: ForwardTarget): Promise<void> {
    let watermark = target.last_forwarded_stored;
    let batch: { id: string; raw: unknown; stored: Date }[];

    do {
      const params: unknown[] = [target.tenant_id, CATCHUP_BATCH_SIZE];
      let query: string;

      if (watermark) {
        query = `SELECT id, raw, stored FROM xapi.statements
                 WHERE tenant_id = $1 AND stored > $3 AND voided = FALSE
                 ORDER BY stored ASC, id ASC LIMIT $2`;
        params.push(watermark);
      } else {
        query = `SELECT id, raw, stored FROM xapi.statements
                 WHERE tenant_id = $1 AND voided = FALSE
                 ORDER BY stored ASC, id ASC LIMIT $2`;
      }

      const { rows } = await this.pool.query(query, params);
      batch = rows as typeof batch;

      if (batch.length === 0) break;

      const statements = batch.map((row) => prepareStatement(row.raw));
      const success = await this.postStatements(target, statements);

      if (!success) {
        this.logger.warn({ tenant_id: target.tenant_id }, 'Catch-up aborted due to forwarding failure');
        break;
      }

      watermark = batch[batch.length - 1]!.stored;
      target.last_forwarded_stored = watermark;
      await this.updateWatermark(target.tenant_id, watermark);
    } while (batch.length === CATCHUP_BATCH_SIZE);
  }

  private handleNotification(payload: string): void {
    if (this.stopped) return;

    let parsed: { tenant_id: string; id: string };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }

    // Only buffer if tenant has an enabled target
    if (!this.targets.has(parsed.tenant_id)) return;

    this.buffer.push({ tenant_id: parsed.tenant_id, id: parsed.id });

    // Start batch window if not already running
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushBuffer().catch((err) => {
          this.logger.error({ err }, 'Error flushing forward buffer');
        });
      }, BATCH_WINDOW_MS);
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Drain buffer and deduplicate by id
    const items = this.buffer.splice(0);
    const seen = new Set<string>();
    const unique: BufferedNotification[] = [];
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        unique.push(item);
      }
    }

    // Group by tenant
    const byTenant = new Map<string, string[]>();
    for (const item of unique) {
      let ids = byTenant.get(item.tenant_id);
      if (!ids) {
        ids = [];
        byTenant.set(item.tenant_id, ids);
      }
      ids.push(item.id);
    }

    for (const [tenantId, ids] of byTenant) {
      const target = this.targets.get(tenantId);
      if (!target || !target.enabled) continue;

      // Fetch full raw statements
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
      const { rows } = await this.pool.query(
        `SELECT id, raw, stored FROM xapi.statements
         WHERE tenant_id = $1 AND id IN (${placeholders})
         ORDER BY stored ASC`,
        [tenantId, ...ids],
      );

      if (rows.length === 0) continue;

      const statements = (rows as { id: string; raw: unknown; stored: Date }[]).map(
        (row) => prepareStatement(row.raw),
      );
      const success = await this.postStatements(target, statements);

      if (success) {
        const lastStored = (rows as { stored: Date }[])[rows.length - 1]!.stored;
        target.last_forwarded_stored = lastStored;
        await this.updateWatermark(tenantId, lastStored);
      }
    }
  }

  private async postStatements(
    target: ForwardTarget,
    statements: unknown[],
  ): Promise<boolean> {
    let delay = INITIAL_RETRY_DELAY_MS;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(target.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Experience-API-Version': '1.0.3',
            ...(target.auth_header ? { Authorization: target.auth_header } : {}),
          },
          body: JSON.stringify(statements),
        });

        if (res.ok) {
          const durationSec = (Date.now() - startTime) / 1000;
          this.metrics?.forwardBatchesTotal.inc({ tenant_id: target.tenant_id, status: 'success' });
          this.metrics?.forwardStatementsTotal.inc({ tenant_id: target.tenant_id }, statements.length);
          this.metrics?.forwardBatchDuration.observe({ tenant_id: target.tenant_id }, durationSec);
          await this.clearError(target.tenant_id);
          return true;
        }

        this.logger.warn(
          { tenant_id: target.tenant_id, status: res.status, attempt },
          'Forward POST failed',
        );
      } catch (err) {
        this.logger.warn(
          { tenant_id: target.tenant_id, err, attempt },
          'Forward POST error',
        );
      }

      if (attempt < MAX_RETRIES) {
        await sleep(delay);
        delay *= 2;
      }
    }

    // Max retries exhausted
    this.metrics?.forwardBatchesTotal.inc({ tenant_id: target.tenant_id, status: 'error' });
    this.metrics?.forwardErrorsTotal.inc({ tenant_id: target.tenant_id });
    await this.recordError(target.tenant_id, 'Max retries exhausted');
    return false;
  }

  private async updateWatermark(tenantId: string, stored: Date): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE tenant.forward_targets
         SET last_forwarded_stored = $2, error_count = 0, last_error = NULL, updated_at = NOW()
         WHERE tenant_id = $1`,
        [tenantId, stored],
      );
    } catch (err) {
      this.logger.error({ err, tenantId }, 'Failed to update watermark');
    }
  }

  private async clearError(tenantId: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE tenant.forward_targets
         SET last_error = NULL, error_count = 0, updated_at = NOW()
         WHERE tenant_id = $1`,
        [tenantId],
      );
    } catch (err) {
      this.logger.error({ err, tenantId }, 'Failed to clear error');
    }
  }

  private async recordError(tenantId: string, message: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE tenant.forward_targets
         SET last_error = $2, error_count = error_count + 1, updated_at = NOW()
         WHERE tenant_id = $1`,
        [tenantId, message],
      );
    } catch (err) {
      this.logger.error({ err, tenantId }, 'Failed to record error');
    }
  }
}

/** Strip `stored` and `authority` from a raw statement before forwarding. */
export function prepareStatement(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const stmt = { ...(raw as Record<string, unknown>) };
  delete stmt['stored'];
  delete stmt['authority'];
  return stmt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
