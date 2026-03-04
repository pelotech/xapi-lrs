import { describe, expect, it } from 'vitest';
import { agentToIfi, computeEtag } from './agent-ifi.js';

describe('agentToIfi', () => {
  it('returns mbox IFI', () => {
    expect(agentToIfi({ mbox: 'mailto:user@example.com' })).toBe('mbox:mailto:user@example.com');
  });

  it('returns mbox_sha1sum IFI', () => {
    expect(agentToIfi({ mbox_sha1sum: 'abc123' })).toBe('mbox_sha1sum:abc123');
  });

  it('returns openid IFI', () => {
    expect(agentToIfi({ openid: 'https://example.com/user' })).toBe('openid:https://example.com/user');
  });

  it('returns account IFI with homePage|name format', () => {
    expect(agentToIfi({ account: { homePage: 'https://lms.example.com', name: 'jdoe' } }))
      .toBe('account:https://lms.example.com|jdoe');
  });

  it('prioritizes mbox over other IFIs', () => {
    expect(agentToIfi({
      mbox: 'mailto:user@example.com',
      openid: 'https://example.com/user',
    })).toBe('mbox:mailto:user@example.com');
  });

  it('throws for agent with no IFI', () => {
    expect(() => agentToIfi({ name: 'No IFI Agent' })).toThrow('Agent has no inverse functional identifier');
  });

  it('throws for empty agent object', () => {
    expect(() => agentToIfi({} as never)).toThrow('Agent has no inverse functional identifier');
  });
});

describe('computeEtag', () => {
  it('returns quoted SHA-1 hex digest', () => {
    const etag = computeEtag(Buffer.from('hello'));
    expect(etag).toMatch(/^"[a-f0-9]{40}"$/);
  });

  it('is deterministic', () => {
    const a = computeEtag(Buffer.from('same content'));
    const b = computeEtag(Buffer.from('same content'));
    expect(a).toBe(b);
  });

  it('produces different values for different content', () => {
    const a = computeEtag(Buffer.from('content-a'));
    const b = computeEtag(Buffer.from('content-b'));
    expect(a).not.toBe(b);
  });

  it('handles empty buffer', () => {
    const etag = computeEtag(Buffer.alloc(0));
    expect(etag).toMatch(/^"[a-f0-9]{40}"$/);
  });
});
