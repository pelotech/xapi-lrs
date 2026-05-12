import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.ts';

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('loadConfig defaults', () => {
  test('uses built-in defaults when env is empty', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8081);
    expect(c.adminPort).toBe(8091);
    expect(c.pgHost).toBe('localhost');
    expect(c.pgPort).toBe(5432);
    expect(c.pgDatabase).toBe('xapi_lrs');
    expect(c.pgUser).toBe('xapi_lrs');
    expect(c.logLevel).toBe('info');
    expect(c.corsEnabled).toBe(true);
    expect(c.corsOrigin).toBe('*');
  });
});

// ---------------------------------------------------------------------------
// Native env vars
// ---------------------------------------------------------------------------

describe('loadConfig native vars', () => {
  test('LRS_PORT overrides PORT', () => {
    expect(loadConfig({ LRS_PORT: '9000', PORT: '7000' }).port).toBe(9000);
  });

  test('PORT is used when LRS_PORT absent', () => {
    expect(loadConfig({ PORT: '7000' }).port).toBe(7000);
  });

  test('LRS_ADMIN_USER / LRS_ADMIN_PASSWORD', () => {
    const c = loadConfig({ LRS_ADMIN_USER: 'alice', LRS_ADMIN_PASSWORD: 'secret' });
    expect(c.adminUser).toBe('alice');
    expect(c.adminPassword).toBe('secret');
  });

  test('LRS_API_KEY_DEFAULT / LRS_API_SECRET_DEFAULT', () => {
    const c = loadConfig({ LRS_API_KEY_DEFAULT: 'k', LRS_API_SECRET_DEFAULT: 's' });
    expect(c.apiKeyDefault).toBe('k');
    expect(c.apiSecretDefault).toBe('s');
  });
});

// ---------------------------------------------------------------------------
// LRSQL compatibility — admin credentials
// ---------------------------------------------------------------------------

describe('loadConfig LRSQL admin credentials', () => {
  test('LRSQL_ADMIN_USER_DEFAULT maps to adminUser', () => {
    expect(loadConfig({ LRSQL_ADMIN_USER_DEFAULT: 'lrsql-admin' }).adminUser).toBe('lrsql-admin');
  });

  test('LRSQL_ADMIN_PASS_DEFAULT maps to adminPassword', () => {
    expect(loadConfig({ LRSQL_ADMIN_PASS_DEFAULT: 'lrsql-pass' }).adminPassword).toBe('lrsql-pass');
  });

  test('native LRS_ADMIN_USER takes precedence over LRSQL_ADMIN_USER_DEFAULT', () => {
    const c = loadConfig({ LRS_ADMIN_USER: 'native', LRSQL_ADMIN_USER_DEFAULT: 'lrsql' });
    expect(c.adminUser).toBe('native');
  });
});

// ---------------------------------------------------------------------------
// LRSQL compatibility — API credentials
// ---------------------------------------------------------------------------

describe('loadConfig LRSQL API credentials', () => {
  test('LRSQL_API_KEY_DEFAULT maps to apiKeyDefault', () => {
    expect(loadConfig({ LRSQL_API_KEY_DEFAULT: 'my_key' }).apiKeyDefault).toBe('my_key');
  });

  test('LRSQL_API_SECRET_DEFAULT maps to apiSecretDefault', () => {
    expect(loadConfig({ LRSQL_API_SECRET_DEFAULT: 'my_secret' }).apiSecretDefault).toBe('my_secret');
  });

  test('native LRS_API_KEY_DEFAULT takes precedence over LRSQL_API_KEY_DEFAULT', () => {
    const c = loadConfig({ LRS_API_KEY_DEFAULT: 'native', LRSQL_API_KEY_DEFAULT: 'lrsql' });
    expect(c.apiKeyDefault).toBe('native');
  });
});

// ---------------------------------------------------------------------------
// LRSQL compatibility — database
// ---------------------------------------------------------------------------

