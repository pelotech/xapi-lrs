/**
 * Test JWKS Infrastructure for LRS integration tests.
 *
 * Self-contained IdP stub that generates an RS256 keypair, signs JWTs,
 * and serves JWKS + OIDC discovery endpoints over HTTP.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import * as jose from 'jose';

// ============================================================================
// Types
// ============================================================================

export interface SignTestJWTOptions {
  issuer?: string;
  expiresIn?: string;
}

export interface JwksServerHandle {
  /** Base URL of the JWKS server (e.g., http://localhost:12345) */
  url: string;
  /** The full JWKS endpoint URL (url + /.well-known/jwks.json) */
  jwksUrl: string;
  /** Stop the server */
  close: () => Promise<void>;
}

// ============================================================================
// Eager startup (top-level await)
// ============================================================================

async function startIdpStub(options: { port?: number; issuer?: string } = {}) {
  const { port = 0, issuer = 'idp-stub' } = options;

  const keyPair = await jose.generateKeyPair('RS256');
  const privateKey = keyPair.privateKey;
  const publicJwk = await jose.exportJWK(keyPair.publicKey);
  publicJwk.kid = 'idp-stub-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const jwksResponse = JSON.stringify({ keys: [publicJwk] });

  const server: Server = createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(jwksResponse);
    } else if (req.url === '/.well-known/openid-configuration') {
      const baseUrl = `http://localhost:${(server.address() as { port: number }).port}`;
      const discovery = {
        issuer,
        jwks_uri: `${baseUrl}/.well-known/jwks.json`,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(discovery));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`IdP stub port ${port} is already in use.`));
      } else {
        reject(err);
      }
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get IdP stub server address');
  }

  const url = `http://localhost:${address.port}`;
  const jwksUrl = `${url}/.well-known/jwks.json`;

  const signToken = async (
    payload: Record<string, unknown>,
    tokenOptions: { issuer?: string; expiresIn?: string } = {},
  ): Promise<string> => {
    const { issuer: tokenIssuer = issuer, expiresIn = '1h' } = tokenOptions;
    return new jose.SignJWT(payload as jose.JWTPayload)
      .setProtectedHeader({ alg: 'RS256', kid: 'idp-stub-key-1' })
      .setIssuedAt()
      .setIssuer(tokenIssuer)
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  };

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { url, jwksUrl, issuer, signToken, close };
}

const stub = await startIdpStub({ port: 0, issuer: 'test-issuer' });

// ============================================================================
// Exports
// ============================================================================

/**
 * Sign a JWT with the test RS256 private key.
 * Default issuer: 'test-issuer'. Caller provides sub, aud, and other claims.
 */
export async function signTestJWT(payload: Record<string, unknown>, options: SignTestJWTOptions = {}): Promise<string> {
  return stub.signToken(payload, {
    issuer: options.issuer,
    expiresIn: options.expiresIn,
  });
}

/**
 * Return the already-running IdP stub as a JwksServerHandle.
 */
export async function startJwksServer(): Promise<JwksServerHandle> {
  return {
    url: stub.url,
    jwksUrl: stub.jwksUrl,
    close: async () => {
      // No-op: the shared stub outlives individual test files.
    },
  };
}
