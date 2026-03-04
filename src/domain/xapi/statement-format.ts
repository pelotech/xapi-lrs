/**
 * xAPI 1.0.3 Statement format transformations.
 *
 * Pure functions — no DB access. Applied in the controller as a
 * presentation concern after statements are fetched from storage.
 */

import type {
  Activity,
  ActivityDefinition,
  Actor,
  Agent,
  Attachment,
  Context,
  ContextActivities,
  Group,
  IFI,
  InteractionComponent,
  LanguageMap,
  Statement,
  StatementFormat,
  StatementObject,
  SubStatement,
  Verb,
} from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function formatStatement(
  stmt: Statement,
  format: StatementFormat,
  acceptLanguage?: string,
  canonicalDefs?: ReadonlyMap<string, ActivityDefinition>,
): Statement {
  if (format === 'exact') return stmt;
  if (format === 'ids') return stripToIds(stmt);
  return canonicalize(stmt, acceptLanguage, canonicalDefs);
}

export function formatStatements(
  stmts: readonly Statement[],
  format: StatementFormat,
  acceptLanguage?: string,
  canonicalDefs?: ReadonlyMap<string, ActivityDefinition>,
): readonly Statement[] {
  if (format === 'exact') return stmts;
  return stmts.map((s) => formatStatement(s, format, acceptLanguage, canonicalDefs));
}

/**
 * Collect all Activity IDs from every spec location in a statement.
 * Used to batch-load canonical definitions for format=canonical.
 */
export function collectActivityIds(stmt: Statement): string[] {
  const ids = new Set<string>();

  const pushActivity = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    const objType = o.objectType as string | undefined;
    if (objType && objType !== 'Activity') return;
    if (typeof o.id === 'string') ids.add(o.id);
  };

  const pushFromContextActivities = (ca?: ContextActivities) => {
    if (!ca) return;
    for (const list of [ca.parent, ca.grouping, ca.category, ca.other]) {
      if (list) for (const a of list) ids.add(a.id);
    }
  };

  pushActivity(stmt.object);
  pushFromContextActivities(stmt.context?.contextActivities);

  if (stmt.object && 'objectType' in stmt.object && stmt.object.objectType === 'SubStatement') {
    const sub = stmt.object as SubStatement;
    pushActivity(sub.object);
    pushFromContextActivities(sub.context?.contextActivities);
  }

  return [...ids];
}

// ---------------------------------------------------------------------------
// ids mode — strip definitions, display, names
// ---------------------------------------------------------------------------

function stripToIds(stmt: Statement): Statement {
  const out: Record<string, unknown> = { ...stmt };

  out.actor = stripActor(stmt.actor);
  out.verb = stripVerb(stmt.verb);
  out.object = stripObject(stmt.object);

  if (stmt.authority) out.authority = stripActor(stmt.authority);
  if (stmt.context) out.context = stripContext(stmt.context);
  if (stmt.attachments) out.attachments = stmt.attachments.map(stripAttachment);

  return out as unknown as Statement;
}

function stripActor(actor: Actor): Actor {
  if (actor.objectType === 'Group') return stripGroup(actor as Group);
  return stripAgent(actor as Agent);
}

function stripAgent(agent: Agent): Agent {
  const out: Record<string, unknown> = {};
  if (agent.objectType) out.objectType = agent.objectType;
  if (agent.mbox) out.mbox = agent.mbox;
  if (agent.mbox_sha1sum) out.mbox_sha1sum = agent.mbox_sha1sum;
  if (agent.openid) out.openid = agent.openid;
  if (agent.account) out.account = agent.account;
  return out as Agent;
}

function stripGroup(group: Group): Group {
  const ifi = group as unknown as IFI;
  const out: Record<string, unknown> = { objectType: 'Group' };
  if (ifi.mbox) out.mbox = ifi.mbox;
  if (ifi.mbox_sha1sum) out.mbox_sha1sum = ifi.mbox_sha1sum;
  if (ifi.openid) out.openid = ifi.openid;
  if (ifi.account) out.account = ifi.account;
  if (group.member) out.member = group.member.map(stripAgent);
  return out as unknown as Group;
}

