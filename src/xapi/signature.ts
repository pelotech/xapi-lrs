/**
 * xAPI Signed Statement Validation
 *
 * Validates JWS (JSON Web Signature) attachments on signed statements per
 * xAPI 1.0.3 §2.6. A signed statement has an attachment with:
 * - usageType: "http://adlnet.gov/expapi/attachments/signature"
 * - contentType: "application/octet-stream"
 * - Binary data: JWS compact serialization using RS256, RS384, or RS512
 *
 * When `verifySignatures` is enabled, also validates:
 * - Payload equivalence (signed payload ≡ received statement per §2.3.1)
 * - x5c certificate signature verification (if JWS header includes x5c)
 */

import { decodeProtectedHeader, base64url, compactVerify, importX509 } from 'jose';
import { HttpError } from '../db.ts';
import type { Logger } from '../logger.ts';
import type { LrsMetrics } from '../metrics.ts';
import type { MultipartAttachmentPart } from './multipart.ts';
import { statementsEquivalent } from './statement-compare.ts';

const SIGNATURE_USAGE_TYPE = 'http://adlnet.gov/expapi/attachments/signature';
const ALLOWED_ALGORITHMS = new Set(['RS256', 'RS384', 'RS512']);

/** Module-level flag to log the "verification disabled" warning only once. */
let warnedDisabled = false;

interface AttachmentMeta {
  usageType: string;
  contentType: string;
  sha2: string;
  fileUrl?: string;
}

export interface SignatureValidationOptions {
  /** When true, perform payload equivalence and x5c cryptographic checks. */
  verifySignatures: boolean;
  /** Logger for warnings (e.g., when verification is disabled). */
  logger?: Logger;
}

export interface SignatureMetricsContext {
  metrics: LrsMetrics;
  tenantId: string;
}

/**
 * Validate JWS signatures on signed statement attachments.
 *
 * Structural checks (always performed):
 * 1. contentType must be "application/octet-stream"
 * 2. JWS must decode successfully
 * 3. Algorithm must be RS256, RS384, or RS512
 * 4. JWS payload must be valid JSON
 *
 * Cryptographic checks (when verifySignatures is true):
 * 5. Payload must be logically equivalent to received statement (§2.3.1)
 * 6. If x5c certificate present, verify JWS signature against it
 *
 * @throws HttpError 400 if any signature attachment is invalid
 */
export async function validateSignedStatements(
  statements: unknown[],
  attachmentParts: Map<string, MultipartAttachmentPart> | undefined,
  options?: SignatureValidationOptions,
  _metricsCtx?: SignatureMetricsContext,
): Promise<void> {
  const verifySignatures = options?.verifySignatures ?? false;

  for (const stmt of statements) {
    const s = stmt as Record<string, unknown>;
    const attachments = s.attachments as AttachmentMeta[] | undefined;
    if (!attachments) continue;

    for (const att of attachments) {
      if (att.usageType !== SIGNATURE_USAGE_TYPE) continue;

      // 1. Content-type must be application/octet-stream
      if (att.contentType !== 'application/octet-stream') {
        throw new HttpError(400, 'Signed statement attachment must have contentType "application/octet-stream"');
      }

      // 2. Locate binary part — skip if not provided (fileUrl-only)
      const part = attachmentParts?.get(att.sha2);
      if (!part) continue;

      const jwsString = part.data.toString('utf8');

      // 3. Decode and validate JWS header
      let header: { alg?: string; x5c?: string[] };
      try {
        header = decodeProtectedHeader(jwsString);
      } catch {
        throw new HttpError(400, 'Signature attachment is not a valid JWS');
      }

      // 4. Algorithm must be RS256, RS384, or RS512
      if (!header.alg || !ALLOWED_ALGORITHMS.has(header.alg)) {
        throw new HttpError(
          400,
          `JWS signature must use algorithm RS256, RS384, or RS512 (got "${header.alg ?? 'none'}")`,
        );
      }

      // 5. Payload must be valid JSON
      const jwsParts = jwsString.split('.');
      if (jwsParts.length !== 3) {
        throw new HttpError(400, 'Signature attachment is not a valid JWS compact serialization');
      }

      let signedPayload: Record<string, unknown>;
      try {
        const payloadBytes = base64url.decode(jwsParts[1]);
        signedPayload = JSON.parse(new TextDecoder().decode(payloadBytes));
      } catch {
        throw new HttpError(400, 'JWS payload is not valid JSON');
      }

      // --- Cryptographic checks (behind feature flag) ---

      if (!verifySignatures) {
        if (!warnedDisabled && options?.logger) {
          options.logger.warn(
            'Signed statement received but XAPI_VERIFY_SIGNATURES is disabled; skipping payload and cryptographic verification',
          );
          warnedDisabled = true;
        }
        continue;
      }

      // 6. Payload must be logically equivalent to received statement (§2.3.1)
      if (!statementsEquivalent(signedPayload, s)) {
        throw new HttpError(400, 'Signed statement payload is not logically equivalent to the received statement');
      }

      // 7. If x5c certificate present, verify JWS signature against it
      if (header.x5c && Array.isArray(header.x5c) && header.x5c.length > 0) {
        const certPem = `-----BEGIN CERTIFICATE-----\n${header.x5c[0]}\n-----END CERTIFICATE-----`;

        let publicKey: CryptoKey;
        try {
          publicKey = await importX509(certPem, header.alg);
        } catch {
          throw new HttpError(400, 'x5c certificate in JWS header could not be parsed');
        }

        try {
          await compactVerify(jwsString, publicKey);
        } catch {
          throw new HttpError(400, 'JWS signature does not verify against the x5c certificate');
        }
      }
    }
  }
}

/** Reset the module-level warning flag (for tests). */
export function _resetWarnedDisabled(): void {
  warnedDisabled = false;
}
