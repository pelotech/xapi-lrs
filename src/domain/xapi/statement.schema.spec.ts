import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { statementSchema, statementBatchSchema } from './statement.schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function valid(data: unknown) {
  const result = z.safeParse(statementSchema, data);
  if (!result.success) {
    throw new Error(`Expected valid but got errors:\n${JSON.stringify(result.error.issues, null, 2)}`);
  }
  return result.data;
}

function invalid(data: unknown) {
  const result = z.safeParse(statementSchema, data);
  expect(result.success).toBe(false);
  return result;
}

/** Minimal valid statement. */
function minimal(overrides?: Record<string, unknown>) {
  return {
    actor: { mbox: 'mailto:user@example.com' },
    verb: { id: 'http://example.com/verbs/did' },
    object: { id: 'http://example.com/activities/1' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Statement (top-level)
// ---------------------------------------------------------------------------

describe('statementSchema', () => {
  it('accepts a minimal valid statement', () => {
    const data = valid(minimal());
    expect((data as { actor: { mbox: string } }).actor.mbox).toBe('mailto:user@example.com');
  });

  it('accepts a statement with a UUID id', () => {
    valid(minimal({ id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }));
  });

  it('rejects a statement with an invalid id', () => {
    invalid(minimal({ id: 'not-a-uuid' }));
  });

  it('accepts a statement with timestamp', () => {
    valid(minimal({ timestamp: '2024-01-15T10:30:00.000Z' }));
  });

  it('rejects a statement with invalid timestamp', () => {
    invalid(minimal({ timestamp: 'not-a-timestamp' }));
  });

  it('rejects a statement without actor', () => {
    invalid({
      verb: { id: 'http://example.com/verbs/did' },
      object: { id: 'http://example.com/activities/1' },
    });
  });

  it('rejects a statement without verb', () => {
    invalid({
      actor: { mbox: 'mailto:user@example.com' },
      object: { id: 'http://example.com/activities/1' },
    });
  });

  it('rejects a statement without object', () => {
    invalid({
      actor: { mbox: 'mailto:user@example.com' },
      verb: { id: 'http://example.com/verbs/did' },
    });
  });
});

// ---------------------------------------------------------------------------
// Actor / Agent
// ---------------------------------------------------------------------------

describe('statementSchema — actor (Agent)', () => {
  it('accepts agent with mbox', () => {
    valid(minimal({ actor: { mbox: 'mailto:test@example.com' } }));
  });

  it('accepts agent with mbox_sha1sum', () => {
    valid(minimal({ actor: { mbox_sha1sum: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3' } }));
  });

  it('accepts agent with openid', () => {
    valid(minimal({ actor: { openid: 'https://example.com/user/123' } }));
  });

  it('accepts agent with account', () => {
    valid(minimal({ actor: { account: { homePage: 'https://lms.example.com', name: 'jdoe' } } }));
  });

  it('rejects agent with no IFI', () => {
    invalid(minimal({ actor: { name: 'No IFI' } }));
  });

  it('rejects agent with two IFIs', () => {
    invalid(minimal({
      actor: {
        mbox: 'mailto:user@example.com',
        openid: 'https://example.com/user/123',
      },
    }));
  });

  it('rejects mbox without mailto:', () => {
    invalid(minimal({ actor: { mbox: 'user@example.com' } }));
  });

  it('rejects invalid mbox_sha1sum (too short)', () => {
    invalid(minimal({ actor: { mbox_sha1sum: 'abc123' } }));
  });

  it('accepts agent with objectType Agent', () => {
    valid(minimal({ actor: { objectType: 'Agent', mbox: 'mailto:x@x.com' } }));
  });
});

// ---------------------------------------------------------------------------
// Actor / Group
// ---------------------------------------------------------------------------

describe('statementSchema — actor (Group)', () => {
  it('accepts identified group with mbox', () => {
    valid(minimal({
      actor: {
        objectType: 'Group',
        mbox: 'mailto:group@example.com',
      },
    }));
  });

  it('accepts identified group with members', () => {
    valid(minimal({
      actor: {
        objectType: 'Group',
        mbox: 'mailto:group@example.com',
        member: [{ mbox: 'mailto:a@example.com' }],
      },
    }));
  });

  it('accepts anonymous group with members', () => {
    valid(minimal({
      actor: {
        objectType: 'Group',
        member: [{ mbox: 'mailto:a@example.com' }],
      },
    }));
  });

  it('rejects anonymous group without members', () => {
    invalid(minimal({
      actor: { objectType: 'Group' },
    }));
  });

  it('rejects anonymous group with empty members', () => {
    invalid(minimal({
      actor: {
        objectType: 'Group',
        member: [],
      },
    }));
  });
});

// ---------------------------------------------------------------------------
// Verb
// ---------------------------------------------------------------------------

describe('statementSchema — verb', () => {
  it('accepts verb with IRI id', () => {
    valid(minimal({ verb: { id: 'http://adlnet.gov/expapi/verbs/completed' } }));
  });

  it('accepts verb with display', () => {
    valid(minimal({
      verb: {
        id: 'http://adlnet.gov/expapi/verbs/completed',
        display: { 'en-US': 'completed' },
      },
    }));
  });

  it('rejects verb with empty id', () => {
    invalid(minimal({ verb: { id: '' } }));
  });

  it('rejects verb with non-IRI id', () => {
    invalid(minimal({ verb: { id: 'just-a-word' } }));
  });
});

// ---------------------------------------------------------------------------
// Object — Activity
// ---------------------------------------------------------------------------

describe('statementSchema — object (Activity)', () => {
  it('accepts activity with IRI id', () => {
    valid(minimal({ object: { id: 'http://example.com/activities/1' } }));
  });

  it('accepts activity with definition', () => {
    valid(minimal({
      object: {
        id: 'http://example.com/activities/1',
        definition: {
          name: { 'en-US': 'Test Activity' },
          description: { 'en-US': 'A test' },
          type: 'http://example.com/types/assessment',
        },
      },
    }));
  });

  it('accepts activity with interaction type', () => {
    valid(minimal({
      object: {
        id: 'http://example.com/activities/1',
        definition: {
          interactionType: 'choice',
          choices: [
            { id: 'a', description: { 'en-US': 'Option A' } },
            { id: 'b', description: { 'en-US': 'Option B' } },
          ],
          correctResponsesPattern: ['a'],
        },
      },
    }));
  });

  it('rejects activity with invalid interaction type', () => {
    invalid(minimal({
      object: {
        id: 'http://example.com/activities/1',
        definition: { interactionType: 'invalid-type' },
      },
    }));
  });
});

// ---------------------------------------------------------------------------
// Object — StatementRef
// ---------------------------------------------------------------------------

describe('statementSchema — object (StatementRef)', () => {
  it('accepts StatementRef with UUID', () => {
    valid(minimal({
      object: {
        objectType: 'StatementRef',
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      },
    }));
  });

  it('rejects StatementRef with invalid UUID', () => {
    invalid(minimal({
      object: { objectType: 'StatementRef', id: 'not-a-uuid' },
    }));
  });
});

// ---------------------------------------------------------------------------
// Object — SubStatement
// ---------------------------------------------------------------------------

describe('statementSchema — object (SubStatement)', () => {
  it('accepts a valid SubStatement', () => {
    valid(minimal({
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:inner@example.com' },
        verb: { id: 'http://example.com/verbs/attempted' },
        object: { id: 'http://example.com/activities/inner' },
      },
    }));
  });

  it('accepts SubStatement with result and context', () => {
    valid(minimal({
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:inner@example.com' },
        verb: { id: 'http://example.com/verbs/completed' },
        object: { id: 'http://example.com/activities/inner' },
        result: { score: { scaled: 0.95 }, completion: true },
        context: { registration: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
      },
    }));
  });

  it('rejects SubStatement without actor', () => {
    invalid(minimal({
      object: {
        objectType: 'SubStatement',
        verb: { id: 'http://example.com/verbs/attempted' },
        object: { id: 'http://example.com/activities/inner' },
      },
    }));
  });
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

describe('statementSchema — result', () => {
  it('accepts result with score', () => {
    valid(minimal({
      result: { score: { scaled: 0.75, raw: 75, min: 0, max: 100 } },
    }));
  });

  it('accepts result with success and completion', () => {
    valid(minimal({
      result: { success: true, completion: true },
    }));
  });

  it('accepts result with duration', () => {
    valid(minimal({
      result: { duration: 'PT1H30M' },
    }));
  });

  it('rejects invalid duration', () => {
    invalid(minimal({
      result: { duration: 'not-a-duration' },
    }));
  });

  it('rejects scaled score > 1', () => {
    invalid(minimal({
      result: { score: { scaled: 1.5 } },
    }));
  });

  it('rejects scaled score < -1', () => {
    invalid(minimal({
      result: { score: { scaled: -1.5 } },
    }));
  });

  it('rejects raw < min', () => {
    invalid(minimal({
      result: { score: { raw: -5, min: 0, max: 100 } },
    }));
  });

  it('rejects raw > max', () => {
    invalid(minimal({
      result: { score: { raw: 150, min: 0, max: 100 } },
    }));
  });

  it('rejects min > max', () => {
    invalid(minimal({
      result: { score: { min: 100, max: 0 } },
    }));
  });

  it('accepts result with extensions', () => {
    valid(minimal({
      result: {
        extensions: { 'http://example.com/ext/time-on-task': 120 },
      },
    }));
  });
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

describe('statementSchema — context', () => {
  it('accepts context with registration', () => {
    valid(minimal({
      context: { registration: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
    }));
  });

  it('rejects invalid registration UUID', () => {
    invalid(minimal({
      context: { registration: 'not-a-uuid' },
    }));
  });

  it('accepts context with contextActivities', () => {
    valid(minimal({
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/activities/course' }],
          grouping: [{ id: 'http://example.com/activities/program' }],
        },
      },
    }));
  });

  it('accepts context with instructor', () => {
    valid(minimal({
      context: {
        instructor: { mbox: 'mailto:instructor@example.com' },
      },
    }));
  });

  it('accepts context with team (Group)', () => {
    valid(minimal({
      context: {
        team: {
          objectType: 'Group',
          mbox: 'mailto:team@example.com',
        },
      },
    }));
  });

  it('accepts context with statement ref', () => {
    valid(minimal({
      context: {
        statement: {
          objectType: 'StatementRef',
          id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        },
      },
    }));
  });
});

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

describe('statementSchema — attachments', () => {
  it('accepts statement with attachments', () => {
    valid(minimal({
      attachments: [
        {
          usageType: 'http://example.com/attachment-usage/test',
          display: { 'en-US': 'Test Attachment' },
          contentType: 'application/pdf',
          length: 1024,
          sha2: 'abc123def456',
          fileUrl: 'https://example.com/files/test.pdf',
        },
      ],
    }));
  });

  it('rejects attachment without display', () => {
    invalid(minimal({
      attachments: [
        {
          usageType: 'http://example.com/attachment-usage/test',
          contentType: 'application/pdf',
          length: 1024,
          sha2: 'abc123def456',
        },
      ],
    }));
  });

  it('rejects attachment with negative length', () => {
    invalid(minimal({
      attachments: [
        {
          usageType: 'http://example.com/attachment-usage/test',
          display: { 'en-US': 'Test' },
          contentType: 'application/pdf',
          length: -1,
          sha2: 'abc123def456',
        },
      ],
    }));
  });
});

// ---------------------------------------------------------------------------
// Voiding
// ---------------------------------------------------------------------------

describe('statementSchema — voiding', () => {
  it('accepts voiding statement targeting a StatementRef', () => {
    valid({
      actor: { mbox: 'mailto:admin@example.com' },
      verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
      object: {
        objectType: 'StatementRef',
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      },
    });
  });

  it('rejects voiding statement targeting an Activity', () => {
    invalid({
      actor: { mbox: 'mailto:admin@example.com' },
      verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
      object: { id: 'http://example.com/activities/1' },
    });
  });
});

// ---------------------------------------------------------------------------
// Batch schema
// ---------------------------------------------------------------------------

describe('statementBatchSchema', () => {
  it('accepts a single statement', () => {
    const result = z.safeParse(statementBatchSchema, minimal());
    expect(result.success).toBe(true);
  });

  it('accepts an array of statements', () => {
    const result = z.safeParse(statementBatchSchema, [minimal(), minimal()]);
    expect(result.success).toBe(true);
  });

  it('rejects an empty object', () => {
    const result = z.safeParse(statementBatchSchema, {});
    expect(result.success).toBe(false);
  });

  it('rejects array with invalid statement', () => {
    const result = z.safeParse(statementBatchSchema, [minimal(), { invalid: true }]);
    expect(result.success).toBe(false);
  });
});
