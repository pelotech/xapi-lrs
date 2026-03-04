/**
 * Express middleware that rejects requests containing unknown query parameters
 * on xAPI endpoints. Per the xAPI 1.0.3 spec, an LRS MUST reject requests
 * with unrecognized parameters with 400 Bad Request.
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Allowed query parameters per route path + HTTP method.
 *
 * Key format: "METHOD /path" (uppercase method, lowercase path).
 * Value: Set of allowed parameter names.
 */
const ALLOWED_PARAMS: Record<string, ReadonlySet<string>> = {
  'GET /xapi/about': new Set(),

  'GET /xapi/statements': new Set([
    'statementId', 'voidedStatementId', 'agent', 'verb', 'activity',
    'registration', 'related_activities', 'related_agents',
    'since', 'until', 'limit', 'format', 'attachments', 'ascending', 'cursor',
  ]),
  'PUT /xapi/statements': new Set(['statementId']),
  'POST /xapi/statements': new Set(),

  'GET /xapi/activities/state': new Set(['activityId', 'agent', 'stateId', 'registration', 'since']),
  'PUT /xapi/activities/state': new Set(['activityId', 'agent', 'stateId', 'registration']),
  'POST /xapi/activities/state': new Set(['activityId', 'agent', 'stateId', 'registration']),
  'DELETE /xapi/activities/state': new Set(['activityId', 'agent', 'stateId', 'registration']),

  'GET /xapi/activities/profile': new Set(['activityId', 'profileId', 'since']),
  'PUT /xapi/activities/profile': new Set(['activityId', 'profileId']),
  'POST /xapi/activities/profile': new Set(['activityId', 'profileId']),
  'DELETE /xapi/activities/profile': new Set(['activityId', 'profileId']),

  'GET /xapi/activities': new Set(['activityId']),

  'GET /xapi/agents/profile': new Set(['agent', 'profileId', 'since']),
  'PUT /xapi/agents/profile': new Set(['agent', 'profileId']),
  'POST /xapi/agents/profile': new Set(['agent', 'profileId']),
  'DELETE /xapi/agents/profile': new Set(['agent', 'profileId']),

  'GET /xapi/agents': new Set(['agent']),
};

export function xapiQueryParamsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const key = `${method} ${req.baseUrl}${req.path}`;
  const allowed = ALLOWED_PARAMS[key];

  // Not an xAPI route we track — let it pass through (will 404 later if unknown)
  if (!allowed) {
    next();
    return;
  }

  const unknown = Object.keys(req.query).filter((p) => !allowed.has(p));

  if (unknown.length > 0) {
    // xAPI §2.1.3: Consistent-Through MUST be on all Statements Resource responses
    if (key.endsWith('/xapi/statements')) {
      res.setHeader('X-Experience-API-Consistent-Through', new Date().toISOString());
    }
    res.status(400).json({
      error: {
        status: 400,
        code: 'UNKNOWN_QUERY_PARAMS',
        message: `Unknown query parameter(s): ${unknown.join(', ')}`,
      },
    });
    return;
  }

  next();
}
