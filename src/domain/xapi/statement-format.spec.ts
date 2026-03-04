import { describe, expect, it } from 'vitest';
import { collectActivityIds, formatStatement, parseAcceptLanguage, pickLanguageMap } from './statement-format.js';
import type { ActivityDefinition, Statement } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fullStatement: Statement = {
  id: '00000000-0000-4000-0000-000000000001',
  actor: {
    objectType: 'Agent',
    name: 'Alice',
    mbox: 'mailto:alice@example.com',
  },
  verb: {
    id: 'http://adlnet.gov/expapi/verbs/completed',
    display: { 'en-US': 'completed', fr: 'terminé' },
  },
  object: {
    objectType: 'Activity',
    id: 'http://example.com/activity/1',
    definition: {
      name: { 'en-US': 'Quiz 1', fr: 'Quiz 1' },
      description: { 'en-US': 'A quiz', fr: 'Un quiz' },
      type: 'http://adlnet.gov/expapi/activities/assessment',
    },
  },
  authority: {
    objectType: 'Agent',
    name: 'LRS Admin',
    account: { homePage: 'http://lrs.example.com', name: 'admin' },
  },
  context: {
    instructor: {
      objectType: 'Agent',
      name: 'Bob',
      mbox: 'mailto:bob@example.com',
    },
    team: {
      objectType: 'Group',
      name: 'Team Alpha',
      mbox: 'mailto:team@example.com',
      member: [
        { name: 'Charlie', mbox: 'mailto:charlie@example.com' },
      ],
    },
    contextActivities: {
      parent: [
        {
          id: 'http://example.com/parent',
          definition: { name: { 'en-US': 'Parent Course' } },
        },
      ],
    },
  },
  stored: '2025-01-01T00:00:00.000Z',
  timestamp: '2025-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// ids format
// ---------------------------------------------------------------------------

describe('formatStatement — ids', () => {
  it('strips Activity definition', () => {
    const result = formatStatement(fullStatement, 'ids');
    const obj = result.object as { id: string; definition?: unknown };
    expect(obj.id).toBe('http://example.com/activity/1');
    expect(obj.definition).toBeUndefined();
  });

  it('strips Verb display', () => {
    const result = formatStatement(fullStatement, 'ids');
    expect(result.verb.id).toBe('http://adlnet.gov/expapi/verbs/completed');
    expect(result.verb.display).toBeUndefined();
  });

  it('strips Agent name, keeps IFI', () => {
    const result = formatStatement(fullStatement, 'ids');
    const actor = result.actor as { name?: string; mbox?: string };
    expect(actor.mbox).toBe('mailto:alice@example.com');
    expect(actor.name).toBeUndefined();
  });

  it('strips authority name, keeps IFI', () => {
    const result = formatStatement(fullStatement, 'ids');
    const auth = result.authority as { name?: string; account?: { homePage: string; name: string } };
    expect(auth.account).toEqual({ homePage: 'http://lrs.example.com', name: 'admin' });
    expect(auth.name).toBeUndefined();
  });

  it('strips Group name, preserves stripped members', () => {
    const result = formatStatement(fullStatement, 'ids');
    const team = result.context?.team as {
      objectType: string;
      name?: string;
      mbox?: string;
      member?: Array<{ name?: string; mbox?: string }>;
    } | undefined;
    expect(team?.objectType).toBe('Group');
    expect(team?.mbox).toBe('mailto:team@example.com');
    expect(team?.name).toBeUndefined();
    expect(team?.member?.[0]?.mbox).toBe('mailto:charlie@example.com');
    expect(team?.member?.[0]?.name).toBeUndefined();
  });

  it('strips context.instructor name', () => {
    const result = formatStatement(fullStatement, 'ids');
    const inst = result.context?.instructor as { name?: string; mbox?: string } | undefined;
    expect(inst?.mbox).toBe('mailto:bob@example.com');
    expect(inst?.name).toBeUndefined();
  });

  it('strips contextActivities definitions', () => {
    const result = formatStatement(fullStatement, 'ids');
    const parent = result.context!.contextActivities!.parent![0] as { id: string; definition?: unknown };
    expect(parent.id).toBe('http://example.com/parent');
    expect(parent.definition).toBeUndefined();
  });

  it('transforms SubStatement contents recursively', () => {
    const subStmt: Statement = {
      ...fullStatement,
      object: {
        objectType: 'SubStatement',
        actor: { name: 'Sub Actor', mbox: 'mailto:sub@example.com' },
        verb: { id: 'http://example.com/verbs/sub', display: { en: 'sub' } },
        object: {
          objectType: 'Activity',
          id: 'http://example.com/sub-activity',
          definition: { name: { en: 'Sub Activity' } },
        },
      },
    };
    const result = formatStatement(subStmt, 'ids');
    const sub = result.object as {
      objectType: string;
      actor: { name?: string; mbox?: string };
      verb: { id: string; display?: unknown };
      object: { id: string; definition?: unknown };
    };
    expect(sub.objectType).toBe('SubStatement');
    expect(sub.actor.name).toBeUndefined();
    expect(sub.actor.mbox).toBe('mailto:sub@example.com');
    expect(sub.verb.display).toBeUndefined();
    expect(sub.object.definition).toBeUndefined();
  });

  it('preserves non-stripped fields (id, stored, timestamp, result)', () => {
    const result = formatStatement(fullStatement, 'ids');
    expect(result.id).toBe(fullStatement.id);
    expect(result.stored).toBe(fullStatement.stored);
    expect(result.timestamp).toBe(fullStatement.timestamp);
  });
});

// ---------------------------------------------------------------------------
// canonical format
// ---------------------------------------------------------------------------

describe('formatStatement — canonical', () => {
  it('filters LanguageMap to best-match language', () => {
    const result = formatStatement(fullStatement, 'canonical', 'en-US');
    expect(result.verb.display).toEqual({ 'en-US': 'completed' });
    const def = (result.object as { definition: { name: Record<string, string> } }).definition;
    expect(def.name).toEqual({ 'en-US': 'Quiz 1' });
  });

  it('respects Accept-Language preference order', () => {
    const result = formatStatement(fullStatement, 'canonical', 'fr, en-US;q=0.5');
    expect(result.verb.display).toEqual({ fr: 'terminé' });
  });

  it('falls back to first language when no match', () => {
    const result = formatStatement(fullStatement, 'canonical', 'de');
    // Falls back to first key in the LanguageMap
    const display = result.verb.display!;
    expect(Object.keys(display)).toHaveLength(1);
    expect(Object.values(display)[0]).toBeDefined();
  });

  it('filters contextActivities definitions', () => {
    const result = formatStatement(fullStatement, 'canonical', 'en-US');
    const parent = result.context!.contextActivities!.parent![0] as {
      definition: { name: Record<string, string> };
    };
    expect(parent.definition.name).toEqual({ 'en-US': 'Parent Course' });
  });

  it('does not strip Agent names or IFIs', () => {
    const result = formatStatement(fullStatement, 'canonical', 'en-US');
    const actor = result.actor as { name?: string; mbox?: string };
    expect(actor.name).toBe('Alice');
    expect(actor.mbox).toBe('mailto:alice@example.com');
  });
});

// ---------------------------------------------------------------------------
// exact format
// ---------------------------------------------------------------------------

describe('formatStatement — exact', () => {
  it('returns statement unchanged', () => {
    const result = formatStatement(fullStatement, 'exact');
    expect(result).toBe(fullStatement); // same reference
  });
});

// ---------------------------------------------------------------------------
// parseAcceptLanguage
// ---------------------------------------------------------------------------

describe('parseAcceptLanguage', () => {
  it('parses simple header', () => {
    expect(parseAcceptLanguage('en-US, fr;q=0.8')).toEqual(['en-us', 'fr']);
  });

  it('sorts by quality', () => {
    expect(parseAcceptLanguage('fr;q=0.5, en;q=1.0, de;q=0.8')).toEqual(['en', 'de', 'fr']);
  });

  it('excludes q=0', () => {
    expect(parseAcceptLanguage('en, fr;q=0')).toEqual(['en']);
  });

  it('returns empty for undefined', () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pickLanguageMap
// ---------------------------------------------------------------------------

describe('pickLanguageMap', () => {
  const map = { 'en-US': 'English', fr: 'French', de: 'German' };

  it('exact match', () => {
    expect(pickLanguageMap(map, ['fr'])).toEqual({ fr: 'French' });
  });

  it('prefix match: "en" matches "en-US"', () => {
    expect(pickLanguageMap(map, ['en'])).toEqual({ 'en-US': 'English' });
  });

  it('prefix match: "en-us" matches "en-US" (case insensitive)', () => {
    expect(pickLanguageMap(map, ['en-us'])).toEqual({ 'en-US': 'English' });
  });

  it('falls back to first key when no match', () => {
    expect(pickLanguageMap(map, ['ja'])).toEqual({ 'en-US': 'English' });
  });

  it('returns empty map as-is', () => {
    expect(pickLanguageMap({}, ['en'])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// canonical with canonicalDefs (merged activity definitions)
// ---------------------------------------------------------------------------

describe('formatStatement — canonical with canonicalDefs', () => {
  const stmt: Statement = {
    id: '00000000-0000-4000-0000-000000000001',
    actor: { mbox: 'mailto:a@example.com' },
    verb: { id: 'http://example.com/v', display: { en: 'did' } },
    object: {
      objectType: 'Activity',
      id: 'http://example.com/act',
      definition: { name: { en: 'Embedded' } },
    },
  };

  it('replaces embedded definition with canonical from map', () => {
    const canonicalDefs = new Map<string, ActivityDefinition>([
      ['http://example.com/act', { name: { en: 'Canonical', fr: 'Canonique' }, type: 'http://example.com/type' }],
    ]);
    const result = formatStatement(stmt, 'canonical', 'en', canonicalDefs);
    const def = (result.object as { definition: ActivityDefinition }).definition;
    expect(def.name).toEqual({ en: 'Canonical' }); // language-filtered
    expect(def.type).toBe('http://example.com/type');
  });

  it('applies language filtering to canonical definition', () => {
    const canonicalDefs = new Map<string, ActivityDefinition>([
      ['http://example.com/act', { name: { en: 'English', fr: 'French' } }],
    ]);
    const result = formatStatement(stmt, 'canonical', 'fr', canonicalDefs);
    const def = (result.object as { definition: ActivityDefinition }).definition;
    expect(def.name).toEqual({ fr: 'French' });
  });

  it('falls back to embedded definition when not in map', () => {
    const canonicalDefs = new Map<string, ActivityDefinition>();
    const result = formatStatement(stmt, 'canonical', 'en', canonicalDefs);
    const def = (result.object as { definition: ActivityDefinition }).definition;
    expect(def.name).toEqual({ en: 'Embedded' });
  });
});

// ---------------------------------------------------------------------------
// collectActivityIds
// ---------------------------------------------------------------------------

describe('collectActivityIds', () => {
  it('collects top-level object Activity', () => {
    const stmt: Statement = {
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/act' },
    };
    expect(collectActivityIds(stmt)).toEqual(['http://example.com/act']);
  });

  it('collects from contextActivities', () => {
    const stmt: Statement = {
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/act' },
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/parent' }],
          category: [{ id: 'http://example.com/cat' }],
        },
      },
    };
    const ids = collectActivityIds(stmt);
    expect(ids).toContain('http://example.com/act');
    expect(ids).toContain('http://example.com/parent');
    expect(ids).toContain('http://example.com/cat');
  });

  it('collects from SubStatement', () => {
    const stmt: Statement = {
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:sub@b.com' },
        verb: { id: 'http://example.com/v' },
        object: { id: 'http://example.com/sub-act' },
        context: {
          contextActivities: {
            parent: [{ id: 'http://example.com/sub-parent' }],
          },
        },
      },
    };
    const ids = collectActivityIds(stmt);
    expect(ids).toContain('http://example.com/sub-act');
    expect(ids).toContain('http://example.com/sub-parent');
  });

  it('deduplicates', () => {
    const stmt: Statement = {
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/act' },
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/act' }],
        },
      },
    };
    expect(collectActivityIds(stmt)).toEqual(['http://example.com/act']);
  });

  it('skips non-Activity objects', () => {
    const stmt: Statement = {
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { objectType: 'StatementRef', id: 'some-uuid' },
    };
    expect(collectActivityIds(stmt)).toEqual([]);
  });
});