describe('loadConfig LRSQL database', () => {
  test('LRSQL_DB_NAME maps to pgDatabase', () => {
    expect(loadConfig({ LRSQL_DB_NAME: 'mydb' }).pgDatabase).toBe('mydb');
  });

  test('PGDATABASE takes precedence over LRSQL_DB_NAME', () => {
    expect(loadConfig({ PGDATABASE: 'pg-db', LRSQL_DB_NAME: 'lrsql-db' }).pgDatabase).toBe('pg-db');
  });
});

// ---------------------------------------------------------------------------
// LRSQL compatibility — CORS
// ---------------------------------------------------------------------------

describe('loadConfig LRSQL CORS', () => {
  test('LRSQL_ALLOW_ALL_ORIGINS=true enables CORS with wildcard', () => {
    const c = loadConfig({ LRSQL_ALLOW_ALL_ORIGINS: 'true' });
    expect(c.corsEnabled).toBe(true);
    expect(c.corsOrigin).toBe('*');
  });

  test('LRSQL_ALLOW_ALL_ORIGINS=false leaves defaults unchanged', () => {
    const c = loadConfig({ LRSQL_ALLOW_ALL_ORIGINS: 'false' });
    expect(c.corsEnabled).toBe(true);
    expect(c.corsOrigin).toBe('*');
  });

  test('native CORS_ORIGIN takes precedence over LRSQL_ALLOW_ALL_ORIGINS', () => {
    const c = loadConfig({
      CORS_ORIGIN: 'https://example.com',
      LRSQL_ALLOW_ALL_ORIGINS: 'true',
    });
    expect(c.corsOrigin).toBe('https://example.com');
  });

  test('native CORS_ENABLED=false is preserved even with LRSQL_ALLOW_ALL_ORIGINS=true', () => {
    const c = loadConfig({ CORS_ENABLED: 'false', LRSQL_ALLOW_ALL_ORIGINS: 'true' });
    expect(c.corsEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LRSQL compatibility — OIDC
// ---------------------------------------------------------------------------

describe('loadConfig LRSQL OIDC', () => {
  test('LRSQL_OIDC_ISSUER maps to jwtIssuer', () => {
    expect(loadConfig({ LRSQL_OIDC_ISSUER: 'https://idp.example.com' }).jwtIssuer).toBe('https://idp.example.com');
  });

  test('LRSQL_OIDC_AUDIENCE maps to jwtAudience', () => {
    expect(loadConfig({ LRSQL_OIDC_AUDIENCE: 'my-audience' }).jwtAudience).toBe('my-audience');
  });

  test('native JWT_ISSUER takes precedence over LRSQL_OIDC_ISSUER', () => {
    const c = loadConfig({ JWT_ISSUER: 'native', LRSQL_OIDC_ISSUER: 'lrsql' });
    expect(c.jwtIssuer).toBe('native');
  });
});

// ---------------------------------------------------------------------------
// LRSQL compatibility — log level normalization
// ---------------------------------------------------------------------------

describe('loadConfig LRSQL log level normalization', () => {
  const cases: Array<[string, string]> = [
    ['DEBUG', 'debug'],
    ['INFO', 'info'],
    ['WARN', 'warn'],
    ['ERROR', 'error'],
    ['FATAL', 'fatal'],
    ['TRACE', 'trace'],
    ['ALL', 'trace'],
    ['OFF', 'silent'],
    // case-insensitive
    ['debug', 'debug'],
    ['Warn', 'warn'],
  ];

  for (const [lrsql, expected] of cases) {
    test(`LRSQL_LOG_LEVEL=${lrsql} → logLevel=${expected}`, () => {
      expect(loadConfig({ LRSQL_LOG_LEVEL: lrsql }).logLevel).toBe(expected);
    });
  }

  test('native LOG_LEVEL takes precedence over LRSQL_LOG_LEVEL', () => {
    expect(loadConfig({ LOG_LEVEL: 'warn', LRSQL_LOG_LEVEL: 'DEBUG' }).logLevel).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// Statement GET limits — native names
// ---------------------------------------------------------------------------

describe('loadConfig statement GET limits', () => {
  test('defaults to 50/50 when unset', () => {
    const c = loadConfig({});
    expect(c.stmtGetDefault).toBe(50);
    expect(c.stmtGetMax).toBe(50);
  });

  test('LRS_STMT_GET_DEFAULT / LRS_STMT_GET_MAX map to stmtGetDefault/stmtGetMax', () => {
    const c = loadConfig({ LRS_STMT_GET_DEFAULT: '25', LRS_STMT_GET_MAX: '200' });
    expect(c.stmtGetDefault).toBe(25);
    expect(c.stmtGetMax).toBe(200);
  });

  test('native LRS_STMT_GET_* takes precedence over LRSQL_STMT_GET_*', () => {
    const c = loadConfig({
      LRS_STMT_GET_DEFAULT: '10',
      LRSQL_STMT_GET_DEFAULT: '20',
      LRS_STMT_GET_MAX: '100',
      LRSQL_STMT_GET_MAX: '200',
    });
    expect(c.stmtGetDefault).toBe(10);
    expect(c.stmtGetMax).toBe(100);
  });

  test('LRSQL_STMT_GET_* still honored for compatibility', () => {
    const c = loadConfig({ LRSQL_STMT_GET_DEFAULT: '20', LRSQL_STMT_GET_MAX: '200' });
    expect(c.stmtGetDefault).toBe(20);
    expect(c.stmtGetMax).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Deprecation warnings
// ---------------------------------------------------------------------------

describe('loadConfig deprecation warnings', () => {
  const matchDeprecation = (legacy: string) => expect.stringContaining(`${legacy} is deprecated`);

  test.each([
    ['LRSQL_DB_NAME', 'mydb'],
    ['LRSQL_OIDC_ISSUER', 'https://idp'],
    ['LRSQL_OIDC_AUDIENCE', 'aud'],
    ['LRSQL_ADMIN_USER_DEFAULT', 'u'],
    ['LRSQL_ADMIN_PASS_DEFAULT', 'p'],
    ['LRSQL_API_KEY_DEFAULT', 'k'],
    ['LRSQL_API_SECRET_DEFAULT', 's'],
    ['LRSQL_STMT_GET_DEFAULT', '25'],
    ['LRSQL_STMT_GET_MAX', '100'],
    ['LRSQL_LOG_LEVEL', 'DEBUG'],
    ['LRSQL_ALLOW_ALL_ORIGINS', 'true'],
  ])('warns when %s is used', (legacy, value) => {
    loadConfig({ [legacy]: value });
    expect(warnSpy).toHaveBeenCalledWith(matchDeprecation(legacy));
  });

  test('does not warn when native equivalent is also set (legacy unused)', () => {
    loadConfig({ JWT_ISSUER: 'native', LRSQL_OIDC_ISSUER: 'legacy' });
    expect(warnSpy).not.toHaveBeenCalledWith(matchDeprecation('LRSQL_OIDC_ISSUER'));
  });

  test('does not warn when neither legacy nor native is set', () => {
    loadConfig({});
    for (const legacy of [
      'LRSQL_DB_NAME',
      'LRSQL_OIDC_ISSUER',
      'LRSQL_ADMIN_USER_DEFAULT',
      'LRSQL_API_KEY_DEFAULT',
      'LRSQL_STMT_GET_DEFAULT',
      'LRSQL_LOG_LEVEL',
      'LRSQL_ALLOW_ALL_ORIGINS',
    ]) {
      expect(warnSpy).not.toHaveBeenCalledWith(matchDeprecation(legacy));
    }
  });

  test('LRSQL_ALLOW_ALL_ORIGINS warns even when value is "false"', () => {
    loadConfig({ LRSQL_ALLOW_ALL_ORIGINS: 'false' });
    expect(warnSpy).toHaveBeenCalledWith(matchDeprecation('LRSQL_ALLOW_ALL_ORIGINS'));
  });
});
