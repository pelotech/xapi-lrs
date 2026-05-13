import { pino } from 'pino';
import { describe, test, expect } from 'vitest';
import { redactQueryString } from '../../src/logger.ts';

describe('redactQueryString', () => {
  test('masks agent value, preserves other params', () => {
    const input = 'agent=%7B%22mbox%22%3A%22mailto%3Afoo%40bar%22%7D&limit=50';
    expect(redactQueryString(input)).toBe('agent=[REDACTED]&limit=50');
  });

  test('masks agent when not first param', () => {
    expect(redactQueryString('limit=50&agent=foo&verb=did')).toBe('limit=50&agent=[REDACTED]&verb=did');
  });

  test('leaves registration alone (only agent is masked)', () => {
    expect(redactQueryString('registration=abc-123&verb=did')).toBe('registration=abc-123&verb=did');
  });

  test('masks every occurrence when agent repeats', () => {
    expect(redactQueryString('agent=a&agent=b')).toBe('agent=[REDACTED]&agent=[REDACTED]');
  });

  test('leaves a query with no sensitive keys unchanged', () => {
    expect(redactQueryString('limit=50&verb=did')).toBe('limit=50&verb=did');
  });

  test('does not match params whose name merely ends with "agent"', () => {
    expect(redactQueryString('myagent=foo&useragent=bar')).toBe('myagent=foo&useragent=bar');
  });

  test('returns empty string unchanged', () => {
    expect(redactQueryString('')).toBe('');
  });
});

describe('pino redact integration', () => {
  /**
   * Capture log lines by piping a freshly-constructed pino logger (with the
   * same redact config as createLogger) into an in-memory destination. This
   * verifies that pino's path syntax `["url.query"]` actually matches the
   * dotted top-level key and that the censor function is invoked.
   */
  function captureSingleLog(fields: Record<string, unknown>): Record<string, unknown> {
    const lines: string[] = [];
    const destination = { write: (chunk: string) => void lines.push(chunk) };
    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: ['["url.query"]'],
          censor: (v: unknown) => (typeof v === 'string' ? redactQueryString(v) : v),
        },
      },
      destination as unknown as NodeJS.WritableStream,
    );
    logger.info(fields);
    expect(lines.length).toBeGreaterThan(0);
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  }

  test('redacts agent in url.query', () => {
    const out = captureSingleLog({ 'url.query': 'agent=foo&limit=50&registration=xyz' });
    expect(out['url.query']).toBe('agent=[REDACTED]&limit=50&registration=xyz');
  });

  test('passes through queries with no sensitive params', () => {
    const out = captureSingleLog({ 'url.query': 'limit=50&verb=did' });
    expect(out['url.query']).toBe('limit=50&verb=did');
  });

  test('does not touch other dotted keys', () => {
    const out = captureSingleLog({ 'url.query': 'agent=foo', 'http.route': '/xapi/statements' });
    expect(out['http.route']).toBe('/xapi/statements');
  });
});
