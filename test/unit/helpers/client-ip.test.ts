import { describe, it, expect } from 'vitest';
import { resolveClientIp } from '../../../src/helpers/client-ip.ts';

describe('resolveClientIp', () => {
  it('returns "unknown" for undefined header with 0 hops', () => {
    expect(resolveClientIp(undefined, 0)).toBe('unknown');
  });

  it('returns the single IP with 1 hop', () => {
    expect(resolveClientIp('1.1.1.1', 1)).toBe('1.1.1.1');
  });

  it('returns rightmost non-proxy IP with 1 hop', () => {
    expect(resolveClientIp('1.1.1.1, 2.2.2.2, 3.3.3.3', 1)).toBe('2.2.2.2');
  });

  it('returns second from right with 2 hops', () => {
    expect(resolveClientIp('1.1.1.1, 2.2.2.2, 3.3.3.3', 2)).toBe('1.1.1.1');
  });

  it('returns leftmost when hops exceed chain length', () => {
    expect(resolveClientIp('1.1.1.1, 2.2.2.2', 5)).toBe('1.1.1.1');
  });

  it('trims whitespace in chain values', () => {
    expect(resolveClientIp('  1.1.1.1 ,  2.2.2.2 ', 1)).toBe('1.1.1.1');
  });

  it('returns leftmost IP with 0 hops (legacy)', () => {
    expect(resolveClientIp('1.1.1.1, 2.2.2.2, 3.3.3.3', 0)).toBe('1.1.1.1');
  });
});
