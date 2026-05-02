/**
 * Integration Tests: xAPI Signed Statements (JWS Validation)
 * Tests POST with signed statement attachments per xAPI 1.0.3 §2.6
 *
 * Structural tests run against the default server (verifySignatures: false).
 * Cryptographic tests use a second server with verifySignatures: true.
 */

import { createHash, randomUUID, generateKeyPairSync } from 'node:crypto';
import { CompactSign, importPKCS8, base64url } from 'jose';
import { beforeAll, afterAll } from 'vitest';
import { generateTestCert } from '../../test-x509.ts';
import { test, describe, expect, createLrsTestServer, createBasicAuth } from '../fixtures.ts';
import type { LrsTestServerHandle } from '../test-server.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalStatement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actor: { mbox: 'mailto:test@example.com' },
    verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
    object: { id: 'http://example.com/activities/1' },
    ...overrides,
  };
}

/** Generate an RSA key pair and return the jose CryptoKey for signing. */
async function generateSigningKey(alg: string = 'RS256'): Promise<{ privateKey: CryptoKey; privateKeyPem: string }> {
  const { privateKey: pem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const privateKey = await importPKCS8(pem, alg);
  return { privateKey, privateKeyPem: pem };
}

/** Build a JWS compact serialization for a statement payload. */
async function buildJws(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  alg: string = 'RS256',
  extraHeaders: Record<string, unknown> = {},
  opts?: { corruptPayload?: boolean },
): Promise<Buffer> {
  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg, ...extraHeaders })
    .sign(privateKey);

  if (opts?.corruptPayload) {
    const parts = jws.split('.');
    parts[1] = Buffer.from('not-valid-json{{{').toString('base64url');
    return Buffer.from(parts.join('.'));
  }

  return Buffer.from(jws, 'utf8');
}

