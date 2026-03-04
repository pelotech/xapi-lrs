import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import pino from 'pino';
import { createJwtVerifier } from './jwt-verifier.js';

// ---------------------------------------------------------------------------
// Local JWKS server
// ---------------------------------------------------------------------------

let server: http.Server;
let baseUrl: string;
let privateKey: CryptoKey;
let kid: string;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey as CryptoKey;
  const pubJwk = await exportJWK(kp.publicKey);
  kid = 'test-kid-1';
  pubJwk.kid = kid;
  pubJwk.alg = 'RS256';
  pubJwk.use = 'sig';

  server = http.createServer((req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [pubJwk] }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  baseUrl = await new Promise<string>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(`http://127.0.0.1:${String(addr.port)}`);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
    server.on('error', reject);
  });
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: 'silent' });

/** Create a verifier seeded with the local JWKS server for `issuer`. */
function seededVerifier(issuer: string = baseUrl) {
  const verifier = createJwtVerifier(logger);
  const mockPool = {
    query: () => Promise.resolve({
      rows: [{ jwt_iss: issuer, jwks_uri: `${baseUrl}/jwks` }],
      rowCount: 1,
    }),
  } as unknown as import('pg').Pool;
  return verifier.seedFromDb(mockPool).then(() => verifier);
}

function signToken(overrides: Record<string, unknown> = {}, expOverride?: Date) {
  const builder = new SignJWT({ aud: 'test-aud', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(overrides.iss as string ?? baseUrl)
    .setSubject(overrides.sub as string ?? 'user-123')
    .setIssuedAt();

  if (expOverride) {
    builder.setExpirationTime(expOverride);
  } else {
    builder.setExpirationTime('1h');
  }

  return builder.sign(privateKey);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createJwtVerifier', () => {
  it('verifies a valid token and returns iss, aud, sub', async () => {
    const verifier = await seededVerifier();
    const token = await signToken();

    const result = await verifier.verifyToken(token);

    expect(result.iss).toBe(baseUrl);
    expect(result.aud).toBe('test-aud');
    expect(result.sub).toBe('user-123');
  });

  it('rejects an expired token', async () => {
    const verifier = await seededVerifier();
    const token = await signToken({}, new Date(Date.now() - 60_000));

    await expect(verifier.verifyToken(token)).rejects.toThrow();
  });

  it('rejects a token signed with a different key', async () => {
    const verifier = await seededVerifier();
    const otherKp = await generateKeyPair('RS256');
    const token = await new SignJWT({ aud: 'test-aud' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(baseUrl)
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherKp.privateKey);

    await expect(verifier.verifyToken(token)).rejects.toThrow();
  });

  it('rejects a token without iss claim', async () => {
    const verifier = await seededVerifier();
    const token = await new SignJWT({ aud: 'test-aud' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifier.verifyToken(token)).rejects.toThrow('JWT missing iss claim');
  });

  it('rejects a token from an unknown issuer', async () => {
    const verifier = await seededVerifier();
    const token = await signToken({ iss: 'http://unknown-issuer.example.com' });

    await expect(verifier.verifyToken(token)).rejects.toThrow('No JWKS configured for issuer');
  });
});
