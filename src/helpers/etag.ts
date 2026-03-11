/**
 * ETag computation and concurrency header checking for xAPI document resources.
 * Extracted from packages/api/src/api/controllers/xapi/document-utils.ts.
 */

import { createHash } from 'node:crypto';
import { HttpError } from '../db.ts';

/** Compute SHA-1 ETag for document content (xAPI conformance requires SHA-1) */
export function computeEtag(content: Buffer | unknown): string {
  const hash = createHash('sha1');
  if (Buffer.isBuffer(content)) {
    hash.update(content);
  } else {
    hash.update(typeof content === 'string' ? content : JSON.stringify(content));
  }
  return hash.digest('hex');
}

/** Generic concurrency headers — works with both Express and Hono */
export interface ConcurrencyHeaders {
  'if-match'?: string;
  'if-none-match'?: string;
}

/**
 * Check If-Match / If-None-Match concurrency headers against current ETag.
 *
 * Per xAPI spec:
 * - Activity/Agent Profile PUT: MUST include concurrency headers -> 409 if missing
 * - Activity/Agent Profile POST/DELETE: SHOULD include (not enforced)
 * - State Resource: "will permit PUT, POST, DELETE without concurrency headers"
 * - If-Match present but ETag doesn't match -> 412
 * - If-None-Match: * present but document exists -> 412
 *
 * @param requireConcurrency - true for Profile PUT (MUST), false for State and POST/DELETE
 */
export function checkConcurrencyHeaders(
  headers: ConcurrencyHeaders,
  currentEtag: string | undefined,
  requireConcurrency = false,
): void {
  const ifMatch = headers['if-match'];
  const ifNoneMatch = headers['if-none-match'];

  // xAPI spec: Profile PUT MUST include If-Match or If-None-Match
  if (requireConcurrency && !ifMatch && !ifNoneMatch) {
    if (currentEtag) {
      throw new HttpError(409, 'If-Match or If-None-Match header required when updating existing documents');
    }
    throw new HttpError(400, 'If-Match or If-None-Match header required');
  }

  if (ifMatch) {
    const expected = ifMatch.replace(/^"/, '').replace(/"$/, '');
    if (!currentEtag || expected !== currentEtag) {
      throw new HttpError(412, 'ETag mismatch');
    }
  }

  if (ifNoneMatch === '*' && currentEtag) {
    throw new HttpError(412, 'Document already exists');
  }
}
