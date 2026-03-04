import type { Request } from 'express';
import type { AppContext } from './context.js';
import { checkScope } from '../domain/xapi/xapi-scopes.js';

function authError(status: number, message: string): Error {
  const err = new Error(message);
  (err as unknown as Record<string, number>).status = status;
  return err;
}

export async function expressAuthentication(
  request: Request,
  securityName: string,
  _scopes?: string[],
): Promise<unknown> {
  if (securityName === 'jwt') {
    const header = request.headers['authorization'];
    const token = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined;
    if (!token) {
      throw authError(401, 'No token provided');
    }
    const ctx = request.app.locals['ctx'] as AppContext;
    const { iss, aud, sub } = await ctx.jwtVerifier.verifyToken(token);

    // JWT users get unrestricted xAPI scopes
    const scopes = ['all'];
    const { allowed, readMineOnly } = checkScope(scopes, request.method, request.path);
    if (!allowed) {
      throw authError(403, 'Insufficient xAPI scope for this operation');
    }
    const jwtReq = request as unknown as Record<string, unknown>;
    jwtReq.xapiGrantedScopes = scopes;
    jwtReq.xapiReadMineOnly = readMineOnly;

    return { iss, aud, sub, token };
  }

  if (securityName === 'xapi_basic') {
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Basic ')) {
      throw authError(401, 'Missing or invalid Basic credentials');
    }
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      throw authError(401, 'Malformed Basic credentials');
    }
    const key = decoded.slice(0, colonIndex);
    const secret = decoded.slice(colonIndex + 1);
    if (!key || !secret) {
      throw authError(401, 'Missing key or secret in Basic credentials');
    }
    // key must be a valid UUID (xAPI token id)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(key)) {
      throw authError(401, 'Invalid xAPI token id');
    }

    // Look up token scopes from DB (lightweight PK query, no tenant scoping needed)
    const ctx = request.app.locals['ctx'] as AppContext;
    const { rows } = await ctx.pool.query<{ scopes: string[] }>(
      'SELECT scopes FROM xapi.tokens WHERE id = $1',
      [key],
    );
    if (!rows[0]) {
      throw authError(401, 'Unknown xAPI token');
    }
    const scopes = rows[0].scopes ?? ['all'];

    // Enforce scope against the requested method + path
    const { allowed, readMineOnly } = checkScope(scopes, request.method, request.path);
    if (!allowed) {
      throw authError(403, 'Insufficient xAPI scope for this operation');
    }

    // Attach scope metadata for downstream controllers
    const basicReq = request as unknown as Record<string, unknown>;
    basicReq.xapiGrantedScopes = scopes;
    basicReq.xapiReadMineOnly = readMineOnly;
    if (readMineOnly) {
      const host = request.get('host') ?? 'localhost';
      const proto = request.protocol;
      basicReq.xapiCredentialIfi = `account:${proto}://${host}|${key}`;
    }

    return { key, secret };
  }

  throw authError(501, `Unknown security scheme: ${securityName}`);
}
