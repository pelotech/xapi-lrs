import type { Logger } from 'pino';
import type pg from 'pg';
import type { AppConfig } from './config.js';
import type { AppMetrics } from './metrics.js';
import type { JwtVerifier } from './jwt-verifier.js';
import type { AssetStore } from './asset-store.js';
import { createLogger } from './logger.js';
import { connectWithRetry } from './db.js';
import { createMetrics, registerPoolMetrics } from './metrics.js';
import { createLocalAssetStore } from './asset-store.js';
import { createJwtVerifier } from './jwt-verifier.js';
import { PgNotifyListener } from './pg-notify.js';
import type { ForwardWorker } from '../domain/forwarding/forward-worker.js';

/** A pool client with tenant RLS already scoped via transaction-local GUCs. */
export type ScopedClient = pg.PoolClient;

export interface AppContext {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly pool: pg.Pool;
  readonly metrics: AppMetrics;
  readonly jwtVerifier: JwtVerifier;
  readonly assetStore: AssetStore;
  readonly notifyListener: PgNotifyListener;
  forwardWorker?: ForwardWorker;
  isShuttingDown: boolean;
}

/**
 * Acquire a pool client, call `private.as_user_oidc(iss, aud, sub)` to
 * set `request.tenant.id`, then run `cb` inside a transaction. The client is
 * released (and the transaction rolled back on error) automatically.
 */
export async function asUserOidc<T>(
  pool: pg.Pool,
  iss: string,
  aud: string,
  sub: string,
  cb: (client: ScopedClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT private.as_user_oidc($1, $2, $3)`,
      [iss, aud, sub],
    );
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Acquire a pool client, call `private.as_user_xapi_basic_auth(key, secret)`
 * to set `request.tenant.id` and `request.jwt.claims.sub`, then run `cb`
 * inside a transaction. The client is released automatically.
 */
export async function asUserXapiBasicAuth<T>(
  pool: pg.Pool,
  key: string,
  secret: string,
  cb: (client: ScopedClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT private.as_user_xapi_basic_auth($1::UUID, $2)`,
      [key, secret],
    );
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Per-request context injected into controllers via TSOA IoC.
 *
 * Wraps AppContext with request-scoped concerns:
 * - `log`: a child logger tagged with the request id
 * - `pool`: direct pool access for unauthenticated queries
 * - `asUser`: a closure that dispatches to the correct auth helper
 *   (asUserOidc or asUserXapiBasicAuth) based on which security scheme
 *   authenticated the request
 */
export interface XapiAuthority {
  readonly objectType: 'Agent';
  readonly account: { readonly homePage: string; readonly name: string };
}

export interface RequestContext {
  readonly log: Logger;
  readonly pool: pg.Pool;
  readonly config: AppConfig;
  readonly metrics: AppMetrics;
  readonly assetStore: AssetStore;
  readonly asUser: <T>(cb: (client: ScopedClient) => Promise<T>) => Promise<T>;
  readonly xapiAuthority?: XapiAuthority;
  readonly xapiGrantedScopes?: readonly string[];
  readonly xapiReadMineOnly?: boolean;
  readonly xapiCredentialIfi?: string;
  readonly tenantId?: string;
}

export async function createAppContext(config: AppConfig): Promise<AppContext> {
  // 1. Logger first — everything else logs
  const logger = createLogger(config);

  // 2. DB pool with retry
  const pool = await connectWithRetry(config, logger);

  // 3. Metrics (custom registry, not global)
  const metrics = createMetrics(config);
  registerPoolMetrics(pool, metrics.registry);

  // 4. JWT verifier (OIDC discovery + JWKS caching)
  const jwtVerifier = createJwtVerifier(logger);
  await jwtVerifier.seedFromDb(pool);

  // 5. Asset store (local filesystem)
  const assetStore = createLocalAssetStore(config.ASSET_STORAGE_PATH);

  // 6. PG LISTEN/NOTIFY listener for SSE streaming
  const notifyListener = new PgNotifyListener(config.DATABASE_URL, logger);
  await notifyListener.start();
  await notifyListener.listen('xapi_statements_new');

  return { config, logger, pool, metrics, jwtVerifier, assetStore, notifyListener, isShuttingDown: false };
}
