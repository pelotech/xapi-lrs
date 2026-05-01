import { describe, it, expect } from 'vitest';
import { statementsEquivalent } from '../../../src/xapi/statement-compare.ts';

describe('statementsEquivalent', () => {
  const base = {
    actor: { mbox: 'mailto:test@example.com' },
    verb: { id: 'http://example.com/verbs/did' },
    object: { id: 'http://example.com/activities/1' },
  };

  it('returns true for identical statements', () => {
    expect(statementsEquivalent(base, { ...base })).toBe(true);
  });

  it('ignores id, authority, stored, timestamp, version, attachments differences', () => {
    const signed = { ...base };
    const received = {
      ...base,
      id: '12345678-1234-1234-1234-123456789abc',
      authority: { mbox: 'mailto:lrs@example.com' },
      stored: '2024-01-01T00:00:00Z',
      timestamp: '2024-01-01T00:00:00Z',
      version: '1.0.3',
      attachments: [{ sha2: 'abc' }],
    };
    expect(statementsEquivalent(signed, received)).toBe(true);
  });

  it('returns false when non-exception fields differ', () => {
    const received = {
      ...base,
      verb: { id: 'http://example.com/verbs/different' },
    };
    expect(statementsEquivalent(base, received)).toBe(false);
  });

  it('handles nested objects', () => {
    const a = { ...base, result: { score: { raw: 85, max: 100 } } };
    const b = { ...base, result: { score: { raw: 85, max: 100 } } };
    expect(statementsEquivalent(a, b)).toBe(true);
  });

  it('handles arrays', () => {
    const a = { ...base, context: { contextActivities: { parent: [{ id: 'http://a.com' }] } } };
    const b = { ...base, context: { contextActivities: { parent: [{ id: 'http://a.com' }] } } };
    expect(statementsEquivalent(a, b)).toBe(true);
  });
});
