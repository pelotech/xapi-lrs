/**
 * Pino logger for the LRS service.
 */

import { pino, type Logger } from 'pino';
import type { LrsConfig } from './config.ts';

export type { Logger };

/**
 * xAPI GET /statements query parameters whose VALUES leak PII into request
 * logs: `agent` carries the actor IFI (often an mbox email or hashed mbox)
 * and `registration` correlates learner sessions. Their values are masked
 * before pino emits the log line; parameter names and other params (verb,
 * activity, limit, since, until, ...) remain visible for diagnostics.
 */
const REDACTED_QUERY_PARAMS = ['agent', 'registration'] as const;

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
