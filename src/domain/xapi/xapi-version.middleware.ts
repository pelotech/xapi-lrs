/**
 * Express middleware that validates the X-Experience-API-Version header
 * on inbound requests and sets it on all outbound responses.
 *
 * Per xAPI 1.0.3:
 *  - Requests MUST include X-Experience-API-Version matching 1.0.x
 *  - Requests with version >= 1.1.0 MUST be rejected with 400
 *  - Responses MUST include X-Experience-API-Version: 1.0.3
 */

import type { Request, Response, NextFunction } from 'express';

const XAPI_VERSION_HEADER = 'X-Experience-API-Version';
const RESPONSE_VERSION = '1.0.3';

/** Matches 1.0, 1.0.0, 1.0.1, 1.0.2, 1.0.3, etc. */
const VALID_VERSION = /^1\.0(?:\.\d+)?$/;

export function xapiVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader(XAPI_VERSION_HEADER, RESPONSE_VERSION);

  const version = req.headers['x-experience-api-version'];
  if (typeof version !== 'string' || !VALID_VERSION.test(version)) {
    res.status(400).json({
      error: {
        status: 400,
        code: 'INVALID_XAPI_VERSION',
        message: `Missing or unsupported ${XAPI_VERSION_HEADER} header. Expected 1.0.x.`,
      },
    });
    return;
  }

  next();
}