function stripVerb(verb: Verb): Verb {
  return { id: verb.id };
}

function stripObject(obj: StatementObject): StatementObject {
  if (!obj) return obj;

  const objType = (obj as Record<string, unknown>).objectType as string | undefined;

  // Activity (default objectType or explicit 'Activity')
  if (!objType || objType === 'Activity') {
    return stripActivity(obj as Activity);
  }

  if (objType === 'Agent') return stripAgent(obj as Agent);
  if (objType === 'Group') return stripGroup(obj as Group);
  if (objType === 'StatementRef') return obj; // keep as-is
  if (objType === 'SubStatement') return stripSubStatement(obj as SubStatement);

  return obj;
}

function stripActivity(activity: Activity): Activity {
  // format=ids: only the Activity id — no objectType, no definition
  return { id: activity.id } as unknown as Activity;
}

function stripSubStatement(sub: SubStatement): SubStatement {
  const out: Record<string, unknown> = {
    objectType: 'SubStatement',
    actor: stripActor(sub.actor),
    verb: stripVerb(sub.verb),
    object: stripObject(sub.object),
  };
  if (sub.result) out.result = sub.result;
  if (sub.context) out.context = stripContext(sub.context);
  if (sub.timestamp) out.timestamp = sub.timestamp;
  if (sub.attachments) out.attachments = sub.attachments.map(stripAttachment);
  return out as unknown as SubStatement;
}

function stripContext(ctx: Context): Context {
  const out: Record<string, unknown> = { ...ctx };
  if (ctx.instructor) out.instructor = stripActor(ctx.instructor);
  if (ctx.team) out.team = stripGroup(ctx.team);
  if (ctx.contextActivities) out.contextActivities = stripContextActivities(ctx.contextActivities);
  return out as Context;
}

function stripContextActivities(ca: ContextActivities): ContextActivities {
  const out: Record<string, unknown> = {};
  if (ca.parent) out.parent = ca.parent.map(stripActivity);
  if (ca.grouping) out.grouping = ca.grouping.map(stripActivity);
  if (ca.category) out.category = ca.category.map(stripActivity);
  if (ca.other) out.other = ca.other.map(stripActivity);
  return out as ContextActivities;
}

function stripAttachment(att: Attachment): Attachment {
  const { description: _desc, ...rest } = att;
  return { ...rest, display: att.display };
}

// ---------------------------------------------------------------------------
// canonical mode — filter LanguageMaps to best-match language
// ---------------------------------------------------------------------------

function canonicalize(
  stmt: Statement,
  acceptLanguage?: string,
  canonicalDefs?: ReadonlyMap<string, ActivityDefinition>,
): Statement {
  const langs = parseAcceptLanguage(acceptLanguage);

  const out: Record<string, unknown> = { ...stmt };
  out.verb = canonicalizeVerb(stmt.verb, langs);
  out.object = canonicalizeObject(stmt.object, langs, canonicalDefs);
  if (stmt.context) out.context = canonicalizeContext(stmt.context, langs, canonicalDefs);
  if (stmt.attachments) out.attachments = stmt.attachments.map((a) => canonicalizeAttachment(a, langs));
  return out as unknown as Statement;
}

function canonicalizeVerb(verb: Verb, langs: string[]): Verb {
  if (!verb.display) return verb;
  return { ...verb, display: pickLanguageMap(verb.display, langs) };
}

function canonicalizeObject(
  obj: StatementObject,
  langs: string[],
  canonicalDefs?: ReadonlyMap<string, ActivityDefinition>,
): StatementObject {
  if (!obj) return obj;

  const objType = (obj as Record<string, unknown>).objectType as string | undefined;

  if (!objType || objType === 'Activity') {
    return canonicalizeActivity(obj as Activity, langs, canonicalDefs);
  }

  if (objType === 'SubStatement') {
    return canonicalizeSubStatement(obj as SubStatement, langs, canonicalDefs);
  }

  return obj;
}

function canonicalizeActivity(
  activity: Activity,
  langs: string[],
  canonicalDefs?: ReadonlyMap<string, ActivityDefinition>,
): Activity {
  const def = canonicalDefs?.get(activity.id) ?? activity.definition;
  if (!def) return activity;
  return { ...activity, definition: canonicalizeDefinition(def, langs) };
}

