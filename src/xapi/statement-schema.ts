/**
 * xAPI 1.0.3 Statement Zod Schemas
 *
 * Defines all validation schemas for xAPI statements using Zod.
 * Schemas are built bottom-up: primitives → actors → activities →
 * result/context → object → statement.
 */

import { z } from 'zod';
import { isValidIRI } from './validation-helpers.ts';

// ============================================================================
// Primitive schemas
// ============================================================================

const iri = z.string().refine(isValidIRI, { message: 'Must be a valid IRI' });
const mboxIri = z.string().regex(/^mailto:[^@]+@.+/, {
  message: 'mbox must be a valid mailto: IRI (e.g. mailto:user@example.com)',
});
const sha1hex = z.string().regex(/^[0-9a-f]{40}$/i, { message: 'mbox_sha1sum must be a 40-character hex string' });
const languageTag = z.string().regex(/^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/);
const languageMap = z.record(languageTag, z.string());
const extensions = z.record(iri, z.unknown());

// ============================================================================
// Account
// ============================================================================

const accountSchema = z
  .object({
    homePage: iri,
    name: z.string(),
  })
  .strict();

// ============================================================================
// Agent (union-of-shapes: exactly one IFI)
// ============================================================================

const agentBase = {
  objectType: z.literal('Agent').optional(),
  name: z.string().optional(),
};

const agentSchema = z.union([
  z.object({ ...agentBase, mbox: mboxIri }).strict(),
  z.object({ ...agentBase, mbox_sha1sum: sha1hex }).strict(),
  z.object({ ...agentBase, openid: iri }).strict(),
  z.object({ ...agentBase, account: accountSchema }).strict(),
]);

// ============================================================================
// Group (union: anonymous + 4 identified)
// ============================================================================

const groupBase = {
  objectType: z.literal('Group'),
  name: z.string().optional(),
};

const anonymousGroup = z
  .object({
    ...groupBase,
    member: z.array(agentSchema).min(1),
  })
  .strict();

const identifiedGroupBase = {
  ...groupBase,
  member: z.array(agentSchema).optional(),
};

const groupSchema = z.union([
  anonymousGroup,
  z.object({ ...identifiedGroupBase, mbox: mboxIri }).strict(),
  z.object({ ...identifiedGroupBase, mbox_sha1sum: sha1hex }).strict(),
  z.object({ ...identifiedGroupBase, openid: iri }).strict(),
  z.object({ ...identifiedGroupBase, account: accountSchema }).strict(),
]);

// ============================================================================
// Actor
// ============================================================================

const actorSchema = z.union([agentSchema, groupSchema]);

// ============================================================================
// Verb
// ============================================================================

const verbSchema = z
  .object({
    id: iri,
    display: languageMap.optional(),
  })
  .strict();

// ============================================================================
// Interaction Component + Activity Definition
// ============================================================================

const interactionComponentSchema = z
  .object({
    id: z.string(),
    description: languageMap.optional(),
  })
  .strict();

const VALID_INTERACTION_TYPES = [
  'true-false',
  'choice',
  'fill-in',
  'long-fill-in',
  'matching',
  'performance',
  'sequencing',
  'likert',
  'numeric',
  'other',
] as const;

const interactionComponentList = z.array(interactionComponentSchema).optional();

const activityDefinitionSchema = z
  .object({
    name: languageMap.optional(),
    description: languageMap.optional(),
    type: iri.optional(),
    moreInfo: iri.optional(),
    interactionType: z.enum(VALID_INTERACTION_TYPES).optional(),
    correctResponsesPattern: z.array(z.string()).optional(),
    choices: interactionComponentList,
    scale: interactionComponentList,
    source: interactionComponentList,
    target: interactionComponentList,
    steps: interactionComponentList,
    extensions: extensions.optional(),
  })
  .strict()
  .superRefine((def, ctx) => {
    const hasInteractionData = [
      def.correctResponsesPattern,
      def.choices,
      def.scale,
      def.source,
      def.target,
      def.steps,
    ].some((v) => v !== undefined);
    if (hasInteractionData && def.interactionType === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['interactionType'],
        message:
          'interactionType is required when correctResponsesPattern, choices, scale, source, target, or steps is present',
      });
    }
  });

// ============================================================================
// Activity
// ============================================================================

const activitySchema = z
  .object({
    objectType: z.literal('Activity').optional(),
    id: iri,
    definition: activityDefinitionSchema.optional(),
  })
  .strict();

// ============================================================================
// StatementRef
// ============================================================================

const statementRefSchema = z
  .object({
    objectType: z.literal('StatementRef'),
    id: z.string().uuid(),
  })
  .strict();

// ============================================================================
// Score + Result
// ============================================================================

