import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { bootstrapAccounts } from '../../src/bootstrap.ts';
import type { BootstrapDeps } from '../../src/bootstrap.ts';
import { loadConfig } from '../../src/config.ts';
import type { LrsMetrics } from '../../src/metrics.ts';

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

const pool = {} as Pool;
const metrics = {} as LrsMetrics;

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function makeDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    hasAnyAdminAccount: vi.fn().mockResolvedValue(false),
    ensureAdminAccount: vi.fn().mockResolvedValue(undefined),
    createAccount: vi.fn().mockResolvedValue('generated-id'),
    getAccountByUsername: vi.fn().mockResolvedValue({ id: 'acct-1', username: 'admin' }),
    ensureDefaultCredential: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function cfg(env: Record<string, string> = {}) {
  return loadConfig({ NODE_ENV: 'test', ...env });
}

// ---------------------------------------------------------------------------
// Path 1: adminUser + adminPassword configured
// ---------------------------------------------------------------------------

describe('bootstrapAccounts — explicit credentials configured', () => {
  test('calls ensureAdminAccount with the configured user and password', async () => {
    const deps = makeDeps();
    await bootstrapAccounts(
      pool,
      metrics,
      cfg({ LRS_ADMIN_USER: 'alice', LRS_ADMIN_PASSWORD: 'pass' }),
      makeLogger(),
      deps,
    );
    expect(deps.ensureAdminAccount).toHaveBeenCalledWith(pool, metrics, 'alice', 'pass');
  });

  test('does not call createAccount when credentials are configured', async () => {
    const deps = makeDeps();
    await bootstrapAccounts(
      pool,
      metrics,
      cfg({ LRS_ADMIN_USER: 'alice', LRS_ADMIN_PASSWORD: 'pass' }),
      makeLogger(),
      deps,
    );
    expect(deps.createAccount).not.toHaveBeenCalled();
  });

  test('logs info after ensuring the account', async () => {
    const logger = makeLogger();
    const deps = makeDeps();
    await bootstrapAccounts(pool, metrics, cfg({ LRS_ADMIN_USER: 'alice', LRS_ADMIN_PASSWORD: 'pass' }), logger, deps);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ username: 'alice' }), expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// Path 2: no credentials configured, no accounts in DB
// ---------------------------------------------------------------------------

describe('bootstrapAccounts — no credentials, empty DB', () => {
  let deps: BootstrapDeps;
  let logger: Logger;

  beforeEach(() => {
    deps = makeDeps({ hasAnyAdminAccount: vi.fn().mockResolvedValue(false) });
    logger = makeLogger();
  });

  test("creates an account named 'admin'", async () => {
    await bootstrapAccounts(pool, metrics, cfg(), logger, deps);
    expect(deps.createAccount).toHaveBeenCalledWith(pool, metrics, 'admin', expect.any(String));
  });

  test('generated password is a non-empty string', async () => {
    await bootstrapAccounts(pool, metrics, cfg(), logger, deps);
    const [, , , password] = (deps.createAccount as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof password).toBe('string');
    expect(password.length).toBeGreaterThan(0);
  });

  test('logs warn with username and generated password', async () => {
    await bootstrapAccounts(pool, metrics, cfg(), logger, deps);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'admin', password: expect.any(String) }),
      expect.any(String),
    );
  });

  test('does not call ensureAdminAccount', async () => {
    await bootstrapAccounts(pool, metrics, cfg(), logger, deps);
    expect(deps.ensureAdminAccount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Path 3: no credentials configured, accounts already exist
// ---------------------------------------------------------------------------

describe('bootstrapAccounts — no credentials, accounts exist', () => {
  test('does not create or ensure any account', async () => {
    const deps = makeDeps({ hasAnyAdminAccount: vi.fn().mockResolvedValue(true) });
    await bootstrapAccounts(pool, metrics, cfg(), makeLogger(), deps);
    expect(deps.createAccount).not.toHaveBeenCalled();
    expect(deps.ensureAdminAccount).not.toHaveBeenCalled();
  });

  test('emits no log messages', async () => {
    const logger = makeLogger();
    const deps = makeDeps({ hasAnyAdminAccount: vi.fn().mockResolvedValue(true) });
    await bootstrapAccounts(pool, metrics, cfg(), logger, deps);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Credential bootstrap
// ---------------------------------------------------------------------------

describe('bootstrapAccounts — default credential', () => {
  test('creates credential under the configured admin account', async () => {
    const deps = makeDeps({
      getAccountByUsername: vi.fn().mockResolvedValue({ id: 'acct-42', username: 'alice' }),
    });
    await bootstrapAccounts(
      pool,
      metrics,
      cfg({
        LRS_ADMIN_USER: 'alice',
        LRS_ADMIN_PASSWORD: 'pass',
        LRS_API_KEY_DEFAULT: 'k',
        LRS_API_SECRET_DEFAULT: 's',
      }),
      makeLogger(),
      deps,
    );
    expect(deps.ensureDefaultCredential).toHaveBeenCalledWith(pool, metrics, 'k', 's', 'acct-42');
  });

  test("creates credential under the auto-generated 'admin' account when DB is empty", async () => {
    const deps = makeDeps({
      hasAnyAdminAccount: vi.fn().mockResolvedValue(false),
      getAccountByUsername: vi.fn().mockResolvedValue({ id: 'acct-gen', username: 'admin' }),
    });
    await bootstrapAccounts(
      pool,
      metrics,
      cfg({ LRS_API_KEY_DEFAULT: 'k', LRS_API_SECRET_DEFAULT: 's' }),
      makeLogger(),
      deps,
    );
    expect(deps.getAccountByUsername).toHaveBeenCalledWith(pool, metrics, 'admin');
    expect(deps.ensureDefaultCredential).toHaveBeenCalledWith(pool, metrics, 'k', 's', 'acct-gen');
  });

  test('warns and skips when no admin username is resolvable', async () => {
    const logger = makeLogger();
    const deps = makeDeps({ hasAnyAdminAccount: vi.fn().mockResolvedValue(true) });
    await bootstrapAccounts(
      pool,
      metrics,
      cfg({ LRS_API_KEY_DEFAULT: 'k', LRS_API_SECRET_DEFAULT: 's' }),
      logger,
      deps,
    );
    expect(deps.ensureDefaultCredential).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping credential bootstrap'));
  });

  test('skips credential bootstrap when only apiKeyDefault is set', async () => {
    const deps = makeDeps();
    await bootstrapAccounts(
      pool,
      metrics,
      cfg({ LRS_ADMIN_USER: 'alice', LRS_ADMIN_PASSWORD: 'pass', LRS_API_KEY_DEFAULT: 'k' }),
      makeLogger(),
      deps,
    );
    expect(deps.ensureDefaultCredential).not.toHaveBeenCalled();
  });
});