function canonicalizeDefinition(def: ActivityDefinition, langs: string[]): ActivityDefinition {
  const out: Record<string, unknown> = { ...def };
  if (def.name) out.name = pickLanguageMap(def.name, langs);
  if (def.description) out.description = pickLanguageMap(def.description, langs);
  if (def.choices) out.choices = def.choices.map((c) => canonicalizeInteractionComponent(c, langs));
  if (def.scale) out.scale = def.scale.map((c) => canonicalizeInteractionComponent(c, langs));
  if (def.source) out.source = def.source.map((c) => canonicalizeInteractionComponent(c, langs));
  if (def.target) out.target = def.target.map((c) => canonicalizeInteractionComponent(c, langs));
  if (def.steps) out.steps = def.steps.map((c) => canonicalizeInteractionComponent(c, langs));
  return out as ActivityDefinition;
}

function canonicalizeInteractionComponent(comp: InteractionComponent, langs: string[]): InteractionComponent {
  if (!comp.description) return comp;
  return { ...comp, description: pickLanguageMap(comp.description, langs) };
}

function canonicalizeSubStatement(
  sub: SubStatement,
  langs: string[],
  canonicalDefs?: ReadonlyMap<string, ActivityDefinition>,
): SubStatement {
  const out: Record<string, unknown> = {
    ...sub,
    verb: canonicalizeVerb(sub.verb, langs),
    object: canonicalizeObject(sub.object, langs, canonicalDefs),
  };
  if (sub.context) out.context = canonicalizeContext(sub.context, langs, canonicalDefs);
  if (sub.attachments) out.attachments = sub.attachments.map((a) => canonicalizeAttachment(a, langs));
  return out as unknown as SubStatement;
}

function canonicalizeContext(
  ctx: Context,
  langs: string[],
  canonicalDefs?: ReadonlyMap<string, ActivityDefinition>,
): Context {
  if (!ctx.contextActivities) return ctx;
  const ca = ctx.contextActivities;
  const out: Record<string, unknown> = {};
  if (ca.parent) out.parent = ca.parent.map((a) => canonicalizeActivity(a, langs, canonicalDefs));
  if (ca.grouping) out.grouping = ca.grouping.map((a) => canonicalizeActivity(a, langs, canonicalDefs));
  if (ca.category) out.category = ca.category.map((a) => canonicalizeActivity(a, langs, canonicalDefs));
  if (ca.other) out.other = ca.other.map((a) => canonicalizeActivity(a, langs, canonicalDefs));
  return { ...ctx, contextActivities: out as ContextActivities };
}

function canonicalizeAttachment(att: Attachment, langs: string[]): Attachment {
  const out: Record<string, unknown> = { ...att };
  out.display = pickLanguageMap(att.display, langs);
  if (att.description) out.description = pickLanguageMap(att.description, langs);
  return out as unknown as Attachment;
}

// ---------------------------------------------------------------------------
// Accept-Language parsing & LanguageMap selection
// ---------------------------------------------------------------------------

export function parseAcceptLanguage(header?: string): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q };
    })
    .filter((e) => e.q > 0)
    .toSorted((a, b) => b.q - a.q)
    .map((e) => e.tag);
}

export function pickLanguageMap(map: LanguageMap, langs: string[]): LanguageMap {
  const keys = Object.keys(map);
  if (keys.length === 0) return map;

  // Try each preferred language in order
  for (const lang of langs) {
    // Exact match (case-insensitive)
    const exact = keys.find((k) => k.toLowerCase() === lang);
    if (exact) return { [exact]: map[exact]! };

    // Prefix match: requested "en" matches "en-US", or "en-US" matches "en"
    const prefix = keys.find((k) => {
      const kl = k.toLowerCase();
      return kl.startsWith(lang + '-') || lang.startsWith(kl + '-');
    });
    if (prefix) return { [prefix]: map[prefix]! };
  }

  // No match — fall back to first key
  const firstKey = keys[0]!;
  return { [firstKey]: map[firstKey]! };
}