const scoreSchema = z
  .object({
    scaled: z.number().min(-1).max(1).optional(),
    raw: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.raw !== undefined && s.min !== undefined && s.raw < s.min) {
      ctx.addIssue({ code: 'custom', path: ['raw'], message: 'raw must be >= min' });
    }
    if (s.raw !== undefined && s.max !== undefined && s.raw > s.max) {
      ctx.addIssue({ code: 'custom', path: ['raw'], message: 'raw must be <= max' });
    }
    if (s.min !== undefined && s.max !== undefined && s.min > s.max) {
      ctx.addIssue({ code: 'custom', path: ['min'], message: 'min must be <= max' });
    }
  });

const resultSchema = z
  .object({
    score: scoreSchema.optional(),
    success: z.boolean().optional(),
    completion: z.boolean().optional(),
    response: z.string().optional(),
    duration: z.string().duration().optional(),
    extensions: extensions.optional(),
  })
  .strict();

// ============================================================================
// Context Activities + Context
// ============================================================================

const activityOrArray = z
  .union([activitySchema, z.array(activitySchema)])
  .transform((v) => (Array.isArray(v) ? v : [v]));

const contextActivitiesSchema = z
  .object({
    parent: activityOrArray.optional(),
    grouping: activityOrArray.optional(),
    category: activityOrArray.optional(),
    other: activityOrArray.optional(),
  })
  .strict();

const contextSchema = z
  .object({
    registration: z.string().uuid().optional(),
    instructor: actorSchema.optional(),
    team: groupSchema.optional(),
    contextActivities: contextActivitiesSchema.optional(),
    revision: z.string().optional(),
    platform: z.string().optional(),
    language: languageTag.optional(),
    statement: statementRefSchema.optional(),
    extensions: extensions.optional(),
  })
  .strict();

// ============================================================================
// Attachment
// ============================================================================

const attachmentSchema = z
  .object({
    usageType: iri,
    display: languageMap,
    description: languageMap.optional(),
    contentType: z.string(),
    length: z.number().int(),
    sha2: z.string(),
    fileUrl: iri.optional(),
  })
  .strict();

// ============================================================================
// Object (Agent/Group as object require objectType)
// ============================================================================

const agentObjectBase = {
  objectType: z.literal('Agent'),
  name: z.string().optional(),
};

const agentObjectSchema = z.union([
  z.object({ ...agentObjectBase, mbox: mboxIri }).strict(),
  z.object({ ...agentObjectBase, mbox_sha1sum: sha1hex }).strict(),
  z.object({ ...agentObjectBase, openid: iri }).strict(),
  z.object({ ...agentObjectBase, account: accountSchema }).strict(),
]);

const groupObjectSchema = groupSchema;

// ============================================================================
// SubStatement
// ============================================================================

// SubStatement object: same as Object but without SubStatement variant
const subStatementObjectSchema = z.union([activitySchema, statementRefSchema, agentObjectSchema, groupObjectSchema]);

/** Shared refinement: context.revision and context.platform are only allowed when Object is an Activity. */
function checkContextActivityOnly(
  data: { object: Record<string, unknown>; context?: unknown },
  ctx: z.RefinementCtx,
): void {
  const objType = (data.object as Record<string, unknown>).objectType ?? 'Activity';
  if (data.context && objType !== 'Activity') {
    const ctxObj = data.context as Record<string, unknown>;
    if (ctxObj.revision !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['context', 'revision'],
        message: 'revision is only allowed when Object is an Activity',
      });
    }
    if (ctxObj.platform !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['context', 'platform'],
        message: 'platform is only allowed when Object is an Activity',
      });
    }
  }
}

const subStatementSchema = z
  .object({
    objectType: z.literal('SubStatement'),
    actor: actorSchema,
    verb: verbSchema,
    object: subStatementObjectSchema,
    result: resultSchema.optional(),
    context: contextSchema.optional(),
    timestamp: z.string().datetime({ offset: true }).optional(),
    attachments: z.array(attachmentSchema).optional(),
  })
  .strict()
  .superRefine(checkContextActivityOnly);

// Full object schema (includes SubStatement)
const objectSchema = z.union([
  activitySchema,
  statementRefSchema,
  subStatementSchema,
  agentObjectSchema,
  groupObjectSchema,
]);

// ============================================================================
// Authority
// ============================================================================

const authoritySchema = z.union([
  agentSchema,
  z
    .object({
      objectType: z.literal('Group'),
      member: z.tuple([agentSchema, agentSchema]),
      name: z.string().optional(),
    })
    .strict(),
]);

// ============================================================================
// Statement (top-level)
// ============================================================================

export const statementInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    actor: actorSchema,
    verb: verbSchema,
    object: objectSchema,
    result: resultSchema.optional(),
    context: contextSchema.optional(),
    timestamp: z.string().datetime({ offset: true }).optional(),
    stored: z.unknown().optional(),
    authority: authoritySchema.optional(),
    version: z
      .string()
      .regex(/^1\.0(\.\d+)?$/, {
        message: 'version must match 1.0.x (e.g. "1.0", "1.0.0", "1.0.3")',
      })
      .optional(),
    attachments: z.array(attachmentSchema).optional(),
  })
  .strict()
  .superRefine(checkContextActivityOnly);
