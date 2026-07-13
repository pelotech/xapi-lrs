/**
 * Hono environment types for the LRS application.
 * Defines typed context variables available in middleware and route handlers.
 */

import type { AuthInfo } from './auth/types.ts';
import type { LrsDeps } from './deps.ts';
import type { MultipartAttachmentPart } from './xapi/multipart.ts';
import type { XapiVersion } from './xapi/versions.ts';

/** Hono environment type — declares context variables set by middleware */
export type HonoEnv = {
  Variables: {
    deps: LrsDeps;
    auth: AuthInfo;
    /** Parsed JSON body (set by body-parsing middleware) */
    parsedBody: unknown;
    /** Raw request body as Buffer (set by body-parsing middleware) */
    rawBody: Buffer;
    /** Multipart attachment parts (set by multipart-parse middleware) */
    attachmentParts: Map<string, MultipartAttachmentPart> | undefined;
    /**
     * Negotiated xAPI version for this request, set by the version middleware.
     * Only present on accepted /xapi paths — absent on admin routes, rejection
     * paths, and before the middleware runs.
     */
    xapiVersion?: XapiVersion;
    /** Unique request identifier for tracing */
    requestId: string;
    /** Per-request child logger with requestId bound */
    logger: import('./logger.ts').Logger;
  };
};
