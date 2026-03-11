import { describe, expect, test } from 'vitest';
import { formatStatement, enrichStatement, buildAuthority, LRS_AUTHORITY_HOME_PAGE } from '../../../src/helpers/enrichment.ts';
import type { XapiStatementRow } from '../../../src/repositories/statements.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stmt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    actor: { objectType: 'Agent', mbox: 'mailto:a@b.com', name: 'Alice' },
    verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did', fr: 'fait' } },
    object: {
      id: 'http://example.com/act/1',
      definition: { name: { 'en-US': 'Act 1', fr: 'Acte 1' }, type: 'http://example.com/type' },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// format = exact
// ---------------------------------------------------------------------------

describe('formatStatement exact', () => {
  test('returns statement unchanged', () => {
    const s = stmt();
    expect(formatStatement(s, 'exact')).toEqual(s);
  });
});

// ---------------------------------------------------------------------------
// format = ids
// ---------------------------------------------------------------------------

describe('formatStatement ids', () => {
  test('strips verb.display, keeping only verb.id', () => {
    const result = formatStatement(stmt(), 'ids');
    expect(result.verb).toEqual({ id: 'http://example.com/verbs/did' });
  });

  test('strips agent to IFI only (mbox)', () => {
    const result = formatStatement(stmt(), 'ids');
    const actor = result.actor as Record<string, unknown>;
    expect(actor.mbox).toBe('mailto:a@b.com');
    expect(actor.name).toBeUndefined();
    expect(actor.objectType).toBe('Agent');
  });

  test('strips activity definition, keeping only id', () => {
    const result = formatStatement(stmt(), 'ids');
    expect(result.object).toEqual({ id: 'http://example.com/act/1' });
  });

  test('strips contextActivities definitions', () => {
    const s = stmt({
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/parent', definition: { name: { 'en-US': 'P' } } }],
        },
      },
    });
    const result = formatStatement(s, 'ids');
    const ctx = result.context as Record<string, unknown>;
    const ca = ctx.contextActivities as Record<string, unknown>;
    expect(ca.parent).toEqual([{ id: 'http://example.com/parent' }]);
  });

  test('strips context.instructor and context.team to IFI', () => {
    const s = stmt({
      context: {
        instructor: { objectType: 'Agent', mbox: 'mailto:instr@b.com', name: 'Instructor' },
        team: { objectType: 'Group', mbox: 'mailto:team@b.com', name: 'Team' },
      },
    });
    const result = formatStatement(s, 'ids');
    const ctx = result.context as Record<string, unknown>;
    expect(ctx.instructor).toEqual({ objectType: 'Agent', mbox: 'mailto:instr@b.com' });
    expect(ctx.team).toEqual({ objectType: 'Group', mbox: 'mailto:team@b.com' });
  });

  test('handles Agent as object (strips to IFI)', () => {
    const s = stmt({ object: { objectType: 'Agent', mbox: 'mailto:obj@b.com', name: 'Bob' } });
    const result = formatStatement(s, 'ids');
    expect(result.object).toEqual({ objectType: 'Agent', mbox: 'mailto:obj@b.com' });
  });

  test('handles Group members (strips each to IFI)', () => {
    const s = stmt({
      actor: {
        objectType: 'Group',
        mbox: 'mailto:group@b.com',
        name: 'MyGroup',
        member: [
          { objectType: 'Agent', mbox: 'mailto:m1@b.com', name: 'M1' },
          { objectType: 'Agent', account: { homePage: 'http://ex.com', name: 'u2' }, name: 'M2' },
        ],
      },
    });
    const result = formatStatement(s, 'ids');
    const actor = result.actor as Record<string, unknown>;
    expect(actor.member).toEqual([
      { objectType: 'Agent', mbox: 'mailto:m1@b.com' },
      { objectType: 'Agent', account: { homePage: 'http://ex.com', name: 'u2' } },
    ]);
  });

  test('handles SubStatement recursion', () => {
    const s = stmt({
      object: {
        objectType: 'SubStatement',
        actor: { objectType: 'Agent', mbox: 'mailto:sub@b.com', name: 'Sub' },
        verb: { id: 'http://example.com/verbs/sub', display: { 'en-US': 'subbed' } },
        object: { id: 'http://example.com/act/sub', definition: { name: { 'en-US': 'SubAct' } } },
      },
    });
    const result = formatStatement(s, 'ids');
    const sub = result.object as Record<string, unknown>;
    expect(sub.actor).toEqual({ objectType: 'Agent', mbox: 'mailto:sub@b.com' });
    expect(sub.verb).toEqual({ id: 'http://example.com/verbs/sub' });
    expect(sub.object).toEqual({ id: 'http://example.com/act/sub' });
  });
});

// ---------------------------------------------------------------------------
// format = canonical
// ---------------------------------------------------------------------------

describe('formatStatement canonical', () => {
  test('picks preferred language from verb.display', () => {
    const result = formatStatement(stmt(), 'canonical', 'en-US');
    const verb = result.verb as Record<string, unknown>;
    expect(verb.display).toEqual({ 'en-US': 'did' });
  });

  test('falls back to prefix match (en -> en-US)', () => {
    const result = formatStatement(stmt(), 'canonical', 'en');
    const verb = result.verb as Record<string, unknown>;
    expect(verb.display).toEqual({ 'en-US': 'did' });
  });

  test('picks exact match over prefix', () => {
    const result = formatStatement(stmt(), 'canonical', 'fr');
    const verb = result.verb as Record<string, unknown>;
    expect(verb.display).toEqual({ fr: 'fait' });
  });

  test('handles quality values (q=)', () => {
    const result = formatStatement(stmt(), 'canonical', 'fr;q=0.5, en-US;q=1.0');
    const verb = result.verb as Record<string, unknown>;
    expect(verb.display).toEqual({ 'en-US': 'did' });
  });

  test('falls back to first entry when no match', () => {
    const result = formatStatement(stmt(), 'canonical', 'zh');
    const verb = result.verb as Record<string, unknown>;
    // First key of { 'en-US': 'did', fr: 'fait' }
    expect(verb.display).toEqual({ 'en-US': 'did' });
  });

  test('canonicalizes activity definition.name', () => {
    const result = formatStatement(stmt(), 'canonical', 'fr');
    const obj = result.object as Record<string, unknown>;
    const def = obj.definition as Record<string, unknown>;
    expect(def.name).toEqual({ fr: 'Acte 1' });
  });
});

// ---------------------------------------------------------------------------
// enrichStatement and buildAuthority
// ---------------------------------------------------------------------------

describe('enrichStatement', () => {
  test('returns row.payload directly', () => {
    const payload = { id: 'test', actor: {}, verb: {}, object: {} };
    const row = { id: 'x', statement_id: 'x', payload, is_voided: false, stored: new Date() } as XapiStatementRow;
    expect(enrichStatement(row)).toBe(payload);
  });
});

describe('buildAuthority', () => {
  test('builds authority agent from account name', () => {
    const authority = buildAuthority('my-credential');
    expect(authority).toEqual({
      objectType: 'Agent',
      account: {
        homePage: LRS_AUTHORITY_HOME_PAGE,
        name: 'my-credential',
      },
    });
  });

  test('uses LRS_AUTHORITY_HOME_PAGE as homePage', () => {
    expect(LRS_AUTHORITY_HOME_PAGE).toBe('https://xapi-lrs.pelotech.dev');
  });
});
