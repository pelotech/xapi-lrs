import type { DbPool } from './db.ts';
import type { LrsMetrics } from './metrics.ts';
import type { LrsConfig } from './config.ts';
import type { Logger } from 'pino';
import type { AccountRow } from './admin/repositories/accounts.ts';
import { randomBytes } from 'node:crypto';

export interface BootstrapDeps {
  hasAnyAdminAccount(pool: DbPool, metrics: LrsMetrics): Promise<boolean>;
  ensureAdminAccount(pool: DbPool, metrics: LrsMetrics, username: string, password: string): Promise<void>;
  createAccount(pool: DbPool, metrics: LrsMetrics, username: string, password: string): Promise<string>;
  getAccountByUsername(pool: DbPool, metrics: LrsMetrics, username: string): Promise<AccountRow | null>;
  ensureDefaultCredential(
    pool: DbPool,
    metrics: LrsMetrics,
    apiKey: string,
    secretKey: string,
    accountId: string,
  ): Promise<void>;
}

export async function bootstrapAccounts(
  pool: DbPool,
  metrics: LrsMetrics,
  config: LrsConfig,
  logger: Logger,
  deps: BootstrapDeps,
): Promise<void> {
  let bootstrapUsername: string;

  if (config.adminUser && config.adminPassword) {
    await deps.ensureAdminAccount(pool, metrics, config.adminUser, config.adminPassword);
    bootstrapUsername = config.adminUser;
    logger.info({ username: bootstrapUsername }, 'Admin account bootstrapped');
  } else if (!(await deps.hasAnyAdminAccount(pool, metrics))) {
    bootstrapUsername = 'admin';
    const generatedPassword = randomBytes(16).toString('hex');
    await deps.createAccount(pool, metrics, bootstrapUsername, generatedPassword);
    // Warn so generated credentials surface even at quiet log levels.
    logger.warn(
      { username: bootstrapUsername, password: generatedPassword },
      'No admin account configured — generated a one-time admin account. ' +
        'Set LRS_ADMIN_USER and LRS_ADMIN_PASSWORD to suppress this warning.',
    );
  } else {
    bootstrapUsername = config.adminUser ?? '';
  }

  if (config.apiKeyDefault && config.apiSecretDefault) {
    const account = bootstrapUsername ? await deps.getAccountByUsername(pool, metrics, bootstrapUsername) : null;
    if (account) {
      await deps.ensureDefaultCredential(pool, metrics, config.apiKeyDefault, config.apiSecretDefault, account.id);
      logger.info({ apiKey: config.apiKeyDefault }, 'Default xAPI credential bootstrapped');
    } else {
      logger.warn(
        'LRS_API_KEY_DEFAULT / LRSQL_API_KEY_DEFAULT set but no admin account available to own it — skipping credential bootstrap',
      );
    }
  }
}
