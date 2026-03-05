import { describe, expect, it } from 'vitest';
import { CompactSign, importPKCS8, type CompactJWSHeaderParameters } from 'jose';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';

interface TestKeyMaterial {
  privateKeyPem: string;
  certDerBase64: string; // base64-encoded DER certificate (for x5c)
  alg: 'RS256' | 'RS384' | 'RS512';
}

function generateTestKeyMaterial(alg: 'RS256' | 'RS384' | 'RS512' = 'RS256'): TestKeyMaterial {
  const hashMap = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512' } as const;
  const dir = mkdtempSync(join(tmpdir(), 'jws-test-'));
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 1 -nodes -subj "/CN=test" -${hashMap[alg]}`,
      { cwd: dir, stdio: 'pipe' },
    );
    const privateKeyPem = readFileSync(join(dir, 'key.pem'), 'utf8');
    const certPem = readFileSync(join(dir, 'cert.pem'), 'utf8');
    // Extract DER base64 from PEM (strip headers and whitespace)
    const certDerBase64 = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    return { privateKeyPem, certDerBase64, alg };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Build a valid JWS compact string for a given statement. */
async function buildJws(
  statement: Record<string, unknown>,
  keyMaterial: TestKeyMaterial,
  headerOverrides?: Record<string, unknown>,
): Promise<string> {
  const key = await importPKCS8(keyMaterial.privateKeyPem, keyMaterial.alg);
  const payload = new TextEncoder().encode(JSON.stringify(statement));
  const header: CompactJWSHeaderParameters = {
    alg: keyMaterial.alg,
    x5c: [keyMaterial.certDerBase64],
    ...headerOverrides,
  };
  return new CompactSign(payload).setProtectedHeader(header).sign(key);
}

// Simulate what the controller's validateSignedStatements does
import { importX509, compactVerify } from 'jose';

async function validateJws(jwsStr: string): Promise<void> {
  const VALID_JWS_ALGORITHMS = new Set(['RS256', 'RS384', 'RS512']);

  const parts = jwsStr.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS: expected three dot-separated parts');

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid JWS: cannot decode header');
  }

  const alg = header.alg;
  if (typeof alg !== 'string' || !VALID_JWS_ALGORITHMS.has(alg)) {
    throw new Error(`Invalid JWS: algorithm "${String(alg)}" not allowed`);
  }

  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length === 0) {
    throw new Error('Invalid JWS: x5c header must contain at least one certificate');
  }

  const certDer = x5c[0] as string;
  const pem = `-----BEGIN CERTIFICATE-----\n${certDer}\n-----END CERTIFICATE-----`;
  const publicKey = await importX509(pem, alg);

  await compactVerify(jwsStr, publicKey, { algorithms: ['RS256', 'RS384', 'RS512'] });
}

// ---------- tests ----------

const testStatement = {
  actor: { mbox: 'mailto:test@example.com', objectType: 'Agent' },
  verb: { id: 'http://example.com/verbs/tested' },
  object: { id: 'http://example.com/activities/test', objectType: 'Activity' },
};

describe('JWS signature verification', () => {
  const keyMaterial = generateTestKeyMaterial('RS256');

  it('accepts a valid RS256 signed statement', async () => {
    const jws = await buildJws(testStatement, keyMaterial);
    await expect(validateJws(jws)).resolves.toBeUndefined();
  });

  it('accepts a valid RS384 signed statement', async () => {
    const km384 = generateTestKeyMaterial('RS384');
    const jws = await buildJws(testStatement, km384);
    await expect(validateJws(jws)).resolves.toBeUndefined();
  });

  it('accepts a valid RS512 signed statement', async () => {
    const km512 = generateTestKeyMaterial('RS512');
    const jws = await buildJws(testStatement, km512);
    await expect(validateJws(jws)).resolves.toBeUndefined();
  });

  it('rejects a tampered signature', async () => {
    const jws = await buildJws(testStatement, keyMaterial);
    // Tamper with the signature portion (last segment)
    const parts = jws.split('.');
    const sig = parts[2]!;
    // Flip a character in the signature
    const tampered = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
    const tamperedJws = `${parts[0]}.${parts[1]}.${tampered}`;
    await expect(validateJws(tamperedJws)).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const jws = await buildJws(testStatement, keyMaterial);
    const parts = jws.split('.');
    // Replace payload with a different statement
    const differentPayload = Buffer.from(JSON.stringify({ ...testStatement, id: 'tampered' })).toString('base64url');
    const tamperedJws = `${parts[0]}.${differentPayload}.${parts[2]}`;
    await expect(validateJws(tamperedJws)).rejects.toThrow();
  });

  it('rejects when x5c header is missing', async () => {
    const jws = await buildJws(testStatement, keyMaterial, { x5c: undefined });
    // Remove x5c from the header by rebuilding
    const parts = jws.split('.');
    const headerJson = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
    delete headerJson.x5c;
    const newHeader = Buffer.from(JSON.stringify(headerJson)).toString('base64url');
    const noX5cJws = `${newHeader}.${parts[1]}.${parts[2]}`;
    await expect(validateJws(noX5cJws)).rejects.toThrow('x5c header must contain at least one certificate');
  });

  it('rejects when x5c header is an empty array', async () => {
    const jws = await buildJws(testStatement, keyMaterial);
    const parts = jws.split('.');
    const headerJson = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
    headerJson.x5c = [];
    const newHeader = Buffer.from(JSON.stringify(headerJson)).toString('base64url');
    const emptyX5cJws = `${newHeader}.${parts[1]}.${parts[2]}`;
    await expect(validateJws(emptyX5cJws)).rejects.toThrow('x5c header must contain at least one certificate');
  });

  it('rejects a disallowed algorithm (HS256)', async () => {
    const jws = await buildJws(testStatement, keyMaterial);
    const parts = jws.split('.');
    const headerJson = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
    headerJson.alg = 'HS256';
    const newHeader = Buffer.from(JSON.stringify(headerJson)).toString('base64url');
    const badAlgJws = `${newHeader}.${parts[1]}.${parts[2]}`;
    await expect(validateJws(badAlgJws)).rejects.toThrow('algorithm');
  });

  it('rejects when certificate does not match signing key', async () => {
    // Sign with one key, put a different cert in x5c
    const otherKeyMaterial = generateTestKeyMaterial('RS256');
    const jws = await buildJws(testStatement, keyMaterial, {
      x5c: [otherKeyMaterial.certDerBase64],
    });
    await expect(validateJws(jws)).rejects.toThrow();
  });

  it('rejects malformed JWS (not three parts)', async () => {
    await expect(validateJws('not.a.valid.jws.format')).rejects.toThrow('three dot-separated parts');
    await expect(validateJws('onlyonepart')).rejects.toThrow('three dot-separated parts');
  });

  it('rejects invalid base64url in header', async () => {
    await expect(validateJws('!!!invalid.payload.signature')).rejects.toThrow('cannot decode header');
  });
});
