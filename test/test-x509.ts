/**
 * Test X.509 certificate generation helper.
 *
 * Generates self-signed X.509 certificates for JWS signature verification
 * tests using openssl (available in all dev/CI environments).
 */

import { execSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPKCS8 } from 'jose';

export interface TestCertKeyPair {
  privateKeyPem: string;
  certPem: string;
  /** Base64-encoded DER — ready to drop into JWS x5c header array. */
  x5cB64: string;
  /** jose CryptoKey for signing JWS tokens. */
  privateKey: CryptoKey;
}

/**
 * Generate a self-signed X.509 certificate and corresponding private key.
 *
 * Uses `openssl req` to create a short-lived (1 day) self-signed cert.
 * Returns the PEM cert, base64 DER (for x5c), and jose-compatible CryptoKey.
 */
export async function generateTestCert(alg: 'RS256' | 'RS384' | 'RS512' = 'RS256'): Promise<TestCertKeyPair> {
  const { privateKey: privPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyFile = join(tmpdir(), `xapi-test-key-${process.pid}.pem`);
  writeFileSync(keyFile, privPem, { mode: 0o600 });
  let certPem: string;
  try {
    certPem = execSync(`openssl req -new -x509 -key ${keyFile} -days 1 -subj /CN=xapi-test -outform PEM`, {
      encoding: 'utf8',
    }).trim();
  } finally {
    unlinkSync(keyFile);
  }

  const x5cB64 = certPem
    .replace(/-----[^-]+-----/g, '')
    .replace(/\n/g, '')
    .trim();

  const privateKey = await importPKCS8(privPem, alg);

  return { privateKeyPem: privPem, certPem, x5cB64, privateKey };
}
