import type { IocContainerFactory } from '@tsoa/runtime';
import type pg from 'pg';
import type { Request } from 'express';
import type { AppContext, RequestContext, ScopedClient, XapiAuthority } from './context.js';
import { asUserOidc, asUserXapiBasicAuth } from './context.js';

interface JwtAuthUser {
  iss: string;
  aud: string;
  sub: string;
  token: string;
  tenantId?: string;
}

interface XapiBasicAuthUser {
  key: string;
  secret: string;
  tenantId: string;
}

function isJwtAuth(user: unknown): user is JwtAuthUser {
  return (
    typeof user === 'object' &&
    user !== null &&
    'iss' in user &&
    'aud' in user &&
    'sub' in user &&
    'token' in user
  );
}

function isXapiBasicAuth(user: unknown): user is XapiBasicAuthUser {
  return (
    typeof user === 'object' &&
    user !== null &&
    'key' in user &&
    'secret' in user
  );
}

function buildAsUser(
  pool: pg.Pool,
  user: unknown,
): <T>(cb: (client: ScopedClient) => Promise<T>) => Promise<T> {
  if (isJwtAuth(user)) {
    return <T>(cb: (client: ScopedClient) => Promise<T>) =>
      asUserOidc(pool, user.iss, user.aud, user.sub, cb);
  }

  if (isXapiBasicAuth(user)) {
    return <T>(cb: (client: ScopedClient) => Promise<T>) =>
      asUserXapiBasicAuth(pool, user.key, user.secret, cb);
  }

  // No auth (e.g. @NoSecurity endpoints) — asUser always throws
  return () => Promise.reject(new Error('No authenticated user on this request'));
}

export const iocContainer: IocContainerFactory<Request> = (request: Request) => {
  const ctx = request.app.locals['ctx'] as AppContext;
  const user: unknown = (request as unknown as Record<string, unknown>)['user'];
  const requestId = String(request.id ?? 'unknown');

  // Build xAPI authority from authenticated credential
  let xapiAuthority: XapiAuthority | undefined;
  if (isXapiBasicAuth(user)) {
    const host = request.get('host') ?? 'localhost';
    const proto = request.protocol;
    xapiAuthority = {
      objectType: 'Agent',
      account: { homePage: `${proto}://${host}`, name: user.key },
    };
  } else if (isJwtAuth(user)) {
    xapiAuthority = {
      objectType: 'Agent',
      account: { homePage: user.iss, name: user.sub },
    };
  }

  // Extract tenantId from auth user
  let tenantId: string | undefined;
  if (isJwtAuth(user)) tenantId = user.tenantId;
  else if (isXapiBasicAuth(user)) tenantId = user.tenantId;

  const reqRaw = request as unknown as Record<string, unknown>;
  const reqCtx: RequestContext = {
    log: ctx.logger.child({ requestId }),
    pool: ctx.pool,
    config: ctx.config,
    metrics: ctx.metrics,
    assetStore: ctx.assetStore,
    asUser: buildAsUser(ctx.pool, user),
    xapiAuthority,
    xapiGrantedScopes: reqRaw.xapiGrantedScopes as string[] | undefined,
    xapiReadMineOnly: reqRaw.xapiReadMineOnly as boolean | undefined,
    xapiCredentialIfi: reqRaw.xapiCredentialIfi as string | undefined,
    tenantId,
  };

  return {
    get: <T>(Controller: new (ctx: RequestContext) => T): T =>
      new Controller(reqCtx),
  };
};
