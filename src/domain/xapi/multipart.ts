/**
 * xAPI 1.0.3 multipart/mixed parsing and building.
 *
 * §4.1.11: Statements that include attachments with raw data use
 * multipart/mixed content type. The first part is always the statement
 * JSON (application/json). Subsequent parts are binary attachment data
 * identified by X-Experience-API-Hash (SHA-256 hex).
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MultipartPart {
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export interface ParsedMultipartRequest {
  readonly json: Buffer;
  readonly jsonContentType: string;
  readonly attachments: ReadonlyArray<{
    readonly sha2: string;
    readonly contentType: string;
    readonly transferEncoding: string;
    readonly content: Buffer;
  }>;
}

export interface AttachmentBlob {
  readonly sha2: string;
  readonly contentType: string;
  readonly content: Buffer;
}

// ---------------------------------------------------------------------------
// Parse multipart/mixed
// ---------------------------------------------------------------------------

/**
 * Extract boundary string from a Content-Type header.
 * E.g. "multipart/mixed; boundary=-------314159265358979323846"
 */
export function extractBoundary(contentType: string): string | null {
  const match = /boundary=([^\s;]+)/i.exec(contentType);
  return match ? match[1]! : null;
}

/**
 * Parse a raw multipart/mixed body into its constituent parts.
 * Handles CRLF and LF line endings.
 */
export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const closeDelimiter = Buffer.from(`--${boundary}--`);
  const parts: MultipartPart[] = [];

  // Find all delimiter positions
  let pos = 0;
  const positions: number[] = [];
  while (pos < body.length) {
    const idx = body.indexOf(delimiter, pos);
    if (idx === -1) break;
    positions.push(idx);
    pos = idx + delimiter.length;
  }

  // Each pair of consecutive delimiter positions bounds a part
  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i]! + delimiter.length;
    const end = positions[i + 1]!;

    // Skip the CRLF/LF after the delimiter
    let partStart = start;
    if (body[partStart] === 0x0d && body[partStart + 1] === 0x0a) partStart += 2;
    else if (body[partStart] === 0x0a) partStart += 1;

    // Trim trailing CRLF/LF before the next delimiter
    let partEnd = end;
    if (body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) partEnd -= 2;
    else if (body[partEnd - 1] === 0x0a) partEnd -= 1;

    // Check if this is the closing delimiter
    if (body.subarray(end, end + closeDelimiter.length).equals(closeDelimiter)) {
      // Don't include anything after the close
    }

    const partBuf = body.subarray(partStart, partEnd);
    const part = parseSinglePart(partBuf);
    if (part) parts.push(part);
  }

  return parts;
}

function parseSinglePart(buf: Buffer): MultipartPart | null {
  // Find the blank line separating headers from body
  // Try CRLFCRLF first, then LFLF
  let headerEnd = buf.indexOf('\r\n\r\n');
  let bodyStart: number;
  if (headerEnd !== -1) {
    bodyStart = headerEnd + 4;
  } else {
    headerEnd = buf.indexOf('\n\n');
    if (headerEnd !== -1) {
      bodyStart = headerEnd + 2;
    } else {
      return null;
    }
  }

  const headerStr = buf.subarray(0, headerEnd).toString('utf8');
  const headers: Record<string, string> = {};
  for (const line of headerStr.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const val = line.substring(colonIdx + 1).trim();
      headers[key] = val;
    }
  }

  const body = buf.subarray(bodyStart);
  return { headers, body };
}

/**
 * Parse a multipart/mixed xAPI request.
 * First part = JSON statement(s), remaining parts = attachment blobs.
 */
export function parseMultipartRequest(body: Buffer, boundary: string): ParsedMultipartRequest {
  const parts = parseMultipart(body, boundary);
  if (parts.length === 0) {
    throw new Error('No parts found in multipart body');
  }

  const jsonPart = parts[0]!;
  const jsonContentType = jsonPart.headers['content-type'] ?? '';
  const attachments = parts.slice(1).map((part) => {
    const sha2 = part.headers['x-experience-api-hash'] ?? '';
    const contentType = part.headers['content-type'] ?? 'application/octet-stream';
    const transferEncoding = part.headers['content-transfer-encoding'] ?? '';
    return { sha2, contentType, transferEncoding, content: part.body };
  });

  return { json: jsonPart.body, jsonContentType, attachments };
}

// ---------------------------------------------------------------------------
// Build multipart/mixed response
// ---------------------------------------------------------------------------

/**
 * Build a multipart/mixed response body from JSON + attachment blobs.
 */
export function buildMultipartResponse(
  json: Buffer,
  attachments: readonly AttachmentBlob[],
): { body: Buffer; boundary: string } {
  const boundary = crypto.randomUUID();
  const CRLF = '\r\n';
  const parts: Buffer[] = [];

  // JSON part
  parts.push(Buffer.from(`--${boundary}${CRLF}`));
  parts.push(Buffer.from(`Content-Type:application/json${CRLF}`));
  parts.push(Buffer.from(CRLF));
  parts.push(json);
  parts.push(Buffer.from(CRLF));

  // Attachment parts
  for (const att of attachments) {
    parts.push(Buffer.from(`--${boundary}${CRLF}`));
    parts.push(Buffer.from(`Content-Type:${att.contentType}${CRLF}`));
    parts.push(Buffer.from(`Content-Transfer-Encoding:binary${CRLF}`));
    parts.push(Buffer.from(`X-Experience-API-Hash:${att.sha2}${CRLF}`));
    parts.push(Buffer.from(CRLF));
    parts.push(att.content);
    parts.push(Buffer.from(CRLF));
  }

  // Close boundary
  parts.push(Buffer.from(`--${boundary}--${CRLF}`));

  return { body: Buffer.concat(parts), boundary };
}
