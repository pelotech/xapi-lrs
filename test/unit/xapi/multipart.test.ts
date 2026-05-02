import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { extractBoundary, parseMultipartMixed, buildMultipartResponse } from '../../../src/xapi/multipart.ts';

// ---------------------------------------------------------------------------
// extractBoundary
// ---------------------------------------------------------------------------

describe('extractBoundary', () => {
  it('parses unquoted boundary', () => {
    expect(extractBoundary('multipart/mixed; boundary=abc123')).toBe('abc123');
  });

  it('parses quoted boundary', () => {
    expect(extractBoundary('multipart/mixed; boundary="abc 123"')).toBe('abc 123');
  });

  it('returns null for missing boundary', () => {
    expect(extractBoundary('application/json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractBoundary('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMultipartMixed
// ---------------------------------------------------------------------------

function buildMultipartBody(boundary: string, parts: { headers: string; body: string | Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(part.headers));
    chunks.push(Buffer.from('\r\n\r\n'));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

describe('parseMultipartMixed', () => {
  const boundary = 'test-boundary';

  it('parses valid multipart with JSON and attachment', () => {
    const body = buildMultipartBody(boundary, [
      {
        headers: 'Content-Type: application/json',
        body: JSON.stringify({ actor: { mbox: 'mailto:a@b.com' } }),
      },
      {
        headers:
          'Content-Type: application/octet-stream\r\nX-Experience-API-Hash: abc123\r\nContent-Transfer-Encoding: binary',
        body: 'binary-data',
      },
    ]);
    const result = parseMultipartMixed(body, boundary);
    expect(result.json).toEqual({ actor: { mbox: 'mailto:a@b.com' } });
    expect(result.attachments.size).toBe(1);
    const att = result.attachments.get('abc123')!;
    expect(att.sha2).toBe('abc123');
    expect(att.contentType).toBe('application/octet-stream');
    expect(att.data.toString()).toBe('binary-data');
  });

  it('throws on empty body', () => {
    expect(() => parseMultipartMixed(Buffer.from(''), boundary)).toThrow();
  });

  it('throws when first part is not JSON', () => {
    const body = buildMultipartBody(boundary, [
      {
        headers: 'Content-Type: text/plain',
        body: 'not json',
      },
    ]);
    expect(() => parseMultipartMixed(body, boundary)).toThrow('application/json');
  });

  it('handles LF line endings', () => {
    // Build with LF instead of CRLF
    const raw = `--${boundary}\nContent-Type: application/json\n\n{"id":"1"}\n--${boundary}--\n`;
    const result = parseMultipartMixed(Buffer.from(raw), boundary);
    expect(result.json).toEqual({ id: '1' });
  });

  it('throws on attachment without hash', () => {
    const body = buildMultipartBody(boundary, [
      {
        headers: 'Content-Type: application/json',
        body: '{}',
      },
      {
        headers: 'Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: binary',
        body: 'data',
      },
    ]);
    expect(() => parseMultipartMixed(body, boundary)).toThrow('X-Experience-API-Hash');
  });
});

// ---------------------------------------------------------------------------
// buildMultipartResponse
// ---------------------------------------------------------------------------

describe('buildMultipartResponse', () => {
  it('produces Response with multipart/mixed content-type', async () => {
    const resp = await buildMultipartResponse({ statements: [] }, []);
    expect(resp.headers.get('Content-Type')).toMatch(/^multipart\/mixed; boundary=/);
  });

  it('JSON part comes first, attachment parts follow', async () => {
    const stream = Readable.from([Buffer.from('attachment-data')]);
    const resp = await buildMultipartResponse({ id: '1' }, [{ sha2: 'hash1', contentType: 'application/pdf', stream }]);
    const text = await resp.text();
    const jsonIdx = text.indexOf('application/json');
    const attIdx = text.indexOf('application/pdf');
    expect(jsonIdx).toBeLessThan(attIdx);
  });

  it('attachment parts have correct headers', async () => {
    const stream = Readable.from([Buffer.from('data')]);
    const resp = await buildMultipartResponse({}, [{ sha2: 'myhash', contentType: 'image/png', stream }]);
    const text = await resp.text();
    expect(text).toContain('X-Experience-API-Hash: myhash');
    expect(text).toContain('Content-Transfer-Encoding: binary');
    expect(text).toContain('Content-Type: image/png');
  });
});
