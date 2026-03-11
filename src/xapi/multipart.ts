/**
 * xAPI Multipart/Mixed Parser and Response Builder
 *
 * Handles the xAPI 1.0.3 multipart/mixed format for statement attachments:
 * - Parsing: first part is JSON statement(s), subsequent parts are binary attachments
 *   with X-Experience-API-Hash, Content-Type, and Content-Transfer-Encoding headers
 * - Response building: constructs multipart/mixed responses for GET ?attachments=true
 *
 * Reference: xAPI 1.0.3 Communication spec §1.5.2
 */

import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

// ============================================================================
// Types
// ============================================================================

export interface MultipartAttachmentPart {
  /** SHA-256 hash from the X-Experience-API-Hash header (hex) */
  sha2: string;
  /** Content-Type of this attachment part */
  contentType: string;
  /** Raw binary data */
  data: Buffer;
}

export interface MultipartParseResult {
  /** Parsed JSON body from the first part (statement or array of statements) */
  json: unknown;
  /** Attachment parts keyed by sha2 hash */
  attachments: Map<string, MultipartAttachmentPart>;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Extract the boundary string from a Content-Type header.
 * Handles both `boundary=value` and `boundary="quoted value"`.
 */
export function extractBoundary(contentType: string): string | null {
  // Quoted boundary: boundary="value"
  const quoted = /boundary="([^"]+)"/.exec(contentType);
  if (quoted) return quoted[1];
  // Unquoted boundary: everything after boundary= until end or semicolon
  const unquoted = /boundary=([^\s;]+)/.exec(contentType);
  return unquoted ? unquoted[1] : null;
}

/**
 * Parse a multipart/mixed xAPI request body.
 *
 * Per xAPI 1.0.3:
 * - First part MUST be application/json containing the statement(s)
 * - Subsequent parts contain raw attachment data with required headers:
 *   X-Experience-API-Hash, Content-Type, Content-Transfer-Encoding: binary
 *
 * @throws Error with message suitable for HTTP 400 response
 */
export function parseMultipartMixed(body: Buffer, boundary: string): MultipartParseResult {
  const delimiter = Buffer.from(`--${boundary}`);
  const closing = Buffer.from(`--${boundary}--`);

  // Find all boundary positions
  const positions: number[] = [];
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const idx = body.indexOf(delimiter, searchFrom);
    if (idx === -1) break;
    positions.push(idx);
    searchFrom = idx + delimiter.length;
  }

  if (positions.length < 2) {
    throw new Error('Malformed multipart body: insufficient boundary markers');
  }

  // Extract parts between boundaries
  const parts: Buffer[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i] + delimiter.length;
    const end = positions[i + 1];
    // Skip leading CRLF after boundary line
    const partBuf = body.subarray(start, end);
    parts.push(partBuf);
  }

  // Check if there's a final part after the last non-closing boundary
  const lastPos = positions[positions.length - 1];
  const lastDelim = body.subarray(lastPos, lastPos + closing.length);
  if (!lastDelim.equals(closing) && positions.length >= 2) {
    // The last boundary isn't a closing one — there may be content after it
    // But typically the last boundary IS the closing one, so parts are already complete
  }

  if (parts.length === 0) {
    throw new Error('Malformed multipart body: no parts found');
  }

  // Parse first part — must be application/json
  const firstPart = parsePartHeadersAndBody(parts[0]);
  const firstPartCT = firstPart.headers.get('content-type') ?? '';
  if (!firstPartCT.includes('application/json')) {
    throw new Error('First part of multipart/mixed must have Content-Type application/json');
  }
  let json: unknown;
  try {
    json = JSON.parse(firstPart.body.toString('utf8'));
  } catch {
    throw new Error('First part of multipart/mixed must be valid JSON');
  }

  // Parse subsequent parts — attachment binaries
  const attachments = new Map<string, MultipartAttachmentPart>();
  for (let i = 1; i < parts.length; i++) {
    const part = parsePartHeadersAndBody(parts[i]);
    const sha2 = part.headers.get('x-experience-api-hash');
    if (!sha2) {
      throw new Error(`Attachment part ${i + 1} missing X-Experience-API-Hash header`);
    }
    // xAPI 1.0.3 §1.5.2: attachment parts MUST have Content-Transfer-Encoding: binary
    const encoding = part.headers.get('content-transfer-encoding');
    if (encoding !== 'binary') {
      throw new Error(`Attachment part ${i + 1} must have Content-Transfer-Encoding: binary`);
    }
    const contentType = part.headers.get('content-type') ?? 'application/octet-stream';

    attachments.set(sha2, { sha2, contentType, data: part.body });
  }

  return { json, attachments };
}

