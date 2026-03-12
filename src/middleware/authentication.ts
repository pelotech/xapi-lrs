/**
 * Hono Authentication Middleware for the LRS service.
 *
 * Supports two security schemes:
 * - 'basic': HTTP Basic Auth (api_key:secret_key) against lrs_credential + credential_to_scope
 * - 'jwt': Bearer JWT verified against env-configured OIDC/JWKS
 */

import type { MiddlewareHandler } from "hono";
import type { Pool } from "pg";
import type { LrsMetrics } from "../metrics.ts";
import type { AuthPayloadBasic, AuthInfo, XapiScope } from "../auth/types.ts";
import type { JwksCache, JwtConfig } from "../auth/jwt.ts";
import { verifyJwt } from "../auth/jwt.ts";
import type { LrsDeps } from "../deps.ts";
import { HttpError } from "../db.ts";

// ============================================================================
// Credential extraction (pure functions)
// ============================================================================

function extractBearerToken(authHeader: string | undefined): string | null {
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

function extractBasicAuth(
  authHeader: string | undefined,
): { apiKey: string; secretKey: string } | null {
  if (!authHeader?.startsWith("Basic ")) {
    return null;
  }

  const decoded = atob(authHeader.slice(6));
  const colonIndex = decoded.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }

  return {
    apiKey: decoded.slice(0, colonIndex),
    secretKey: decoded.slice(colonIndex + 1),
  };
}

// ============================================================================
// Basic auth — lrs_credential + credential_to_scope
// ============================================================================

interface CredentialRow {
  id: string;
  account_id: string;
  account_name: string;
}

interface ScopeRow {
  scope: XapiScope;
}

export async function authenticateBasicCredential(
  pool: Pool,
  apiKey: string,
  secretKey: string,
): Promise<AuthPayloadBasic | null> {
  const { rows: creds } = await pool.query<CredentialRow>(
    {
      name: "authenticate_credential",
      text: `SELECT c.id, c.account_id, a.username AS account_name
             FROM lrs_credential c
             JOIN admin_account a ON a.id = c.account_id
             WHERE c.api_key = $1 AND c.secret_key = $2`,
    },
    [apiKey, secretKey],
  );

  if (creds.length === 0) return null;
  const cred = creds[0];

  const { rows: scopeRows } = await pool.query<ScopeRow>(
    {
      name: "get_credential_scopes",
      text: `SELECT scope FROM credential_to_scope WHERE credential_id = $1`,
    },
    [cred.id],
  );

  return {
    credentialId: cred.id,
    accountId: cred.account_id,
    accountName: cred.account_name,
    scopes: scopeRows.map((r) => r.scope),
  };
}

// ============================================================================
// Hono auth middleware
// ============================================================================

/** Deps needed by the auth middleware — subset of LrsDeps */
export interface AuthDeps {
  pool: Pool;
  jwksCache: JwksCache;
  jwtConfig: JwtConfig | null;
  metrics: LrsMetrics;
}

/**
 * Hono middleware that authenticates Basic or JWT credentials.
 * Sets `c.set('auth', authInfo)` on success.
 * Throws HttpError(401) on failure.
 */
export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const deps = c.get("deps") as LrsDeps;
    const authHeader = c.req.header("authorization") ?? "";

    let authInfo: AuthInfo;

    if (authHeader.startsWith("Basic ")) {
      const credentials = extractBasicAuth(authHeader);
      if (!credentials) {
        deps.metrics.authFailures.add(1, { scheme: "basic" });
        throw new HttpError(401, "Unauthorized");
      }

      const payload = await authenticateBasicCredential(
        deps.pool,
        credentials.apiKey,
        credentials.secretKey,
      );
      if (!payload) {
        deps.metrics.authFailures.add(1, { scheme: "basic" });
        throw new HttpError(401, "Unauthorized");
      }

      authInfo = { type: "basic", payload };
    } else if (authHeader.startsWith("Bearer ")) {
      if (!deps.jwtConfig) {
        deps.metrics.authFailures.add(1, { scheme: "jwt" });
        throw new HttpError(401, "Unauthorized");
      }

      const token = extractBearerToken(authHeader);
      if (!token) {
        deps.metrics.authFailures.add(1, { scheme: "jwt" });
        throw new HttpError(401, "Unauthorized");
      }

      const result = await verifyJwt(deps.jwksCache, deps.jwtConfig, token);
      authInfo = { type: "jwt", payload: result.payload, token };
    } else {
      throw new HttpError(401, "Unauthorized");
    }

    c.set("auth", authInfo);
    await next();
  };
}
