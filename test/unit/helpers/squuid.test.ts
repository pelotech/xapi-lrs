import { describe, expect, test } from 'vitest';
import { squuid, squuidMin, squuidTimestamp } from '../../../src/helpers/squuid.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('squuid', () => {
  test('returns a valid UUID-format string', () => {
    expect(squuid()).toMatch(UUID_RE);
  });

  test('preserves v4 version nibble', () => {
    const id = squuid();
    expect(id[14]).toBe('4');
  });

  test('embeds the given timestamp (round-trip via squuidTimestamp)', () => {
    const now = 1_700_000_000_000;
    const id = squuid(now);
    expect(squuidTimestamp(id)).toBe(now);
  });

  test('squuids from consecutive milliseconds sort lexicographically', () => {
    const a = squuid(1_700_000_000_000);
    const b = squuid(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  test('squuids within the same millisecond differ in random suffix', () => {
    const now = Date.now();
    const a = squuid(now);
    const b = squuid(now);
    expect(a).not.toBe(b);
    // First 13 chars (timestamp portion) are identical
    expect(a.slice(0, 13)).toBe(b.slice(0, 13));
  });
});

describe('squuidMin', () => {
  test('returns a valid UUID-format string', () => {
    expect(squuidMin(Date.now())).toMatch(UUID_RE);
  });

  test('has all-zero random/version bits', () => {
    const id = squuidMin(1_700_000_000_000);
    expect(id).toMatch(/-0000-0000-000000000000$/);
  });

  test('sorts before any real squuid at the same millisecond', () => {
    const now = 1_700_000_000_000;
    const min = squuidMin(now);
    // Any real squuid has random bits > 0, so it must sort after min
    for (let i = 0; i < 10; i++) {
      expect(min < squuid(now)).toBe(true);
    }
  });
});

describe('squuidTimestamp', () => {
  test('extracts correct millis from a squuid', () => {
    const ts = 1_700_000_000_000;
    expect(squuidTimestamp(squuid(ts))).toBe(ts);
  });

  test('extracts correct millis from a squuidMin', () => {
    const ts = 1_700_000_000_000;
    expect(squuidTimestamp(squuidMin(ts))).toBe(ts);
  });
});
