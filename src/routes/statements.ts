/**
 * xAPI Statements Resource
 * POST/PUT/GET /xapi/statements
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoEnv } from '../hono-env.ts';
import { HttpError, withClient } from '../db.ts';
import {
  insertStatement,
  insertStatements,
  getStatementById,
  queryStatements,
  getConsistentThrough,
} from '../repositories/statements.ts';
import { insertAttachment } from '../repositories/attachments.ts';
import { canonicalAgentIfi, validateSince, validateRegistration } from '../helpers/agent.ts';
import { agentFromAuth, hasOnlyMineScope } from '../helpers/auth-agent.ts';
import { enrichStatement, formatStatement } from '../helpers/enrichment.ts';
import { validateStatement } from '../xapi/statement-validator.ts';
import { statementsMatch } from '../xapi/statement-compare.ts';
import { buildMultipartResponse } from '../xapi/multipart.ts';
import {
  postStatementsRoute,
  putStatementRoute,
  getStatementsRoute,
  STATEMENTS_KNOWN_PARAMS,
  handleVoiding,
  validateAttachmentParts,
  authorityFromAuth,
  assertStatementBelongsToAgent,
  collectAttachmentParts,
  collectAttachmentPartsFromList,
  VOIDED_VERB_ID,
} from './statement-helpers.ts';

// ============================================================================
// Route app
// ============================================================================

export function createStatementsApp() {
  const app = new OpenAPIHono<HonoEnv>();

  // POST /xapi/statements
  app.openapi(postStatementsRoute, async (c) => {
    const deps = c.var.deps;
    const auth = c.var.auth;
    const { pool, metrics } = deps;

    const rawBody = c.var.parsedBody as unknown;
    const rawArray = Array.isArray(rawBody) ? rawBody : [rawBody];
    const attachmentParts = c.var.attachmentParts;

    // Validate ALL statements first (batch atomicity)
    const validated: Record<string, unknown>[] = [];
    for (const raw of rawArray) {
      const result = validateStatement(raw);
      if (!result.valid) {
        throw new HttpError(400, result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      }
      validated.push(result.statement as unknown as Record<string, unknown>);
    }

    // Validate multipart attachment data
    if (attachmentParts) {
      await validateAttachmentParts(validated, attachmentParts, deps);
    }

    const authority = authorityFromAuth(auth);

    const ids = await withClient(pool, metrics, async (client) => {
      for (const stmt of validated) {
        const verbId = (stmt.verb as Record<string, unknown>)?.id as string | undefined;
        if (verbId === VOIDED_VERB_ID) {
          await handleVoiding(client, stmt);
        }
      }

      metrics.statementsReceived.add(validated.length, { method: 'POST' });
      const results = await insertStatements(client, validated, authority);

      for (let i = 0; i < results.length; i++) {
        if (!results[i].inserted) {
          const existing = await getStatementById(client, validated[i].id as string);
          if (existing && !statementsMatch(existing.payload, validated[i])) {
            throw new HttpError(409, 'Statement already exists with different content');
          }
        }
      }

      if (attachmentParts) {
        for (const stmt of validated) {
          const stmtId = stmt.id as string;
          const atts = stmt.attachments as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(atts)) continue;
          for (const att of atts) {
            const sha2 = att.sha2 as string;
            const part = attachmentParts.get(sha2);
            if (part) {
              await insertAttachment(client, {
                statementId: stmtId,
                sha2,
                contentType: part.contentType,
                data: part.data,
              });
            }
          }
        }
      }

      return validated.map((s) => s.id as string);
    });

    return c.json(ids, 200);
  });

  // PUT /xapi/statements
  app.openapi(putStatementRoute, async (c) => {
    const deps = c.var.deps;
    const auth = c.var.auth;
    const { pool, metrics } = deps;
    const statementId = c.req.query('statementId')!;
    const attachmentParts = c.var.attachmentParts;

    const raw = (c.var.parsedBody ?? {}) as Record<string, unknown>;
    if (!raw.id) raw.id = statementId;

    const validationResult = validateStatement(raw);
    if (!validationResult.valid) {
      throw new HttpError(400, validationResult.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    }
    const stmt = validationResult.statement as unknown as Record<string, unknown>;

    if (attachmentParts) {
      await validateAttachmentParts([stmt], attachmentParts, deps);
    }

    if (stmt.id !== statementId) {
      throw new HttpError(409, 'Statement id does not match statementId parameter');
    }

    const verbId = (stmt.verb as Record<string, unknown>)?.id as string | undefined;
    const authority = authorityFromAuth(auth);

    await withClient(pool, metrics, async (client) => {
      metrics.statementsReceived.add(1, { method: 'PUT' });

      const existing = await getStatementById(client, statementId);
      if (existing) {
        if (!statementsMatch(existing.payload, stmt)) {
          throw new HttpError(409, 'Statement already exists with different content');
        }
        return;
      }

      if (verbId === VOIDED_VERB_ID) {
        await handleVoiding(client, stmt);
      }

      await insertStatement(client, stmt, authority);

      if (attachmentParts) {
        const atts = stmt.attachments as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(atts)) {
          for (const att of atts) {
            const sha2 = att.sha2 as string;
            const part = attachmentParts.get(sha2);
            if (part) {
              await insertAttachment(client, {
                statementId,
                sha2,
                contentType: part.contentType,
                data: part.data,
              });
            }
          }
        }
      }
    });

    return c.body(null, 204);
  });

  // Middleware: set X-Experience-API-Consistent-Through on ALL GET /statements responses
  // (including errors). Must run before the route handler so it applies to error responses.
  app.use('/statements', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    const { pool, metrics } = c.var.deps;
    const consistentThrough = await withClient(pool, metrics, (client) => getConsistentThrough(client));
    await next();
    c.res.headers.set('X-Experience-API-Consistent-Through', consistentThrough);
  });

  // GET /xapi/statements
  app.openapi(getStatementsRoute, async (c) => {
    const deps = c.var.deps;
    const { pool, metrics } = deps;

    const statementId = c.req.query('statementId');
    const voidedStatementId = c.req.query('voidedStatementId');
    const agent = c.req.query('agent');
    const verb = c.req.query('verb');
    const activity = c.req.query('activity');
    const registration = c.req.query('registration');
    const related_activities = c.req.query('related_activities') === 'true';
    const related_agents = c.req.query('related_agents') === 'true';
    const format = c.req.query('format');
    const since = c.req.query('since');
    const until = c.req.query('until');
    const limitStr = c.req.query('limit');
    const limit = limitStr ? Number(limitStr) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      throw new HttpError(400, 'limit must be a positive integer');
    }
    const ascending = c.req.query('ascending') === 'true';
    const attachments = c.req.query('attachments') === 'true';

    // Reject unknown query params
    const url = new URL(c.req.url);
    for (const key of url.searchParams.keys()) {
      if (!STATEMENTS_KNOWN_PARAMS.has(key)) {
        throw new HttpError(400, `Unknown query parameter: ${key}`);
      }
    }

    validateSince(since);
    validateSince(until);
    validateRegistration(registration);
    if (agent) canonicalAgentIfi(agent);

    if (statementId && voidedStatementId) {
      throw new HttpError(400, 'Cannot use both statementId and voidedStatementId');
    }

    // Enforce statements/read/mine: restrict to authenticated agent's own statements
    const auth = c.var.auth;
    const mineOnly = hasOnlyMineScope(auth.payload.scopes);
    let effectiveAgent = agent;
    let effectiveRelatedAgents = related_agents;
    if (mineOnly && !statementId && !voidedStatementId) {
      effectiveAgent = JSON.stringify(agentFromAuth(auth));
      effectiveRelatedAgents = true;
    }

    const effectiveFormat = format ?? 'exact';
    if (effectiveFormat !== 'exact' && effectiveFormat !== 'ids' && effectiveFormat !== 'canonical') {
      throw new HttpError(400, 'format must be one of: ids, exact, canonical');
    }

    if (statementId || voidedStatementId) {
      if (
        agent !== undefined ||
        verb !== undefined ||
        activity !== undefined ||
        registration !== undefined ||
        c.req.query('related_activities') !== undefined ||
        c.req.query('related_agents') !== undefined ||
        since !== undefined ||
        until !== undefined ||
        limitStr !== undefined ||
        c.req.query('ascending') !== undefined
      ) {
        throw new HttpError(400, 'Cannot combine statementId or voidedStatementId with other filter parameters');
      }
    }

    const acceptLanguage = c.req.header('accept-language');

    return withClient(pool, metrics, async (client) => {
      const singleId = statementId ?? voidedStatementId;
      if (singleId) {
        const wantVoided = !!voidedStatementId;
        const row = await getStatementById(client, singleId);
        if (!row || row.is_voided !== wantVoided) {
          throw new HttpError(404, wantVoided ? 'Voided statement not found' : 'Statement not found');
        }
        if (mineOnly) {
          assertStatementBelongsToAgent(row.payload, auth);
        }
        const stmt = formatStatement(enrichStatement(row), effectiveFormat, acceptLanguage);
        if (attachments) {
          const parts = await collectAttachmentParts(client, stmt);
          return buildMultipartResponse(stmt, parts);
        }
        return c.json(stmt, 200);
      }

      const { rows, hasMore } = await queryStatements(client, {
        agent: effectiveAgent,
        verb,
        activity,
        registration,
        related_activities,
        related_agents: effectiveRelatedAgents,
        since,
        until,
        limit,
        ascending,
      });

      const statements = rows.map((row) => formatStatement(enrichStatement(row), effectiveFormat, acceptLanguage));
      const result: { statements: unknown[]; more: string } = { statements, more: '' };

      if (hasMore) {
        const lastRow = rows.at(-1)!;
        const moreParams = new URLSearchParams();
        if (agent) moreParams.set('agent', agent);
        if (verb) moreParams.set('verb', verb);
        if (activity) moreParams.set('activity', activity);
        if (registration) moreParams.set('registration', registration);
        if (related_activities) moreParams.set('related_activities', 'true');
        if (related_agents) moreParams.set('related_agents', 'true');
        if (limit) moreParams.set('limit', limit.toString());
        if (effectiveFormat !== 'exact') moreParams.set('format', effectiveFormat);

        const lastStored = lastRow.payload.stored as string;
        if (ascending) {
          moreParams.set('ascending', 'true');
          moreParams.set('since', lastStored);
          if (until) moreParams.set('until', until);
        } else {
          moreParams.set('until', lastStored);
          if (since) moreParams.set('since', since);
        }

        result.more = `/xapi/statements?${moreParams.toString()}`;
      }

      if (attachments) {
        const parts = await collectAttachmentPartsFromList(client, statements);
        return buildMultipartResponse(result, parts);
      }

      return c.json(result, 200);
    });
  });

  return app;
}