/** Build a multipart/mixed body with a signed statement. */
function buildSignedStatementBody(
  statement: Record<string, unknown>,
  jwsBuffer: Buffer,
  opts?: { signatureContentType?: string },
): { body: Buffer; contentType: string } {
  const sha2 = createHash('sha256').update(jwsBuffer).digest('hex');
  const boundary = `xapi-sig-boundary-${randomUUID().slice(0, 8)}`;

  // Add signature attachment metadata to the statement
  const stmtWithAttachment = {
    ...statement,
    attachments: [
      ...(Array.isArray(statement.attachments) ? (statement.attachments as unknown[]) : []),
      {
        usageType: 'http://adlnet.gov/expapi/attachments/signature',
        display: { 'en-US': 'Signature' },
        contentType: opts?.signatureContentType ?? 'application/octet-stream',
        length: jwsBuffer.length,
        sha2,
      },
    ],
  };

  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from('Content-Type: application/json\r\n'));
  parts.push(Buffer.from('\r\n'));
  parts.push(Buffer.from(JSON.stringify(stmtWithAttachment)));
  parts.push(Buffer.from('\r\n'));

  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from('Content-Type: application/octet-stream\r\n'));
  parts.push(Buffer.from('Content-Transfer-Encoding: binary\r\n'));
  parts.push(Buffer.from(`X-Experience-API-Hash: ${sha2}\r\n`));
  parts.push(Buffer.from('\r\n'));
  parts.push(jwsBuffer);
  parts.push(Buffer.from('\r\n'));

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/mixed; boundary=${boundary}`,
  };
}

async function postMultipart(apiUrl: string, auth: string, body: Buffer, contentType: string) {
  return fetch(`${apiUrl}/xapi/statements`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Authorization: `Basic ${auth}`, ...V },
    body: new Uint8Array(body),
  });
}

// ===========================================================================
// Structural validation tests (default config — verifySignatures: false)
// ===========================================================================

describe('xAPI Signed Statements — structural validation', () => {
  describe('POST /xapi/statements — valid signed statements', () => {
    test('should accept signed statement with RS256', async ({ server, basicAuth }) => {
      const stmt = minimalStatement();
      const { privateKey } = await generateSigningKey('RS256');
      const jwsBuffer = await buildJws(stmt, privateKey, 'RS256');
      const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

      const resp = await postMultipart(server.apiUrl, basicAuth, body, contentType);
      expect(resp.status).toBe(200);
    });

    test('should accept signed statement with RS384', async ({ server, basicAuth }) => {
      const { privateKey } = await generateSigningKey('RS384');
      const stmt = minimalStatement();
      const jwsBuffer = await buildJws(stmt, privateKey, 'RS384');
      const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

      const resp = await postMultipart(server.apiUrl, basicAuth, body, contentType);
      expect(resp.status).toBe(200);
    });

    test('should accept signed statement with RS512', async ({ server, basicAuth }) => {
      const { privateKey } = await generateSigningKey('RS512');
      const stmt = minimalStatement();
      const jwsBuffer = await buildJws(stmt, privateKey, 'RS512');
      const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

      const resp = await postMultipart(server.apiUrl, basicAuth, body, contentType);
      expect(resp.status).toBe(200);
    });
  });

  describe('POST /xapi/statements — invalid signed statements', () => {
    test('should reject signed statement with bad contentType', async ({ server, basicAuth }) => {
      const stmt = minimalStatement();
      const { privateKey } = await generateSigningKey('RS256');
      const jwsBuffer = await buildJws(stmt, privateKey, 'RS256');
      const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer, {
        signatureContentType: 'text/plain',
      });

      const resp = await postMultipart(server.apiUrl, basicAuth, body, contentType);
      expect(resp.status).toBe(400);
      const respBody = await resp.json();
      expect(respBody.error).toMatch(/contentType|application\/octet-stream/i);
    });

    test('should reject signed statement with corrupted JSON payload', async ({ server, basicAuth }) => {
      const stmt = minimalStatement();
      const { privateKey } = await generateSigningKey('RS256');
      const jwsBuffer = await buildJws(stmt, privateKey, 'RS256', {}, { corruptPayload: true });
      const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

      const resp = await postMultipart(server.apiUrl, basicAuth, body, contentType);
      expect(resp.status).toBe(400);
      const respBody = await resp.json();
      expect(respBody.error).toMatch(/JSON/i);
    });

    test('should reject signed statement with HS256 algorithm', async ({ server, basicAuth }) => {
      const stmt = minimalStatement();
      // Build a fake JWS with HS256 header
      const header = base64url.encode(JSON.stringify({ alg: 'HS256' }));
      const payload = base64url.encode(JSON.stringify(stmt));
      const fakeJws = `${header}.${payload}.fakesignature`;
      const jwsBuffer = Buffer.from(fakeJws, 'utf8');

      const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

      const resp = await postMultipart(server.apiUrl, basicAuth, body, contentType);
      expect(resp.status).toBe(400);
      const respBody = await resp.json();
      expect(respBody.error).toMatch(/HS256|algorithm/i);
    });

    test('should reject signed statement with invalid JWS binary', async ({ server, basicAuth }) => {
      const invalidJws = Buffer.from('this-is-not-a-jws');
      const stmt = minimalStatement();
      const { body, contentType } = buildSignedStatementBody(stmt, invalidJws);

      const resp = await postMultipart(server.apiUrl, basicAuth, body, contentType);
      expect(resp.status).toBe(400);
      const respBody = await resp.json();
      expect(respBody.error).toMatch(/JWS/i);
    });
  });
});

// ===========================================================================
// Cryptographic verification tests (xapiVerifySignatures: true)
// ===========================================================================

describe('xAPI Signed Statements — cryptographic verification', () => {
  let verifyServer: LrsTestServerHandle;
  let verifyAuth: string;

  beforeAll(async () => {
    verifyServer = await createLrsTestServer({ xapiVerifySignatures: true });
    verifyAuth = await createBasicAuth(verifyServer.pool, { label: 'Verify Test Partner' });
  });

  afterAll(async () => {
    if (verifyServer) await verifyServer.close();
  });

  test('should accept when signed payload matches received statement', async () => {
    const stmt = minimalStatement();
    const { privateKey } = await generateSigningKey('RS256');
    // Sign the exact same statement (minus server-set fields)
    const jwsBuffer = await buildJws(stmt, privateKey, 'RS256');
    const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

    const resp = await postMultipart(verifyServer.apiUrl, verifyAuth, body, contentType);
    expect(resp.status).toBe(200);
  });

  test('should reject when signed payload has different verb', async () => {
    const stmt = minimalStatement();
    const { privateKey } = await generateSigningKey('RS256');
    // Sign a different statement (different verb)
    const differentPayload = { ...stmt, verb: { id: 'http://example.com/verbs/OTHER' } };
    const jwsBuffer = await buildJws(differentPayload, privateKey, 'RS256');
    const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

    const resp = await postMultipart(verifyServer.apiUrl, verifyAuth, body, contentType);
    expect(resp.status).toBe(400);
    const respBody = await resp.json();
    expect(respBody.error).toMatch(/equivalent|payload/i);
  });

  test('should accept with valid x5c certificate and correct signature', async () => {
    const stmt = minimalStatement();
    const cert = await generateTestCert('RS256');
    const jwsBuffer = await buildJws(stmt, cert.privateKey, 'RS256', { x5c: [cert.x5cB64] });
    const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

    const resp = await postMultipart(verifyServer.apiUrl, verifyAuth, body, contentType);
    expect(resp.status).toBe(200);
  });

  test('should reject with x5c certificate that does not match signing key', async () => {
    const stmt = minimalStatement();
    // Generate cert and a DIFFERENT signing key
    const cert = await generateTestCert('RS256');
    const { privateKey: wrongKey } = await generateSigningKey('RS256');
    // Sign with the wrong key but include the cert's x5c
    const jwsBuffer = await buildJws(stmt, wrongKey, 'RS256', { x5c: [cert.x5cB64] });
    const { body, contentType } = buildSignedStatementBody(stmt, jwsBuffer);

    const resp = await postMultipart(verifyServer.apiUrl, verifyAuth, body, contentType);
    expect(resp.status).toBe(400);
    const respBody = await resp.json();
    expect(respBody.error).toMatch(/x5c|verify|signature/i);
  });
});
