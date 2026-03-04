/**
 * Zod v4 validation schemas for inbound xAPI 1.0.3 Statements.
 *
 * These schemas enforce the structural and semantic rules from the xAPI 1.0.3
 * Data specification. They are used to validate PUT/POST payloads before storage.
 *
 * Reference: https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md
 */
import { z } from 'zod';
import { HttpError } from '../../core/errors.js';
import type { Statement } from './types.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * IRI — scheme must start with a letter and contain only [a-zA-Z0-9+\-.],
 * followed by a colon (RFC 3987 §2.2 / RFC 3986 §3.1).
 */
const iri = z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9+\-.]*:/, 'must be a valid IRI');

const uuid = z.uuid();

/** ISO 8601 timestamp string — also rejects -00:00 offset per xAPI/RFC 3339 §4.3. */
const timestamp = z.string().refine((v) => {
  // Must parse as valid ISO 8601 with offset
  if (!z.safeParse(z.iso.datetime({ offset: true }), v).success) return false;
  // xAPI rejects -00:00 as an offset (RFC 3339 §4.3: unknown local offset)
  return !v.endsWith('-00:00');
}, 'must be a valid ISO 8601 timestamp (offset required, -00:00 not allowed)');

/**
 * ISO 8601 duration — rejects mixing weeks with other designators (ISO 8601:2004 §4.4.3.2).
 * P4W is valid, P4W1D is not.
 */
const duration = z.string().refine((v) => {
  const basic = /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
  if (!basic.test(v)) return false;
  // If weeks are present, no other date designators allowed
  if (/\d+W/.test(v) && /\d+[YMDHMS]/.test(v.replace(/\d+W/, ''))) return false;
  // Must have at least one designator
  return v !== 'P' && v !== 'PT';
}, 'must be an ISO 8601 duration');

/**
 * RFC 5646 language tag — simplified validation.
 * Accepts: en, en-US, zh-Hans, zh-Hant-HK, x-private, i-klingon, etc.
 * Rejects: plain words like "something", empty strings, etc.
 */
