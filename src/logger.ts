/**
 * Pino logger for the LRS service.
 */

import { pino, type Logger } from 'pino';
import type { LrsConfig } from './config.ts';

export type { Logger };

/**
 * xAPI GET /statements query parameter whose VALUE leaks PII into request
 * logs: `agent` carries the actor IFI (often an mbox email or hashed mbox).
 * Its value is masked before pino emits the log line; the parameter name
 * and other params (verb, activity, registration, limit, since, until, ...)
 * remain visible for diagnostics.
 */
const REDACTED_QUERY_PARAMS = ['agent'] as const;

const REDACT_QUERY_RE = new RegExp(`(^|&)(${REDACTED_QUERY_PARAMS.join('|')})=[^&]*`, 'g');

/** Replace sensitive xAPI query-param values in a raw query string. */
export function redactQueryString(query: string): string {
  if (!query) return query;
  return query.replace(REDACT_QUERY_RE, '$1$2=[REDACTED]');
}

export function createLogger(config: LrsConfig): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      // Top-level key with a literal dot — fast-redact bracket notation.
      paths: ['["url.query"]'],
      censor: (value: unknown) => (typeof value === 'string' ? redactQueryString(value) : value),
    },
  });
}
