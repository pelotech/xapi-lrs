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
      // Auto-generated statement.id is produced by the uuidv7 package (not the
      // hand-rolled squuid()), so it must carry the UUIDv7 version nibble —
      // distinct from xapi_statement.id (the row PK), which stays a v4-nibble
      // squuid(). See statements.ts insertStatement / statement-decomposition
      // plan header "Verified upstream facts".
      expect(result.statement.id![14]).toBe('7');
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

  it('accepts a plain statement with no version arg (defaults to 1.0.3)', () => {
    const result = validateStatement(VALID_STMT);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Version-aware validation (xAPI 2.0 context agents/groups + version property)
// ---------------------------------------------------------------------------

describe('validateStatement — xAPI 2.0 context agents/groups', () => {
  const stmtWithContextAgents = {
    ...VALID_STMT,
    context: {
      contextAgents: [
        {
          objectType: 'contextAgent',
          agent: { objectType: 'Agent', mbox: 'mailto:a@example.com' },
          relevantTypes: ['http://example.com/t'],
        },
      ],
    },
  };

  const stmtWithContextGroups = {
    ...VALID_STMT,
    context: {
      contextGroups: [
        {
          objectType: 'contextGroup',
          group: {
            objectType: 'Group',
            mbox: 'mailto:g@example.com',
            member: [{ mbox: 'mailto:m1@example.com' }],
          },
          relevantTypes: ['http://example.com/t'],
        },
      ],
    },
  };

  it('accepts contextAgents under 2.0.0', () => {
    const result = validateStatement(stmtWithContextAgents, '2.0.0');
    expect(result.valid).toBe(true);
  });

  it('rejects contextAgents under 1.0.3', () => {
    const result = validateStatement(stmtWithContextAgents, '1.0.3');
    expect(result.valid).toBe(false);
  });

  it('accepts contextGroups under 2.0.0', () => {
    const result = validateStatement(stmtWithContextGroups, '2.0.0');
    expect(result.valid).toBe(true);
  });

  it('rejects contextGroups under 1.0.3', () => {
    const result = validateStatement(stmtWithContextGroups, '1.0.3');
    expect(result.valid).toBe(false);
  });

  it('accepts contextAgent without relevantTypes (optional) under 2.0.0', () => {
    const result = validateStatement(
      {
        ...VALID_STMT,
        context: {
          contextAgents: [{ objectType: 'contextAgent', agent: { objectType: 'Agent', mbox: 'mailto:a@example.com' } }],
        },
      },
      '2.0.0',
    );
    expect(result.valid).toBe(true);
  });

  it('rejects empty relevantTypes under 2.0.0', () => {
    const result = validateStatement(
      {
        ...VALID_STMT,
        context: {
          contextAgents: [
            {
              objectType: 'contextAgent',
              agent: { objectType: 'Agent', mbox: 'mailto:a@example.com' },
              relevantTypes: [],
            },
          ],
        },
      },
      '2.0.0',
    );
    expect(result.valid).toBe(false);
  });

  it('rejects non-IRI relevantTypes under 2.0.0', () => {
    const result = validateStatement(
      {
        ...VALID_STMT,
        context: {
          contextAgents: [
            {
              objectType: 'contextAgent',
              agent: { objectType: 'Agent', mbox: 'mailto:a@example.com' },
              relevantTypes: ['not-an-iri'],
            },
          ],
        },
      },
      '2.0.0',
    );
    expect(result.valid).toBe(false);
  });

  it('rejects wrong objectType on a context agent under 2.0.0', () => {
    const result = validateStatement(
      {
        ...VALID_STMT,
        context: {
          contextAgents: [{ objectType: 'wrong', agent: { objectType: 'Agent', mbox: 'mailto:a@example.com' } }],
        },
      },
      '2.0.0',
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a bad agent object on a context agent under 2.0.0', () => {
    const result = validateStatement(
      {
        ...VALID_STMT,
        context: {
          contextAgents: [{ objectType: 'contextAgent', agent: { objectType: 'Agent', name: 'no ifi' } }],
        },
      },
      '2.0.0',
    );
    expect(result.valid).toBe(false);
  });

  it('accepts substatement contextAgents under 2.0.0', () => {
    const result = validateStatement(
      {
        ...VALID_STMT,
        object: {
          objectType: 'SubStatement',
          actor: { mbox: 'mailto:sub@example.com' },
          verb: { id: 'http://example.com/verbs/did' },
          object: { id: 'http://example.com/activities/sub' },
          context: {
            contextAgents: [
              { objectType: 'contextAgent', agent: { objectType: 'Agent', mbox: 'mailto:a@example.com' } },
            ],
          },
        },
      },
      '2.0.0',
    );
    expect(result.valid).toBe(true);
  });

  it('rejects substatement contextAgents under 1.0.3', () => {
    const result = validateStatement(
      {
        ...VALID_STMT,
        object: {
          objectType: 'SubStatement',
          actor: { mbox: 'mailto:sub@example.com' },
          verb: { id: 'http://example.com/verbs/did' },
          object: { id: 'http://example.com/activities/sub' },
          context: {
            contextAgents: [
              { objectType: 'contextAgent', agent: { objectType: 'Agent', mbox: 'mailto:a@example.com' } },
            ],
          },
        },
      },
      '1.0.3',
    );
    expect(result.valid).toBe(false);
  });
});

describe('validateStatement — version property', () => {
  it('accepts version 2.0.0 under 2.0.0', () => {
    const result = validateStatement({ ...VALID_STMT, version: '2.0.0' }, '2.0.0');
    expect(result.valid).toBe(true);
  });

  it('rejects version 2.0.0 under 1.0.3', () => {
    const result = validateStatement({ ...VALID_STMT, version: '2.0.0' }, '1.0.3');
    expect(result.valid).toBe(false);
  });

  it('accepts version 1.0.3 under both versions (2.0 request may carry a 1.0 statement)', () => {
    expect(validateStatement({ ...VALID_STMT, version: '1.0.3' }, '2.0.0').valid).toBe(true);
    expect(validateStatement({ ...VALID_STMT, version: '1.0.3' }, '1.0.3').valid).toBe(true);
  });

  it('rejects version 3.0.0 under both versions', () => {
    expect(validateStatement({ ...VALID_STMT, version: '3.0.0' }, '2.0.0').valid).toBe(false);
    expect(validateStatement({ ...VALID_STMT, version: '3.0.0' }, '1.0.3').valid).toBe(false);
  });

  it('still rejects version 1.1.0 under 2.0.0 (widened regex is not any-1.x)', () => {
    expect(validateStatement({ ...VALID_STMT, version: '1.1.0' }, '2.0.0').valid).toBe(false);
  });

  it('still rejects version 0.9.9 under 2.0.0', () => {
    expect(validateStatement({ ...VALID_STMT, version: '0.9.9' }, '2.0.0').valid).toBe(false);
  });
});