const RFC5646_RE = /^(?:(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3})|[A-Za-z]{4}|[A-Za-z]{5,8})(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?(?:-(?:[A-Za-z\d]{5,8}|\d[A-Za-z\d]{3}))*(?:-[A-Za-z\d](?:-[A-Za-z\d]{2,8})+)*(?:-x(?:-[A-Za-z\d]{1,8})+)?$|^x(?:-[A-Za-z\d]{1,8})+$|^i-[A-Za-z]+$/;

const languageMap = z.record(z.string(), z.string()).refine((map) => {
  return Object.keys(map).every((key) => RFC5646_RE.test(key));
}, 'Language map keys must be valid RFC 5646 language tags');

/** Extension map — keys must be valid IRIs (contain a colon per IRI syntax). */
const extensions = z.record(z.string(), z.unknown()).refine((map) => {
  return Object.keys(map).every((key) => key.includes(':'));
}, 'Extension keys must be valid IRIs');

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  homePage: z.string().url(),
  name: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Agent — must have exactly one IFI
// ---------------------------------------------------------------------------

/** mbox — must be mailto: followed by a valid email (at minimum, must contain @). */
const mbox = z.string().regex(/^mailto:[^@]+@.+/, 'mbox must be a valid mailto IRI with an email address');
const mboxSha1sum = z.string().regex(/^[a-fA-F0-9]{40}$/, 'must be a 40-character hex SHA-1');

const agentSchema: z.ZodType = z.object({
  objectType: z.literal('Agent').optional(),
  name: z.string().optional(),
  mbox: mbox.optional(),
  mbox_sha1sum: mboxSha1sum.optional(),
  openid: z.string().url().optional(),
  account: accountSchema.optional(),
}).refine((v) => {
  const count = [v.mbox, v.mbox_sha1sum, v.openid, v.account].filter((x) => x !== undefined).length;
  return count === 1;
}, 'Agent must have exactly one inverse functional identifier');

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

/** Identified Group — has at least one IFI, member is optional. */
const identifiedGroupSchema = z.object({
  objectType: z.literal('Group'),
  name: z.string().optional(),
  mbox: mbox.optional(),
  mbox_sha1sum: mboxSha1sum.optional(),
  openid: z.string().url().optional(),
  account: accountSchema.optional(),
  member: z.array(z.lazy(() => agentSchema)).optional(),
}).refine((v) => {
  const count = [v.mbox, v.mbox_sha1sum, v.openid, v.account].filter((x) => x !== undefined).length;
  return count === 1;
}, 'Identified Group must have exactly one inverse functional identifier');

/** Anonymous Group — no IFI, member is required. Strict to reject IFI fields. */
const anonymousGroupSchema = z.object({
  objectType: z.literal('Group'),
  name: z.string().optional(),
  member: z.array(z.lazy(() => agentSchema)).min(1, 'Anonymous Group must have at least one member'),
}).strict();

const groupSchema = z.union([identifiedGroupSchema, anonymousGroupSchema]);

const actorSchema = z.union([agentSchema, groupSchema]);

// ---------------------------------------------------------------------------
// Verb
// ---------------------------------------------------------------------------

const verbSchema = z.object({
  id: iri,
  display: languageMap.optional(),
});

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const interactionType = z.enum([
  'true-false', 'choice', 'fill-in', 'long-fill-in', 'matching',
  'performance', 'sequencing', 'likert', 'numeric', 'other',
]);

const interactionComponent = z.object({
  id: z.string(),
  description: languageMap.optional(),
});

const INTERACTION_PROPERTIES = ['correctResponsesPattern', 'choices', 'scale', 'source', 'target', 'steps'] as const;

const activityDefinitionSchema = z.object({
  name: languageMap.optional(),
  description: languageMap.optional(),
  type: iri.optional(),
  moreInfo: z.string().url().optional(),
  interactionType: interactionType.optional(),
  correctResponsesPattern: z.array(z.string()).optional(),
  choices: z.array(interactionComponent).optional(),
  scale: z.array(interactionComponent).optional(),
  source: z.array(interactionComponent).optional(),
  target: z.array(interactionComponent).optional(),
  steps: z.array(interactionComponent).optional(),
  extensions: extensions.optional(),
}).refine((def) => {
  // xAPI §4.1.4.1: interactionType is required when interaction properties are present
  const hasInteractionProps = INTERACTION_PROPERTIES.some(
    (p) => (def as Record<string, unknown>)[p] !== undefined,
  );
  if (hasInteractionProps && !def.interactionType) return false;
  return true;
}, 'interactionType is required when interaction properties (correctResponsesPattern, choices, scale, source, target, steps) are present');

const activitySchema = z.object({
  objectType: z.literal('Activity').optional(),
  id: iri,
  definition: activityDefinitionSchema.optional(),
});

// ---------------------------------------------------------------------------
// StatementRef
// ---------------------------------------------------------------------------

const statementRefSchema = z.object({
  objectType: z.literal('StatementRef'),
  id: uuid,
});

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

const scoreSchema = z.object({
  scaled: z.number().min(-1).max(1).optional(),
  raw: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).refine((s) => {
  if (s.min !== undefined && s.max !== undefined && s.min > s.max) return false;
  if (s.raw !== undefined && s.min !== undefined && s.raw < s.min) return false;
  if (s.raw !== undefined && s.max !== undefined && s.raw > s.max) return false;
  return true;
}, 'Score: raw must be between min and max; min must be <= max');

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

const resultSchema = z.object({
  score: scoreSchema.optional(),
  success: z.boolean().optional(),
  completion: z.boolean().optional(),
  response: z.string().optional(),
  duration: duration.optional(),
  extensions: extensions.optional(),
});

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

const attachmentSchema = z.object({
  usageType: iri,
  display: languageMap,
  description: languageMap.optional(),
  contentType: z.string().min(1),
  length: z.number().int().min(0),
  sha2: z.string().min(1),
  fileUrl: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Per xAPI 1.0.3 §4.1.6.2, the LRS must accept single Activity or array and coerce to array. */
const activityOrArray = z.union([
  z.array(activitySchema),
  activitySchema.transform((a) => [a]),
]);

const contextActivitiesSchema = z.object({
  parent: activityOrArray.optional(),
  grouping: activityOrArray.optional(),
  category: activityOrArray.optional(),
  other: activityOrArray.optional(),
}).strict();

const contextSchema = z.object({
  registration: uuid.optional(),
  instructor: actorSchema.optional(),
  team: groupSchema.optional(),
  contextActivities: contextActivitiesSchema.optional(),
  revision: z.string().optional(),
  platform: z.string().optional(),
  language: z.string().regex(RFC5646_RE, 'must be a valid RFC 5646 language tag').optional(),
  statement: statementRefSchema.optional(),
  extensions: extensions.optional(),
});

// ---------------------------------------------------------------------------
// SubStatement
// ---------------------------------------------------------------------------

/** SubStatement object — cannot be another SubStatement. */
const subStatementObjectSchema = z.union([
  activitySchema,
  agentSchema,
  groupSchema,
  statementRefSchema,
]);

const subStatementSchema = z.object({
  objectType: z.literal('SubStatement'),
  actor: actorSchema,
  verb: verbSchema,
  object: subStatementObjectSchema,
  result: resultSchema.optional(),
  context: contextSchema.optional(),
  timestamp: timestamp.optional(),
  attachments: z.array(attachmentSchema).optional(),
}).strict().refine((sub) => {
  // xAPI §4.1.6: revision and platform only valid when object is an Activity
  const obj = sub.object as Record<string, unknown>;
  const isActivity = !obj.objectType || obj.objectType === 'Activity';
  if (!isActivity && sub.context) {
    const ctx = sub.context as Record<string, unknown>;
    if (ctx.revision !== undefined || ctx.platform !== undefined) return false;
  }
  return true;
}, 'Context revision and platform properties require the Statement object to be an Activity');

// ---------------------------------------------------------------------------
// Statement Object (top-level) — includes SubStatement
// ---------------------------------------------------------------------------

/**
 * xAPI §4.1.4: when used as a Statement object, Agents and Groups MUST include
 * objectType. Without it, the object is assumed to be an Activity.
 */
const statementObjectSchema = z.union([
  activitySchema,
  agentSchema.refine(
    (v) => (v as Record<string, unknown>).objectType === 'Agent',
    'Agent used as Statement object must include objectType',
  ),
  groupSchema,
  statementRefSchema,
  subStatementSchema,
]);

// ---------------------------------------------------------------------------
// Statement — top-level
// ---------------------------------------------------------------------------

const VOIDING_VERB = 'http://adlnet.gov/expapi/verbs/voided';

/** xAPI version: must be "1.0" or "1.0.x" where x is a non-negative integer. */
const xapiVersion = z.string().regex(
  /^1\.0(?:\.\d+)?$/,
  'version must be "1.0" or "1.0.x"',
);

/**
 * xAPI §4.1.9: Authority — an Agent or a 2-member anonymous Group (OAuth).
 * If a Group: must be anonymous (no IFI) with exactly 2 Agent members.
 */
const authoritySchema = z.union([
  agentSchema,
  anonymousGroupSchema.refine((g) => {
    return g.member.length === 2;
  }, 'Authority Group must have exactly 2 members'),
]);

/**
 * Accept stored/version/authority from clients (some send them) but strip
 * stored and version — the LRS always overwrites these (§2.4.7, §2.4.8).
 * authority is left for now and will be overwritten during storage.
 */
export const statementSchema = z.object({
  id: uuid.optional(),
  actor: actorSchema,
  verb: verbSchema,
  object: statementObjectSchema,
  result: resultSchema.optional(),
  context: contextSchema.optional(),
  timestamp: timestamp.optional(),
  stored: z.string().optional(),
  authority: authoritySchema.optional(),
  version: xapiVersion.optional(),
  attachments: z.array(attachmentSchema).optional(),
}).strict().refine((stmt) => {
  // Voiding statements must target a StatementRef
  if (stmt.verb.id === VOIDING_VERB) {
    return (stmt.object as Record<string, unknown>).objectType === 'StatementRef';
  }
  return true;
}, 'Voiding statement must have a StatementRef as its object').refine((stmt) => {
  // xAPI §4.1.6: revision and platform only valid when object is an Activity
  const obj = stmt.object as Record<string, unknown>;
  const isActivity = !obj.objectType || obj.objectType === 'Activity';
  if (!isActivity && stmt.context) {
    const ctx = stmt.context as Record<string, unknown>;
    if (ctx.revision !== undefined || ctx.platform !== undefined) return false;
  }
  return true;
}, 'Context revision and platform properties require the Statement object to be an Activity').transform((stmt) => {
  const { stored: _s, version: _v, ...rest } = stmt;
  return rest;
});

// ---------------------------------------------------------------------------
// Batch schema for POST /statements
// ---------------------------------------------------------------------------

export const statementBatchSchema = z.union([
  statementSchema,
  z.array(statementSchema),
]);

// ---------------------------------------------------------------------------
// Validation helpers for controllers
// ---------------------------------------------------------------------------

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}

export function validateStatement(data: unknown): Statement {
  const result = z.safeParse(statementSchema, data);
  if (!result.success) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid statement: ${formatIssues(result.error.issues)}`);
  }
  return result.data as Statement;
}

export function validateStatementBatch(data: unknown): readonly Statement[] {
  const batch = Array.isArray(data) ? data : [data];
  return batch.map((s, i) => {
    const result = z.safeParse(statementSchema, s);
    if (!result.success) {
      throw new HttpError(400, 'BAD_REQUEST', `Invalid statement at index ${String(i)}: ${formatIssues(result.error.issues)}`);
    }
    return result.data as Statement;
  });
}
