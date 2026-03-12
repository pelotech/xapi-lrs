/**
 * JWT Verification — static OIDC provider from env vars.
 *
 * Configuration:
 *   JWT_ISSUER      — expected `iss` claim
 *   JWT_AUDIENCE    — expected `aud` claim
 *   OIDC_DISCOVERY_URL — preferred; resolves JWKS URI via .well-known/openid-configuration
 *   JWKS_URI        — direct override if discovery isn't available
 *
 * No per-tenant IdP resolution — single static provider.
 */

import * as jose from "jose";
import type { AuthPayloadJWT, XapiScope } from "./types.ts";

type KeyResolver = ReturnType<typeof jose.createRemoteJWKSet>;

export class JwksCache {
  private cache = new Map<string, KeyResolver>();

  getKeyResolver(jwksUri: string): KeyResolver {
    let resolver = this.cache.get(jwksUri);
    if (!resolver) {
      resolver = jose.createRemoteJWKSet(new URL(jwksUri));
      this.cache.set(jwksUri, resolver);
    }
    return resolver;
  }
}

export async function discoverJwksUri(discoveryUrl: string): Promise<string> {
  const response = await fetch(discoveryUrl);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status} ${response.statusText}`);
  }
  const doc = (await response.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) {
    throw new Error("OIDC discovery document missing jwks_uri");
  }
  return doc.jwks_uri;
}

function normalizeAudience(aud: string | string[] | undefined): string | undefined {
  return Array.isArray(aud) ? aud[0] : aud;
}

export interface JwtConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
}

export interface JwtResult {
  sub: string;
  roles: string[];
  payload: AuthPayloadJWT;
}

/** Valid xAPI scopes for validation */
const VALID_SCOPES = new Set<string>([
  "statements/write",
  "statements/read",
  "statements/read/mine",
  "all/read",
  "all",
  "define",
  "profile",
  "state",
  "state/read",
]);

/** Default JWT scopes when no scope claim is present in the token */
const JWT_DEFAULT_SCOPES: XapiScope[] = ["all"];

/**
 * Extract xAPI scopes from JWT claims.
 * Checks `scope` (space-delimited string per RFC 8693) and `scopes` (array).
 * Only values matching valid XapiScope are kept.
 */
function extractScopes(payload: jose.JWTPayload): XapiScope[] | null {
  const p = payload as Record<string, unknown>;

  // RFC 8693: "scope" as space-delimited string
  if (typeof p.scope === "string" && p.scope.length > 0) {
    const parsed = p.scope.split(/\s+/).filter((s) => VALID_SCOPES.has(s)) as XapiScope[];
    if (parsed.length > 0) return parsed;
  }

  // Alternative: "scopes" as array
  if (Array.isArray(p.scopes)) {
    const parsed = p.scopes.filter(
      (s): s is XapiScope => typeof s === "string" && VALID_SCOPES.has(s),
    );
    if (parsed.length > 0) return parsed;
  }

  return null;
}

export async function verifyJwt(
  jwksCache: JwksCache,
  jwtConfig: JwtConfig,
  token: string,
): Promise<JwtResult> {
  const unverified = jose.decodeJwt(token);
  const iss = unverified.iss;
  const aud = normalizeAudience(unverified.aud);

  if (!iss || !aud) {
    throw new Error("JWT missing iss or aud claim");
  }

  if (iss !== jwtConfig.issuer) {
    throw new Error(`JWT issuer mismatch: expected ${jwtConfig.issuer}, got ${iss}`);
  }

  const keyResolver = jwksCache.getKeyResolver(jwtConfig.jwksUri);
  const { payload } = await jose.jwtVerify(token, keyResolver, {
    issuer: jwtConfig.issuer,
    audience: jwtConfig.audience,
  });

  const realmRoles = (payload as { realm_access?: { roles?: string[] } }).realm_access?.roles;

  const scopes = extractScopes(payload) ?? JWT_DEFAULT_SCOPES;

  return {
    sub: payload.sub ?? "",
    roles: Array.isArray(realmRoles) ? realmRoles : [],
    payload: {
      sub: payload.sub ?? "",
      iss: payload.iss ?? "",
      aud: payload.aud ?? "",
      scopes,
      realm_access: (payload as { realm_access?: { roles?: string[] } }).realm_access,
    },
  };
}