/** Parse a single part into headers map and body buffer */
function parsePartHeadersAndBody(part: Buffer): { headers: Map<string, string>; body: Buffer } {
  // Parts start with optional CRLF, then headers, then CRLFCRLF, then body
  // Strip leading CRLF/LF
  let start = 0;
  if (part[start] === 0x0d && part[start + 1] === 0x0a) start += 2;
  else if (part[start] === 0x0a) start += 1;

  const headerEnd = findDoubleNewline(part, start);
  if (headerEnd === -1) {
    // No headers — entire part is body (shouldn't happen in valid multipart, but be defensive)
    return { headers: new Map(), body: part.subarray(start) };
  }

  const headerSection = part.subarray(start, headerEnd).toString('utf8');
  const bodyStart = part[headerEnd] === 0x0d ? headerEnd + 4 : headerEnd + 2; // skip CRLFCRLF or LFLF
  // Strip trailing CRLF from body (before next boundary)
  let bodyEnd = part.length;
  if (bodyEnd >= 2 && part[bodyEnd - 2] === 0x0d && part[bodyEnd - 1] === 0x0a) {
    bodyEnd -= 2;
  } else if (bodyEnd >= 1 && part[bodyEnd - 1] === 0x0a) {
    bodyEnd -= 1;
  }
  const body = part.subarray(bodyStart, bodyEnd);

  const headers = new Map<string, string>();
  for (const line of headerSection.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      headers.set(line.slice(0, colonIdx).trim().toLowerCase(), line.slice(colonIdx + 1).trim());
    }
  }

  return { headers, body };
}

/** Find the position of \r\n\r\n or \n\n in a buffer starting from offset */
function findDoubleNewline(buf: Buffer, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && i + 3 < buf.length && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
    if (buf[i] === 0x0a && buf[i + 1] === 0x0a) {
      return i;
    }
  }
  return -1;
}

// ============================================================================
// Response Builder
// ============================================================================

export interface ResponseAttachmentPart {
  sha2: string;
  contentType: string;
  stream: Readable;
}

/**
 * Build a multipart/mixed Web Response for GET /xapi/statements?attachments=true.
 * Framework-agnostic — returns a standard Web API Response.
 */
export async function buildMultipartResponse(
  jsonBody: unknown,
  attachmentParts: ResponseAttachmentPart[],
  statusCode: number = 200,
): Promise<globalThis.Response> {
  const boundary = randomUUID();
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  // Part 1: JSON
  chunks.push(encoder.encode(`--${boundary}\r\nContent-Type: application/json\r\n\r\n`));
  chunks.push(encoder.encode(JSON.stringify(jsonBody)));
  chunks.push(encoder.encode('\r\n'));

  // Subsequent parts: attachment binaries
  for (const part of attachmentParts) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Type: ${part.contentType}\r\nContent-Transfer-Encoding: binary\r\nX-Experience-API-Hash: ${part.sha2}\r\n\r\n`,
      ),
    );

    // Consume the Readable stream into a buffer
    const streamChunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      part.stream.on('data', (chunk: Buffer) => streamChunks.push(chunk));
      part.stream.on('end', resolve);
      part.stream.on('error', reject);
    });
    chunks.push(Buffer.concat(streamChunks));

    chunks.push(encoder.encode('\r\n'));
  }

  // Closing boundary
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  // Combine all chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new globalThis.Response(body, {
    status: statusCode,
    headers: {
      'Content-Type': `multipart/mixed; boundary=${boundary}`,
    },
  });
}
