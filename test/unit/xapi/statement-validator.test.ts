import { describe, it, expect } from 'vitest';
import { validateStatement } from '../../../src/xapi/statement-validator.ts';

const VALID_STMT = {
  actor: { mbox: 'mailto:test@example.com' },
  verb: { id: 'http://example.com/verbs/completed', display: { 'en-US': 'completed' } },
  object: { id: 'http://example.com/activities/1', objectType: 'Activity' },
};

describe('validateStatement', () => {
  it('accepts a minimal valid statement', () => {
    const result = validateStatement(VALID_STMT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.statement.actor).toMatchObject({ mbox: 'mailto:test@example.com' });
      expect(result.statement.id).toBeDefined();
      expect(result.statement.timestamp).toBeDefined();
    }
  });

  it('preserves client-provided id and timestamp', () => {
    const stmt = {
      ...VALID_STMT,
      id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const result = validateStatement(stmt);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.statement.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.statement.timestamp).toBe('2024-01-01T00:00:00Z');
    }
  });

  it('auto-generates id when absent', () => {
    const result = validateStatement(VALID_STMT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.statement.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('auto-generates timestamp when absent', () => {
    const result = validateStatement(VALID_STMT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.statement.timestamp).toBeDefined();
      expect(new Date(result.statement.timestamp!).getTime()).not.toBeNaN();
    }
  });

  it('rejects a non-object input', () => {
    const result = validateStatement('not an object');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].message).toContain('JSON object');
    }
  });

  it('rejects null values (except in extensions)', () => {
    const result = validateStatement({
      ...VALID_STMT,
      result: { response: null },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path.startsWith('result'))).toBe(true);
    }
  });

  it('allows null values inside extensions', () => {
    const result = validateStatement({
      ...VALID_STMT,
      result: { extensions: { 'http://example.com/ext': null } },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects nested SubStatements', () => {
    const result = validateStatement({
      ...VALID_STMT,
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:sub@example.com' },
        verb: { id: 'http://example.com/verbs/did' },
        object: {
          objectType: 'SubStatement',
          actor: { mbox: 'mailto:deep@example.com' },
          verb: { id: 'http://example.com/verbs/did' },
          object: { id: 'http://example.com/activities/deep' },
        },
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path.startsWith('object'))).toBe(true);
    }
  });

  describe('timestamp offset validation (xAPI 1.0.3 Data 4.5)', () => {
    it('rejects a statement timestamp with -00:00 offset (with millis)', () => {
      const result = validateStatement({ ...VALID_STMT, timestamp: '2013-05-18T05:32:34.804-00:00' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.path === 'timestamp')).toBe(true);
      }
    });

    it('rejects a statement timestamp with -00:00 offset (without millis)', () => {
      const result = validateStatement({ ...VALID_STMT, timestamp: '2013-05-18T05:32:34-00:00' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.path === 'timestamp')).toBe(true);
      }
    });

    it('rejects a substatement timestamp with -00:00 offset', () => {
      const result = validateStatement({
        ...VALID_STMT,
        object: {
          objectType: 'SubStatement',
          actor: { mbox: 'mailto:sub@example.com' },
          verb: { id: 'http://example.com/verbs/did' },
          object: { id: 'http://example.com/activities/sub' },
          timestamp: '2013-05-18T05:32:34.804-00:00',
        },
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.path.includes('timestamp'))).toBe(true);
      }
    });

    it('accepts a substatement timestamp with a normal offset', () => {
      const result = validateStatement({
        ...VALID_STMT,
        object: {
          objectType: 'SubStatement',
          actor: { mbox: 'mailto:sub@example.com' },
          verb: { id: 'http://example.com/verbs/did' },
          object: { id: 'http://example.com/activities/sub' },
          timestamp: '2013-05-18T05:32:34.804+02:00',
        },
      });
      expect(result.valid).toBe(true);
    });

    it.each([
      '2013-05-18T05:32:34.804+00:00',
      '2013-05-18T05:32:34.804Z',
      '2013-05-18T05:32:34.804+02:00',
      '2013-05-18T05:32:34.804-07:00',
      '2013-05-18T05:32:34+00:00',
    ])('accepts timestamp %s', (timestamp) => {
      const result = validateStatement({ ...VALID_STMT, timestamp });
      expect(result.valid).toBe(true);
    });
  });

  it('strips stored and authority from output', () => {
    const result = validateStatement({
      ...VALID_STMT,
      stored: '2024-01-01T00:00:00Z',
      authority: { mbox: 'mailto:auth@example.com' },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      const stmt = result.statement as unknown as Record<string, unknown>;
      expect(stmt.stored).toBeUndefined();
      expect(stmt.authority).toBeUndefined();
    }
  });
});
