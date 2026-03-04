import { parseConfigFromEnv } from './config.js';

const minimalEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/test',
};

describe('parseConfigFromEnv', () => {
  it('parses minimal env with defaults', () => {
    const config = parseConfigFromEnv(minimalEnv);
    expect(config.API_PORT).toBe(8180);
    expect(config.ADMIN_PORT).toBe(8190);
    expect(config.PG_POOL_SIZE).toBe(20);
    expect(config.SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    expect(config.RUN_MODE).toBe('combined');
    expect(config.APP_VERSION).toBe('local');
    expect(config.ENABLE_METRICS).toBe(true);
  });

  it('coerces string ports to numbers', () => {
    const config = parseConfigFromEnv({
      ...minimalEnv,
      API_PORT: '3000',
      ADMIN_PORT: '3001',
    });
    expect(config.API_PORT).toBe(3000);
    expect(config.ADMIN_PORT).toBe(3001);
  });

  it('derives LOG_LEVEL=silent when NODE_ENV=test', () => {
    const config = parseConfigFromEnv({ ...minimalEnv, NODE_ENV: 'test' });
    expect(config.logLevel).toBe('silent');
  });

  it('derives LOG_LEVEL=info when NODE_ENV=production', () => {
    const config = parseConfigFromEnv({ ...minimalEnv, NODE_ENV: 'production' });
    expect(config.logLevel).toBe('info');
  });

  it('respects explicit LOG_LEVEL over derivation', () => {
    const config = parseConfigFromEnv({
      ...minimalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'debug',
    });
    expect(config.logLevel).toBe('debug');
  });

  it('splits CORS_ALLOWED_ORIGINS into array', () => {
    const config = parseConfigFromEnv({
      ...minimalEnv,
      CORS_ALLOWED_ORIGINS: 'http://a.com,http://b.com',
    });
    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('fails with all errors at once for multiple invalid fields', () => {
    expect(() => parseConfigFromEnv({ API_PORT: '99999' })).toThrow(
      'Invalid environment configuration',
    );
    try {
      parseConfigFromEnv({ API_PORT: '99999' });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('API_PORT');
      expect(msg).toContain('DATABASE_URL');
    }
  });

  it('returns a frozen config object', () => {
    const config = parseConfigFromEnv(minimalEnv);
    expect(Object.isFrozen(config)).toBe(true);
  });
});
