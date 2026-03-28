/**
 * Authentication payload types for the LRS service.
 * Basic auth against lrs_credential + credential_to_scope.
 * JWT auth via env-var configured OIDC provider.
 */

/** xAPI scope enum — matches lrsql's scope_enum */
export type XapiScope =
  | "statements/write"
  | "statements/read"
  | "statements/read/mine"
  | "all/read"
  | "all"
  | "define"
  | "profile"
  | "state"
  | "state/read";

/** Basic Auth payload — from lrs_credential + credential_to_scope lookup */
export interface AuthPayloadBasic {
  credentialId: string;
  accountId: string;
  accountName: string;
  scopes: XapiScope[];
}

/** JWT payload — from env-configured OIDC/JWKS verification */
export interface AuthPayloadJWT {
  sub: string;
  iss: string;
  aud: string | string[];
  scopes: XapiScope[];
  realm_access?: { roles?: string[] };
}

export type AuthPayload = AuthPayloadBasic | AuthPayloadJWT;

/** Auth context set by the Hono auth middleware */
export type AuthInfo =
  | { type: "basic"; payload: AuthPayloadBasic }
  | { type: "jwt"; payload: AuthPayloadJWT; token: string };
