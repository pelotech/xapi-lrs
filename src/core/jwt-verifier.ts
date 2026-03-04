import type { Logger } from 'pino';
import type pg from 'pg';
import type { GetKeyFunction, JWSHeaderParameters, FlattenedJWSInput } from 'jose';
import { decodeJwt, jwtVerify, createRemoteJWKSet } from 'jose';

export interface JwtVerifier {
  verifyToken(token: string): Promise<{ iss: string; aud: string; sub: string }>;
  seedFromDb(pool: pg.Pool): Promise<void>;
}

/**
 * Create a JWT verifier that:
 * 1. Decodes the token (unverified) to read `iss`
 * 2. Looks up the JWKS key set for that issuer (seeded from DB)
 * 3. Verifies the token signature via the issuer's JWKS
 * 4. Returns `{ iss, aud, sub }` from the verified payload
 *
 * Call `seedFromDb(pool)` at startup to populate the cache from
 * `tenant.tenant_idps.jwks_uri`, keyed by `jwt_iss`.
 */
export function createJwtVerifier(logger: Logger): JwtVerifier {
  const keySets = new Map<string, GetKeyFunction<JWSHeaderParameters, FlattenedJWSInput>>();

  function getKeySet(iss: string): GetKeyFunction<JWSHeaderParameters, FlattenedJWSInput> {
    const keySet = keySets.get(iss);
    if (!keySet) {
      throw new Error(`No JWKS configured for issuer: ${iss}`);
    }
    return keySet;
  }

  return {
    async verifyToken(token: string): Promise<{ iss: string; aud: string; sub: string }> {
      // 1. Decode without verification to read iss
      const claims = decodeJwt(token);
      const iss = claims.iss;
      if (typeof iss !== 'string' || !iss) {
        throw new Error('JWT missing iss claim');
      }

      // 2. Verify signature + standard claims (exp, nbf)
      const keySet = getKeySet(iss);
      const { payload } = await jwtVerify(token, keySet);

      // 3. Extract required claims
      const sub = payload.sub;
      if (typeof sub !== 'string' || !sub) {
        throw new Error('JWT missing sub claim');
      }

      // aud can be string or string[] — normalize to first value
      const rawAud = payload.aud;
      let aud: string;
      if (typeof rawAud === 'string') {
        aud = rawAud;
      } else if (Array.isArray(rawAud) && rawAud.length > 0 && rawAud[0] !== undefined) {
        aud = rawAud[0];
      } else {
        throw new Error('JWT missing aud claim');
      }

      return { iss, aud, sub };
    },

    async seedFromDb(pool: pg.Pool): Promise<void> {
      const { rows } = await pool.query<{ jwt_iss: string; jwks_uri: string }>(
        `SELECT idp.jwt_iss, idp.jwks_uri
           FROM tenant.tenant_idps idp
           JOIN tenant.tenants t ON t.id = idp.tenant_id AND t.is_active = TRUE`,
      );

      for (const row of rows) {
        const keySet = createRemoteJWKSet(new URL(row.jwks_uri));
        await keySet.reload();
        keySets.set(row.jwt_iss, keySet);
        logger.info({ iss: row.jwt_iss, jwksUri: row.jwks_uri }, 'loaded JWKS for issuer');
      }
    },
  };
}
