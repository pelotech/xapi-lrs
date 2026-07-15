import { describe, it, expect } from 'vitest';
import {
  extractActors,
  extractActivities,
  buildPayload,
  actorPayload,
} from '../../../src/repositories/statement-decomposition.ts';

// ---------------------------------------------------------------------------
// extractActors
//
// lrsql semantics (verified against yetanalytics/lrsql v0.9.5 source,
// input/actor.clj:36-44, input/statement.clj:49-54,94-112):
//   - Group members are written with the group's OWN positional usage (no
//     'Member' usage exists in actor_usage_enum) — a member of the top-level
//     actor gets usage 'Actor', a member of context.team gets 'Team', etc.
//   - Identified groups get their own row (actor_type Group) in addition to
//     member rows; anonymous groups (no IFI) get no row for themselves —
//     only member rows.
//   - SubStatement positions use the Sub*-prefixed usages: SubActor,
//     SubObject, SubInstructor, SubTeam.
// ---------------------------------------------------------------------------

describe('extractActors', () => {
  it('extracts Agent actor with usage Actor', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
    });
    expect(actors).toEqual([{ ifi: 'mbox::mailto:a@b.com', type: 'Agent', usage: 'Actor', payload: {} }]);
  });

  it('extracts identified Group actor with members, all usage Actor', () => {
    const actors = extractActors({
      actor: {
        objectType: 'Group',
        mbox: 'mailto:group@b.com',
        member: [{ mbox: 'mailto:m1@b.com' }, { mbox: 'mailto:m2@b.com' }],
      },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
    });
    expect(actors).toHaveLength(3);
    expect(actors[0]).toMatchObject({
      ifi: 'mbox::mailto:group@b.com',
      type: 'Group',
      usage: 'Actor',
    });
    expect(actors[1]).toMatchObject({
      ifi: 'mbox::mailto:m1@b.com',
      type: 'Agent',
      usage: 'Actor',
    });
    expect(actors[2]).toMatchObject({
      ifi: 'mbox::mailto:m2@b.com',
      type: 'Agent',
      usage: 'Actor',
    });
  });

  it('anonymous Group actor gets no self row, only member rows', () => {
    const actors = extractActors({
      actor: {
        objectType: 'Group',
        member: [{ mbox: 'mailto:m1@b.com' }, { mbox: 'mailto:m2@b.com' }],
      },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
    });
    expect(actors).toHaveLength(2);
    expect(actors.every((a) => a.usage === 'Actor' && a.type === 'Agent')).toBe(true);
    expect(actors.map((a) => a.ifi)).toEqual(['mbox::mailto:m1@b.com', 'mbox::mailto:m2@b.com']);
  });

  it('extracts object Agent with usage Object', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { objectType: 'Agent', mbox: 'mailto:obj@b.com' },
    });
    const objectActors = actors.filter((a) => a.usage === 'Object');
    expect(objectActors).toHaveLength(1);
    expect(objectActors[0].ifi).toBe('mbox::mailto:obj@b.com');
  });

  it('extracts object Group with members, all usage Object', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: {
        objectType: 'Group',
        mbox: 'mailto:objgroup@b.com',
        member: [{ mbox: 'mailto:om1@b.com' }],
      },
    });
    const objectActors = actors.filter((a) => a.usage === 'Object');
    expect(objectActors).toHaveLength(2);
    expect(objectActors.map((a) => a.ifi)).toEqual(['mbox::mailto:objgroup@b.com', 'mbox::mailto:om1@b.com']);
  });

  it('extracts authority Agent', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
      authority: { mbox: 'mailto:auth@b.com' },
    });
    const authActors = actors.filter((a) => a.usage === 'Authority');
    expect(authActors).toHaveLength(1);
    expect(authActors[0].ifi).toBe('mbox::mailto:auth@b.com');
  });

  it('extracts authority Group with members, all usage Authority', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
      authority: {
        objectType: 'Group',
        mbox: 'mailto:authgroup@b.com',
        member: [{ mbox: 'mailto:am1@b.com' }],
      },
    });
    const authActors = actors.filter((a) => a.usage === 'Authority');
    expect(authActors).toHaveLength(2);
    expect(authActors.every((a) => a.usage === 'Authority')).toBe(true);
    expect(authActors.map((a) => a.ifi)).toEqual(['mbox::mailto:authgroup@b.com', 'mbox::mailto:am1@b.com']);
  });

  it('extracts context.instructor', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
      context: { instructor: { mbox: 'mailto:instr@b.com' } },
    });
    const instructors = actors.filter((a) => a.usage === 'Instructor');
    expect(instructors).toHaveLength(1);
    expect(instructors[0].ifi).toBe('mbox::mailto:instr@b.com');
  });

  it('extracts context.instructor Group with members, all usage Instructor', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
      context: {
        instructor: {
          objectType: 'Group',
          mbox: 'mailto:instrgroup@b.com',
          member: [{ mbox: 'mailto:im1@b.com' }],
        },
      },
    });
    const instructors = actors.filter((a) => a.usage === 'Instructor');
    expect(instructors).toHaveLength(2);
    expect(instructors.map((a) => a.ifi)).toEqual(['mbox::mailto:instrgroup@b.com', 'mbox::mailto:im1@b.com']);
  });

  it('extracts context.team with members, all usage Team', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
      context: {
        team: {
          objectType: 'Group',
          mbox: 'mailto:team@b.com',
          member: [{ mbox: 'mailto:tm1@b.com' }],
        },
      },
    });
    const teamActors = actors.filter((a) => a.usage === 'Team');
    expect(teamActors).toHaveLength(2);
    expect(teamActors.map((a) => a.ifi)).toEqual(['mbox::mailto:team@b.com', 'mbox::mailto:tm1@b.com']);
    // 'Member' is not a valid actor_usage_enum value in lrsql — must not appear.
    expect(actors.some((a) => (a.usage as string) === 'Member')).toBe(false);
  });

  it('extracts SubStatement actor as SubActor and object Agent as SubObject', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:sub@b.com' },
        verb: { id: 'http://example.com/v' },
        object: { objectType: 'Agent', mbox: 'mailto:subobj@b.com' },
      },
    });
    const subActor = actors.find((a) => a.ifi === 'mbox::mailto:sub@b.com');
    expect(subActor).toMatchObject({ usage: 'SubActor' });
    const subObj = actors.find((a) => a.ifi === 'mbox::mailto:subobj@b.com');
    expect(subObj).toMatchObject({ usage: 'SubObject' });
  });

  it('extracts SubStatement context.instructor/team as SubInstructor/SubTeam', () => {
    const actors = extractActors({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:sub@b.com' },
        verb: { id: 'http://example.com/v' },
        object: { id: 'http://example.com/sub-act' },
        context: {
          instructor: { mbox: 'mailto:subinstr@b.com' },
          team: {
            objectType: 'Group',
            mbox: 'mailto:subteam@b.com',
            member: [{ mbox: 'mailto:subtm1@b.com' }],
          },
        },
      },
    });
    const subInstr = actors.find((a) => a.ifi === 'mbox::mailto:subinstr@b.com');
    expect(subInstr).toMatchObject({ usage: 'SubInstructor' });
    const subTeamActors = actors.filter((a) => a.usage === 'SubTeam');
    expect(subTeamActors.map((a) => a.ifi)).toEqual(['mbox::mailto:subteam@b.com', 'mbox::mailto:subtm1@b.com']);
  });

  it('silently skips agents without valid IFI', () => {
    const actors = extractActors({
      actor: { name: 'No IFI' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
    });
    expect(actors).toHaveLength(0);
  });

  it('deduplicates output by (usage, actor_ifi, actor_type)', () => {
    // Same member appears twice in the member list (also happens to match
    // the top-level actor's IFI) — decomposition output must be deduplicated
    // so re-decomposition of a single statement is deterministic and the
    // batch-upsert junction insert doesn't receive duplicate rows.
    const actors = extractActors({
      actor: {
        objectType: 'Group',
        mbox: 'mailto:group@b.com',
        member: [{ mbox: 'mailto:m1@b.com' }, { mbox: 'mailto:m1@b.com' }],
      },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/a' },
    });
    const memberRows = actors.filter((a) => a.ifi === 'mbox::mailto:m1@b.com');
    expect(memberRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractActivities
// ---------------------------------------------------------------------------

describe('extractActivities', () => {
  it('extracts object Activity with usage Object', () => {
    const activities = extractActivities({
      actor: { mbox: 'mailto:a@b.com' },
      verb: { id: 'http://example.com/v' },
      object: { id: 'http://example.com/act/1', objectType: 'Activity' },
    });
    expect(activities).toEqual([
      {
        iri: 'http://example.com/act/1',
        usage: 'Object',
        payload: expect.objectContaining({ id: 'http://example.com/act/1' }),
      },
    ]);
  });

  it('defaults objectType to Activity when absent', () => {
    const activities = extractActivities({
      object: { id: 'http://example.com/act/1' },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0].usage).toBe('Object');
  });

  it('extracts contextActivities', () => {
    const activities = extractActivities({
      object: { id: 'http://example.com/act/1' },
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/parent' }],
          grouping: [{ id: 'http://example.com/grouping' }],
          category: [{ id: 'http://example.com/category' }],
          other: [{ id: 'http://example.com/other' }],
        },
      },
    });
    const usages = activities.map((a) => a.usage);
    expect(usages).toContain('Object');
    expect(usages).toContain('Parent');
    expect(usages).toContain('Grouping');
    expect(usages).toContain('Category');
    expect(usages).toContain('Other');
  });

  it('extracts SubStatement object Activity as SubObject', () => {
    const activities = extractActivities({
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:a@b.com' },
        verb: { id: 'http://example.com/v' },
        object: { id: 'http://example.com/sub-act' },
      },
    });
    const subObj = activities.find((a) => a.usage === 'SubObject');
    expect(subObj).toBeDefined();
    expect(subObj!.iri).toBe('http://example.com/sub-act');
  });

  it('extracts SubStatement contextActivities with Sub-prefixed usages', () => {
    const activities = extractActivities({
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:a@b.com' },
        verb: { id: 'http://example.com/v' },
        object: { id: 'http://example.com/sub-act' },
        context: {
          contextActivities: {
            parent: [{ id: 'http://example.com/sub-parent' }],
          },
        },
      },
    });
    const subParent = activities.find((a) => a.usage === 'SubParent');
    expect(subParent).toBeDefined();
    expect(subParent!.iri).toBe('http://example.com/sub-parent');
  });
});

// ---------------------------------------------------------------------------
// buildPayload & actorPayload
// ---------------------------------------------------------------------------

describe('buildPayload', () => {
  it('merges stored and authority into statement', () => {
    const stmt = { id: '123', actor: { mbox: 'mailto:a@b.com' } };
    const authority = { mbox: 'mailto:auth@example.com' };
    const result = buildPayload(stmt, '2024-01-01T00:00:00Z', authority);
    expect(result.stored).toBe('2024-01-01T00:00:00Z');
    expect(result.authority).toBe(authority);
    expect(result.id).toBe('123');
  });
});

describe('actorPayload', () => {
  it('includes name when present', () => {
    expect(actorPayload({ name: 'John', mbox: 'mailto:j@b.com' })).toEqual({ name: 'John' });
  });

  it('returns empty object when name absent', () => {
    expect(actorPayload({ mbox: 'mailto:j@b.com' })).toEqual({});
  });
});
