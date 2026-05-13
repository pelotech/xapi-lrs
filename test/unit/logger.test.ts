import { pino } from 'pino';
import { describe, test, expect } from 'vitest';
import { redactQueryString } from '../../src/logger.ts';

describe('redactQueryString', () => {
  test('masks agent value', () => {
    const input = 'agent=%7B%22mbox%22%3A%22mailto%3Afoo%40bar%22%7D&limit=50';
    expect(redactQueryString(input)).toBe('agent=[REDACTED]&limit=50');
  });

  test('masks registration value', () => {
    expect(redactQueryString('registration=abc-123&verb=did')).toBe('registration=[REDACTED]&verb=did');
  });

  test('masks both when both present, preserves other params', () => {
    expect(redactQueryString('limit=50&agent=foo&verb=did&registration=xyz')).toBe(
      'limit=50&agent=[REDACTED]&verb=did&registration=[REDACTED]',
    );
  });

  test('masks every occurrence when a sensitive key repeats', () => {
    expect(redactQueryString('agent=a&agent=b')).toBe('agent=[REDACTED]&agent=[REDACTED]');
  });

  test('leaves a query with no sensitive keys unchanged', () => {
    expect(redactQueryString('limit=50&verb=did')).toBe('limit=50&verb=did');
  });

  test('does not match params whose name merely ends with a sensitive key', () => {
    expect(redactQueryString('myagent=foo&xregistration=bar')).toBe('myagent=foo&xregistration=bar');
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

  test('redacts agent and registration in url.query', () => {
    const out = captureSingleLog({ 'url.query': 'agent=foo&limit=50&registration=xyz' });
    expect(out['url.query']).toBe('agent=[REDACTED]&limit=50&registration=[REDACTED]');
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
