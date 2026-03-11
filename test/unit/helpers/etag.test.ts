import { describe, it, expect } from 'vitest';
import { computeEtag } from '../../../src/helpers/etag.ts';

describe('computeEtag', () => {
  it('returns a hex SHA-1 hash for a buffer', () => {
    const etag = computeEtag(Buffer.from('hello world'));
    expect(etag).toMatch(/^[0-9a-f]{40}$/);
  });

  it('produces deterministic output', () => {
    const a = computeEtag(Buffer.from('test'));
    const b = computeEtag(Buffer.from('test'));
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = computeEtag(Buffer.from('input-a'));
    const b = computeEtag(Buffer.from('input-b'));
    expect(a).not.toBe(b);
  });
});
