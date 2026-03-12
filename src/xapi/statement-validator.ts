/**
 * xAPI 1.0.3 Statement Validator
 *
 * Hand-written validator implementing the rules from xAPI Data spec sections 2.2–2.6
 * and 4.0. Returns structured validation errors or a validated statement with
 * server-generated id/timestamp.
 */

import { uuidv7 } from "uuidv7";
import type {
  XAPIValidatedStatement,
  XAPIActor,
  XAPIAgent,
  XAPIGroup,
  XAPIVerb,
  XAPIActivityDefinition,
  XAPIResult,
  XAPIScore,
  XAPIContext,
  XAPIContextActivities,
  XAPIAttachmentMeta,
  XAPIInteractionComponent,
} from "../xapi-types/index.ts";

// ============================================================================
// Validation result types
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; statement: XAPIValidatedStatement }
  | { valid: false; errors: ValidationError[] };

// ============================================================================
// Helpers
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

/** IRI validation: scheme must match RFC 3986 §3.1, no unencoded spaces */
const IRI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/;

function isValidIRI(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!IRI_SCHEME_RE.test(value)) return false;
  if (value.includes(" ")) return false;
  return true;
}

/** Basic RFC 5646 language tag validation: one or more alphanumeric subtags separated by hyphens */
const LANG_TAG_RE = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/;

function isValidLanguageTag(tag: string): boolean {
  return LANG_TAG_RE.test(tag);
}

/** ISO 8601 duration: P[nY][nM][nD][T[nH][nM][n[.n]S]] */
const ISO_DURATION_RE =
  /^P(?:\d+W|(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?)$/;

function isValidISO8601Duration(value: string): boolean {
  if (!value.startsWith("P")) return false;
  if (value === "P") return false; // Must have at least one component
  return ISO_DURATION_RE.test(value);
}

/** Check that a timestamp is valid ISO 8601 with timezone info */
function isValidISO8601Timestamp(value: string): boolean {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  // Must have timezone indicator (Z, +HH:MM, -HH:MM)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  return true;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const IFI_KEYS = ["mbox", "mbox_sha1sum", "openid", "account"] as const;

/** Check for null values recursively, except inside extensions */
function findNullValues(obj: unknown, path: string, errors: ValidationError[]): void {
  if (obj === null) {
    errors.push({ path, message: "Null values are not allowed" });
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      findNullValues(obj[i], `${path}[${i}]`, errors);
    }
    return;
  }
  if (isObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      if (key === "extensions") continue; // Nulls allowed inside extensions
      findNullValues(value, `${path}.${key}`, errors);
    }
  }
}

// ============================================================================
// Property allowlists
// ============================================================================

const STATEMENT_ALLOWED_KEYS = new Set([
  "id",
  "actor",
  "verb",
  "object",
  "result",
  "context",
  "timestamp",
  "stored",
  "authority",
  "version",
  "attachments",
]);

const ACTOR_ALLOWED_KEYS = new Set([
  "objectType",
  "name",
  "mbox",
  "mbox_sha1sum",
  "openid",
  "account",
  "member",
]);

const VERB_ALLOWED_KEYS = new Set(["id", "display"]);

const ACTIVITY_ALLOWED_KEYS = new Set(["objectType", "id", "definition"]);

const ACTIVITY_DEFINITION_ALLOWED_KEYS = new Set([
  "name",
  "description",
  "type",
  "moreInfo",
  "interactionType",
  "correctResponsesPattern",
  "choices",
  "scale",
  "source",
  "target",
  "steps",
  "extensions",
]);

const RESULT_ALLOWED_KEYS = new Set([
  "score",
  "success",
  "completion",
  "response",
  "duration",
  "extensions",
]);

const SCORE_ALLOWED_KEYS = new Set(["scaled", "raw", "min", "max"]);

const CONTEXT_ALLOWED_KEYS = new Set([
  "registration",
  "instructor",
  "team",
  "contextActivities",
  "revision",
  "platform",
  "language",
  "statement",
  "extensions",
]);

const CONTEXT_ACTIVITIES_ALLOWED_KEYS = new Set(["parent", "grouping", "category", "other"]);

const STATEMENT_REF_ALLOWED_KEYS = new Set(["objectType", "id"]);

const ATTACHMENT_ALLOWED_KEYS = new Set([
  "usageType",
  "display",
  "description",
  "contentType",
  "length",
  "sha2",
  "fileUrl",
]);

const INTERACTION_COMPONENT_ALLOWED_KEYS = new Set(["id", "description"]);

const SUBSTATEMENT_ALLOWED_KEYS = new Set([
  "objectType",
  "actor",
  "verb",
  "object",
  "result",
  "context",
  "timestamp",
  "attachments",
]);

// ============================================================================
// Sub-validators
// ============================================================================

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  errors: ValidationError[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push({ path, message: `Unknown property "${key}"` });
    }
  }
}

function validateLanguageMap(
  map: unknown,
  path: string,
  errors: ValidationError[],
): map is Record<string, string> {
  if (!isObject(map)) {
    errors.push({ path, message: "Must be an object (Language Map)" });
    return false;
  }
  let valid = true;
  for (const [key, value] of Object.entries(map)) {
    if (!isValidLanguageTag(key)) {
      errors.push({ path: `${path}.${key}`, message: `Invalid language tag "${key}"` });
      valid = false;
    }
    if (typeof value !== "string") {
      errors.push({ path: `${path}.${key}`, message: "Language Map values must be strings" });
      valid = false;
    }
  }
  return valid;
}

function validateAgent(obj: unknown, path: string, errors: ValidationError[]): obj is XAPIAgent {
  if (!isObject(obj)) {
    errors.push({ path, message: "Agent must be an object" });
    return false;
  }

  checkUnknownKeys(obj, ACTOR_ALLOWED_KEYS, path, errors);

  if (obj.objectType !== undefined && obj.objectType !== "Agent") {
    errors.push({
      path: `${path}.objectType`,
      message: 'Agent objectType must be "Agent" if present',
    });
    return false;
  }

  if (obj.member !== undefined) {
    errors.push({ path: `${path}.member`, message: 'Agent must not have "member" property' });
    return false;
  }

  // Count IFIs
  const ifiCount = IFI_KEYS.filter((k) => obj[k] !== undefined).length;
  if (ifiCount === 0) {
    errors.push({
      path,
      message: "Agent must have exactly one IFI (mbox, mbox_sha1sum, openid, or account)",
    });
    return false;
  }
  if (ifiCount > 1) {
    errors.push({ path, message: "Agent must have exactly one IFI, found multiple" });
    return false;
  }

  // Validate specific IFIs
  if (obj.mbox !== undefined) {
    if (
      typeof obj.mbox !== "string" ||
      !obj.mbox.startsWith("mailto:") ||
      obj.mbox.indexOf("@", 7) <= 7
    ) {
      errors.push({
        path: `${path}.mbox`,
        message: "mbox must be a valid mailto: IRI (e.g. mailto:user@example.com)",
      });
      return false;
    }
  }
  if (obj.mbox_sha1sum !== undefined) {
    if (typeof obj.mbox_sha1sum !== "string" || !/^[0-9a-f]{40}$/i.test(obj.mbox_sha1sum)) {
      errors.push({
        path: `${path}.mbox_sha1sum`,
        message: "mbox_sha1sum must be a 40-character hex string",
      });
      return false;
    }
  }
  if (obj.openid !== undefined) {
    if (typeof obj.openid !== "string" || !isValidIRI(obj.openid)) {
      errors.push({ path: `${path}.openid`, message: "openid must be a valid IRI" });
      return false;
    }
  }
  if (obj.account !== undefined) {
    if (!isObject(obj.account)) {
      errors.push({ path: `${path}.account`, message: "account must be an object" });
      return false;
    }
    if (typeof obj.account.homePage !== "string" || !isValidIRI(obj.account.homePage)) {
      errors.push({
        path: `${path}.account.homePage`,
        message: "account.homePage is required and must be a valid IRI",
      });
      return false;
    }
    if (typeof obj.account.name !== "string") {
      errors.push({
        path: `${path}.account.name`,
        message: "account.name is required and must be a string",
      });
      return false;
    }
  }

  if (obj.name !== undefined && typeof obj.name !== "string") {
    errors.push({ path: `${path}.name`, message: "name must be a string" });
    return false;
  }

  return true;
}

function validateGroup(obj: unknown, path: string, errors: ValidationError[]): obj is XAPIGroup {
  if (!isObject(obj)) {
    errors.push({ path, message: "Group must be an object" });
    return false;
  }

  checkUnknownKeys(obj, ACTOR_ALLOWED_KEYS, path, errors);

  if (obj.objectType !== "Group") {
    errors.push({ path: `${path}.objectType`, message: 'Group must have objectType "Group"' });
    return false;
  }

  const ifiCount = IFI_KEYS.filter((k) => obj[k] !== undefined).length;

  if (ifiCount === 0) {
    // Anonymous group — member required
    if (!Array.isArray(obj.member) || obj.member.length === 0) {
      errors.push({
        path: `${path}.member`,
        message: "Anonymous Group must have a non-empty member array",
      });
      return false;
    }
  } else if (ifiCount > 1) {
    errors.push({ path, message: "Identified Group must have exactly one IFI, found multiple" });
    return false;
  } else {
    // Identified group — validate the IFI (same rules as agent)
    if (obj.mbox !== undefined) {
      if (
        typeof obj.mbox !== "string" ||
        !obj.mbox.startsWith("mailto:") ||
        obj.mbox.indexOf("@", 7) <= 7
      ) {
        errors.push({
          path: `${path}.mbox`,
          message: "mbox must be a valid mailto: IRI (e.g. mailto:user@example.com)",
        });
        return false;
      }
    }
    if (obj.mbox_sha1sum !== undefined) {
      if (typeof obj.mbox_sha1sum !== "string" || !/^[0-9a-f]{40}$/i.test(obj.mbox_sha1sum)) {
        errors.push({
          path: `${path}.mbox_sha1sum`,
          message: "mbox_sha1sum must be a 40-character hex string",
        });
        return false;
      }
    }
    if (obj.openid !== undefined) {
      if (typeof obj.openid !== "string" || !isValidIRI(obj.openid)) {
        errors.push({ path: `${path}.openid`, message: "openid must be a valid IRI" });
        return false;
      }
    }
    if (obj.account !== undefined) {
      if (!isObject(obj.account)) {
        errors.push({ path: `${path}.account`, message: "account must be an object" });
        return false;
      }
      if (typeof obj.account.homePage !== "string" || !isValidIRI(obj.account.homePage)) {
        errors.push({
          path: `${path}.account.homePage`,
          message: "account.homePage is required and must be a valid IRI",
        });
        return false;
      }
      if (typeof obj.account.name !== "string") {
        errors.push({ path: `${path}.account.name`, message: "account.name is required" });
        return false;
      }
    }
  }

  // Validate member array if present
  if (obj.member !== undefined) {
    if (!Array.isArray(obj.member)) {
      errors.push({ path: `${path}.member`, message: "member must be an array" });
      return false;
    }
    for (let i = 0; i < obj.member.length; i++) {
      const memberObj = obj.member[i];
      // Members must not be Groups
      if (isObject(memberObj) && memberObj.objectType === "Group") {
        errors.push({ path: `${path}.member[${i}]`, message: "Group member must not be a Group" });
        return false;
      }
      validateAgent(memberObj, `${path}.member[${i}]`, errors);
    }
  }

  if (obj.name !== undefined && typeof obj.name !== "string") {
    errors.push({ path: `${path}.name`, message: "name must be a string" });
    return false;
  }

  return true;
}

function validateActor(obj: unknown, path: string, errors: ValidationError[]): obj is XAPIActor {
  if (!isObject(obj)) {
    errors.push({ path, message: "Actor must be an object" });
    return false;
  }
  if (obj.objectType === "Group") {
    return validateGroup(obj, path, errors);
  }
  return validateAgent(obj, path, errors);
}

function validateVerb(obj: unknown, path: string, errors: ValidationError[]): obj is XAPIVerb {
  if (!isObject(obj)) {
    errors.push({ path, message: "Verb must be an object" });
    return false;
  }

  checkUnknownKeys(obj, VERB_ALLOWED_KEYS, path, errors);

  if (typeof obj.id !== "string" || !isValidIRI(obj.id)) {
    errors.push({ path: `${path}.id`, message: "Verb id is required and must be a valid IRI" });
    return false;
  }

  if (obj.display !== undefined) {
    validateLanguageMap(obj.display, `${path}.display`, errors);
  }

  return true;
}

function validateInteractionComponent(
  obj: unknown,
  path: string,
  errors: ValidationError[],
): obj is XAPIInteractionComponent {
  if (!isObject(obj)) {
    errors.push({ path, message: "Interaction component must be an object" });
    return false;
  }
  checkUnknownKeys(obj, INTERACTION_COMPONENT_ALLOWED_KEYS, path, errors);
  if (typeof obj.id !== "string") {
    errors.push({
      path: `${path}.id`,
      message: "Interaction component id is required and must be a string",
    });
    return false;
  }
  if (obj.description !== undefined) {
    validateLanguageMap(obj.description, `${path}.description`, errors);
  }
  return true;
}

function validateActivityDefinition(
  obj: unknown,
  path: string,
  errors: ValidationError[],
): obj is XAPIActivityDefinition {
  if (!isObject(obj)) {
    errors.push({ path, message: "Activity definition must be an object" });
    return false;
  }

  checkUnknownKeys(obj, ACTIVITY_DEFINITION_ALLOWED_KEYS, path, errors);

  if (obj.name !== undefined) validateLanguageMap(obj.name, `${path}.name`, errors);
  if (obj.description !== undefined)
    validateLanguageMap(obj.description, `${path}.description`, errors);

  if (obj.type !== undefined) {
    if (typeof obj.type !== "string" || !isValidIRI(obj.type)) {
      errors.push({
        path: `${path}.type`,
        message: "Activity definition type must be a valid IRI",
      });
    }
  }

  if (obj.moreInfo !== undefined) {
    if (typeof obj.moreInfo !== "string" || !isValidIRI(obj.moreInfo)) {
      errors.push({ path: `${path}.moreInfo`, message: "moreInfo must be a valid IRL" });
    }
  }

  const VALID_INTERACTION_TYPES = new Set([
    "true-false",
    "choice",
    "fill-in",
    "long-fill-in",
    "matching",
    "performance",
    "sequencing",
    "likert",
    "numeric",
    "other",
  ]);

  if (obj.interactionType !== undefined) {
    if (
      typeof obj.interactionType !== "string" ||
      !VALID_INTERACTION_TYPES.has(obj.interactionType)
    ) {
      errors.push({
        path: `${path}.interactionType`,
        message:
          "interactionType must be one of: true-false, choice, fill-in, long-fill-in, matching, performance, sequencing, likert, numeric, other",
      });
    }
  }

  if (obj.correctResponsesPattern !== undefined) {
    if (!Array.isArray(obj.correctResponsesPattern)) {
      errors.push({
        path: `${path}.correctResponsesPattern`,
        message: "correctResponsesPattern must be an array",
      });
    } else {
      for (let i = 0; i < obj.correctResponsesPattern.length; i++) {
        if (typeof obj.correctResponsesPattern[i] !== "string") {
          errors.push({
            path: `${path}.correctResponsesPattern[${i}]`,
            message: "correctResponsesPattern items must be strings",
          });
        }
      }
    }
  }

  // Validate interaction component lists
  const INTERACTION_DEPENDENT_KEYS = [
    "correctResponsesPattern",
    "choices",
    "scale",
    "source",
    "target",
    "steps",
  ];
  for (const listKey of ["choices", "scale", "source", "target", "steps"] as const) {
    if (obj[listKey] !== undefined) {
      if (!Array.isArray(obj[listKey])) {
        errors.push({ path: `${path}.${listKey}`, message: `${listKey} must be an array` });
      } else {
        for (let i = 0; i < (obj[listKey] as unknown[]).length; i++) {
          validateInteractionComponent(
            (obj[listKey] as unknown[])[i],
            `${path}.${listKey}[${i}]`,
            errors,
          );
        }
      }
    }
  }

  // Interaction-specific properties require interactionType
  const hasInteractionData = INTERACTION_DEPENDENT_KEYS.some((k) => obj[k] !== undefined);
  if (hasInteractionData && obj.interactionType === undefined) {
    errors.push({
      path: `${path}.interactionType`,
      message:
        "interactionType is required when correctResponsesPattern, choices, scale, source, target, or steps is present",
    });
  }

  // Validate extension keys are IRIs
  if (obj.extensions !== undefined) {
    validateExtensions(obj.extensions, `${path}.extensions`, errors);
  }

  return true;
}

/** Validate that extension keys are valid IRIs */
function validateExtensions(obj: unknown, path: string, errors: ValidationError[]): void {
  if (!isObject(obj)) {
    errors.push({ path, message: "extensions must be an object" });
    return;
  }
  for (const key of Object.keys(obj)) {
    if (!isValidIRI(key)) {
      errors.push({
        path: `${path}["${key}"]`,
        message: `Extension key "${key}" must be a valid IRI`,
      });
    }
  }
}

function validateActivity(
  obj: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): boolean {
  checkUnknownKeys(obj, ACTIVITY_ALLOWED_KEYS, path, errors);

  if (typeof obj.id !== "string" || !isValidIRI(obj.id)) {
    errors.push({ path: `${path}.id`, message: "Activity id is required and must be a valid IRI" });
    return false;
  }

  if (obj.definition !== undefined) {
    validateActivityDefinition(obj.definition, `${path}.definition`, errors);
  }

  return true;
}

function validateStatementRef(
  obj: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): boolean {
  checkUnknownKeys(obj, STATEMENT_REF_ALLOWED_KEYS, path, errors);

  if (typeof obj.id !== "string" || !isValidUUID(obj.id)) {
    errors.push({ path: `${path}.id`, message: "StatementRef id must be a valid UUID" });
    return false;
  }

  return true;
}

function validateSubStatement(
  obj: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  _depth: number,
): boolean {
  checkUnknownKeys(obj, SUBSTATEMENT_ALLOWED_KEYS, path, errors);

  // SubStatement must not have id, stored, version, authority
  for (const forbidden of ["id", "stored", "version", "authority"]) {
    if (obj[forbidden] !== undefined) {
      errors.push({
        path: `${path}.${forbidden}`,
        message: `SubStatement must not have "${forbidden}"`,
      });
    }
  }

  if (obj.actor === undefined) {
    errors.push({ path: `${path}.actor`, message: "SubStatement actor is required" });
  } else {
    validateActor(obj.actor, `${path}.actor`, errors);
  }

  if (obj.verb === undefined) {
    errors.push({ path: `${path}.verb`, message: "SubStatement verb is required" });
  } else {
    validateVerb(obj.verb, `${path}.verb`, errors);
  }

  if (obj.object === undefined) {
    errors.push({ path: `${path}.object`, message: "SubStatement object is required" });
  } else {
    // SubStatement object must not be another SubStatement
    if (isObject(obj.object) && obj.object.objectType === "SubStatement") {
      errors.push({
        path: `${path}.object`,
        message: "SubStatement must not contain a nested SubStatement",
      });
    } else {
      validateObject(obj.object, `${path}.object`, errors, true);
    }
  }

  if (obj.result !== undefined) {
    validateResult(obj.result, `${path}.result`, errors);
  }

  if (obj.context !== undefined) {
    validateContext(obj.context, `${path}.context`, errors, obj.object);
  }

  if (obj.timestamp !== undefined) {
    if (typeof obj.timestamp !== "string" || !isValidISO8601Timestamp(obj.timestamp)) {
      errors.push({
        path: `${path}.timestamp`,
        message: "timestamp must be a valid ISO 8601 timestamp with timezone",
      });
    }
  }

  if (obj.attachments !== undefined) {
    validateAttachments(obj.attachments, `${path}.attachments`, errors);
  }

  return true;
}

function validateObject(
  obj: unknown,
  path: string,
  errors: ValidationError[],
  insideSubStatement = false,
): boolean {
  if (!isObject(obj)) {
    errors.push({ path, message: "Object must be an object" });
    return false;
  }

  const objectType = obj.objectType as string | undefined;

  if (objectType === undefined || objectType === "Activity") {
    return validateActivity(obj, path, errors);
  }

  if (objectType === "StatementRef") {
    return validateStatementRef(obj, path, errors);
  }

  if (objectType === "SubStatement") {
    if (insideSubStatement) {
      errors.push({ path, message: "SubStatement must not contain a nested SubStatement" });
      return false;
    }
    return validateSubStatement(obj, path, errors, 1);
  }

  if (objectType === "Agent") {
    return validateAgent(obj, path, errors);
  }

  if (objectType === "Group") {
    return validateGroup(obj, path, errors);
  }

  errors.push({ path: `${path}.objectType`, message: `Unknown objectType "${objectType}"` });
  return false;
}

function validateScore(obj: unknown, path: string, errors: ValidationError[]): obj is XAPIScore {
  if (!isObject(obj)) {
    errors.push({ path, message: "Score must be an object" });
    return false;
  }

  checkUnknownKeys(obj, SCORE_ALLOWED_KEYS, path, errors);

  if (obj.scaled !== undefined) {
    if (typeof obj.scaled !== "number") {
      errors.push({ path: `${path}.scaled`, message: "scaled must be a number" });
    } else if (obj.scaled < -1 || obj.scaled > 1) {
      errors.push({ path: `${path}.scaled`, message: "scaled must be between -1 and 1" });
    }
  }

  if (obj.raw !== undefined && typeof obj.raw !== "number") {
    errors.push({ path: `${path}.raw`, message: "raw must be a number" });
  }
  if (obj.min !== undefined && typeof obj.min !== "number") {
    errors.push({ path: `${path}.min`, message: "min must be a number" });
  }
  if (obj.max !== undefined && typeof obj.max !== "number") {
    errors.push({ path: `${path}.max`, message: "max must be a number" });
  }

  // raw must be between min and max if all three are present
  if (typeof obj.raw === "number") {
    if (typeof obj.min === "number" && obj.raw < obj.min) {
      errors.push({ path: `${path}.raw`, message: "raw must be >= min" });
    }
    if (typeof obj.max === "number" && obj.raw > obj.max) {
      errors.push({ path: `${path}.raw`, message: "raw must be <= max" });
    }
  }
  if (typeof obj.min === "number" && typeof obj.max === "number" && obj.min > obj.max) {
    errors.push({ path: `${path}.min`, message: "min must be <= max" });
  }

  return true;
}

function validateResult(obj: unknown, path: string, errors: ValidationError[]): obj is XAPIResult {
  if (!isObject(obj)) {
    errors.push({ path, message: "Result must be an object" });
    return false;
  }

  checkUnknownKeys(obj, RESULT_ALLOWED_KEYS, path, errors);

  if (obj.score !== undefined) {
    validateScore(obj.score, `${path}.score`, errors);
  }

  if (obj.success !== undefined && typeof obj.success !== "boolean") {
    errors.push({ path: `${path}.success`, message: "success must be a boolean" });
  }

  if (obj.completion !== undefined && typeof obj.completion !== "boolean") {
    errors.push({ path: `${path}.completion`, message: "completion must be a boolean" });
  }

  if (obj.response !== undefined && typeof obj.response !== "string") {
    errors.push({ path: `${path}.response`, message: "response must be a string" });
  }

  if (obj.duration !== undefined) {
    if (typeof obj.duration !== "string" || !isValidISO8601Duration(obj.duration)) {
      errors.push({
        path: `${path}.duration`,
        message: "duration must be a valid ISO 8601 duration",
      });
    }
  }

  // Validate extension keys are IRIs
  if (obj.extensions !== undefined) {
    validateExtensions(obj.extensions, `${path}.extensions`, errors);
  }

  return true;
}

function validateContextActivities(
  obj: unknown,
  path: string,
  errors: ValidationError[],
  out: Record<string, unknown>,
): obj is XAPIContextActivities {
  if (!isObject(obj)) {
    errors.push({ path, message: "contextActivities must be an object" });
    return false;
  }

  checkUnknownKeys(obj, CONTEXT_ACTIVITIES_ALLOWED_KEYS, path, errors);

  // Each value can be a single Activity or an array of Activities — normalize to array
  for (const key of ["parent", "grouping", "category", "other"] as const) {
    if (obj[key] !== undefined) {
      let activities: unknown[];
      if (Array.isArray(obj[key])) {
        activities = obj[key] as unknown[];
      } else if (isObject(obj[key])) {
        // Single Activity — normalize to array
        activities = [obj[key]];
      } else {
        errors.push({
          path: `${path}.${key}`,
          message: `${key} must be an Activity or array of Activities`,
        });
        continue;
      }
      for (let i = 0; i < activities.length; i++) {
        if (!isObject(activities[i])) {
          errors.push({ path: `${path}.${key}[${i}]`, message: "Must be an Activity object" });
          continue;
        }
        validateActivity(activities[i] as Record<string, unknown>, `${path}.${key}[${i}]`, errors);
      }
      // Store normalized array
      (out as Record<string, unknown>)[key] = activities;
    }
  }

  return true;
}

function validateContext(
  obj: unknown,
  path: string,
  errors: ValidationError[],
  statementObject?: unknown,
): obj is XAPIContext {
  if (!isObject(obj)) {
    errors.push({ path, message: "Context must be an object" });
    return false;
  }

  checkUnknownKeys(obj, CONTEXT_ALLOWED_KEYS, path, errors);

  if (obj.registration !== undefined) {
    if (typeof obj.registration !== "string" || !isValidUUID(obj.registration)) {
      errors.push({ path: `${path}.registration`, message: "registration must be a valid UUID" });
    }
  }

  // revision and platform only allowed when Object is Activity
  const objType = isObject(statementObject)
    ? ((statementObject as Record<string, unknown>).objectType ?? "Activity")
    : undefined;
  if (obj.revision !== undefined) {
    if (typeof obj.revision !== "string") {
      errors.push({ path: `${path}.revision`, message: "revision must be a string" });
    }
    if (objType !== undefined && objType !== "Activity") {
      errors.push({
        path: `${path}.revision`,
        message: "revision is only allowed when Object is an Activity",
      });
    }
  }
  if (obj.platform !== undefined) {
    if (typeof obj.platform !== "string") {
      errors.push({ path: `${path}.platform`, message: "platform must be a string" });
    }
    if (objType !== undefined && objType !== "Activity") {
      errors.push({
        path: `${path}.platform`,
        message: "platform is only allowed when Object is an Activity",
      });
    }
  }

  if (obj.language !== undefined) {
    if (typeof obj.language !== "string" || !isValidLanguageTag(obj.language)) {
      errors.push({
        path: `${path}.language`,
        message: "language must be a valid RFC 5646 language tag",
      });
    }
  }

  if (obj.instructor !== undefined) {
    validateActor(obj.instructor, `${path}.instructor`, errors);
  }

  if (obj.team !== undefined) {
    if (!isObject(obj.team) || (obj.team as Record<string, unknown>).objectType !== "Group") {
      errors.push({ path: `${path}.team`, message: "team must be a Group" });
    } else {
      validateGroup(obj.team, `${path}.team`, errors);
    }
  }

  if (obj.contextActivities !== undefined) {
    // Build a mutable copy for normalization
    const normalizedCA: Record<string, unknown> = {};
    validateContextActivities(
      obj.contextActivities,
      `${path}.contextActivities`,
      errors,
      normalizedCA,
    );
    // Replace with normalized version (single Activity → array)
    (obj as Record<string, unknown>).contextActivities = normalizedCA;
  }

  if (obj.statement !== undefined) {
    if (
      !isObject(obj.statement) ||
      (obj.statement as Record<string, unknown>).objectType !== "StatementRef"
    ) {
      errors.push({ path: `${path}.statement`, message: "statement must be a StatementRef" });
    } else {
      validateStatementRef(obj.statement as Record<string, unknown>, `${path}.statement`, errors);
    }
  }

  // Validate extension keys are IRIs
  if (obj.extensions !== undefined) {
    validateExtensions(obj.extensions, `${path}.extensions`, errors);
  }

  return true;
}

function validateAttachments(
  obj: unknown,
  path: string,
  errors: ValidationError[],
): obj is XAPIAttachmentMeta[] {
  if (!Array.isArray(obj)) {
    errors.push({ path, message: "attachments must be an array" });
    return false;
  }

  for (let i = 0; i < obj.length; i++) {
    const att = obj[i];
    const attPath = `${path}[${i}]`;
    if (!isObject(att)) {
      errors.push({ path: attPath, message: "Attachment must be an object" });
      continue;
    }
    checkUnknownKeys(att, ATTACHMENT_ALLOWED_KEYS, attPath, errors);

    if (typeof att.usageType !== "string" || !isValidIRI(att.usageType)) {
      errors.push({
        path: `${attPath}.usageType`,
        message: "usageType is required and must be a valid IRI",
      });
    }
    if (att.display === undefined) {
      errors.push({ path: `${attPath}.display`, message: "display is required" });
    } else {
      validateLanguageMap(att.display, `${attPath}.display`, errors);
    }
    if (att.description !== undefined) {
      validateLanguageMap(att.description, `${attPath}.description`, errors);
    }
    if (typeof att.contentType !== "string") {
      errors.push({
        path: `${attPath}.contentType`,
        message: "contentType is required and must be a string",
      });
    }
    if (typeof att.length !== "number" || !Number.isInteger(att.length)) {
      errors.push({
        path: `${attPath}.length`,
        message: "length is required and must be an integer",
      });
    }
    if (typeof att.sha2 !== "string") {
      errors.push({ path: `${attPath}.sha2`, message: "sha2 is required and must be a string" });
    }
    if (
      att.fileUrl !== undefined &&
      (typeof att.fileUrl !== "string" || !isValidIRI(att.fileUrl))
    ) {
      errors.push({ path: `${attPath}.fileUrl`, message: "fileUrl must be a valid IRL" });
    }
  }

  return true;
}

// ============================================================================
// Main validator
// ============================================================================

export function validateStatement(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isObject(input)) {
    return { valid: false, errors: [{ path: "", message: "Statement must be a JSON object" }] };
  }

  // Work on a shallow copy so we can add generated fields
  const stmt = { ...input } as Record<string, unknown>;

  // Check for null values (except inside extensions)
  findNullValues(stmt, "", errors);

  // Unknown top-level keys
  checkUnknownKeys(stmt, STATEMENT_ALLOWED_KEYS, "", errors);

  // Required properties
  if (stmt.actor === undefined) {
    errors.push({ path: "actor", message: "actor is required" });
  }
  if (stmt.verb === undefined) {
    errors.push({ path: "verb", message: "verb is required" });
  }
  if (stmt.object === undefined) {
    errors.push({ path: "object", message: "object is required" });
  }

  // Bail early if required fields are missing
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate id
  if (stmt.id !== undefined) {
    if (typeof stmt.id !== "string" || !isValidUUID(stmt.id)) {
      errors.push({ path: "id", message: "id must be a valid UUID" });
    }
  }

  // Validate actor
  validateActor(stmt.actor, "actor", errors);

  // Validate verb
  validateVerb(stmt.verb, "verb", errors);

  // Validate object
  validateObject(stmt.object, "object", errors);

  // Validate result
  if (stmt.result !== undefined) {
    validateResult(stmt.result, "result", errors);
  }

  // Validate context
  if (stmt.context !== undefined) {
    validateContext(stmt.context, "context", errors, stmt.object);
  }

  // Validate timestamp
  if (stmt.timestamp !== undefined) {
    if (typeof stmt.timestamp !== "string" || !isValidISO8601Timestamp(stmt.timestamp)) {
      errors.push({
        path: "timestamp",
        message: "timestamp must be a valid ISO 8601 timestamp with timezone",
      });
    }
  }

  // Validate version: must match 1.0 or 1.0.x
  if (stmt.version !== undefined) {
    if (typeof stmt.version !== "string" || !/^1\.0(\.\d+)?$/.test(stmt.version)) {
      errors.push({
        path: "version",
        message: 'version must match 1.0.x (e.g. "1.0", "1.0.0", "1.0.3")',
      });
    }
  }

  // Validate authority (if provided)
  if (stmt.authority !== undefined) {
    validateActor(stmt.authority, "authority", errors);

    // xAPI §4.1.9: Authority Group must be anonymous with exactly 2 members
    if (
      isObject(stmt.authority) &&
      (stmt.authority as Record<string, unknown>).objectType === "Group"
    ) {
      const authGroup = stmt.authority as Record<string, unknown>;
      // Must be anonymous (no IFI on the group itself)
      const groupIfiCount = IFI_KEYS.filter((k) => authGroup[k] !== undefined).length;
      if (groupIfiCount > 0) {
        errors.push({
          path: "authority",
          message: "Authority Group must be anonymous (no IFI on the group)",
        });
      }
      // Must have exactly 2 members
      if (!Array.isArray(authGroup.member) || authGroup.member.length !== 2) {
        errors.push({
          path: "authority.member",
          message: "Authority Group must have exactly 2 members",
        });
      }
    }
  }

  // Validate attachments
  if (stmt.attachments !== undefined) {
    validateAttachments(stmt.attachments, "attachments", errors);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Server-side generation: strip client-provided stored/authority (server-set only)
  delete stmt.stored;
  delete stmt.authority;
  if (stmt.id === undefined) {
    stmt.id = uuidv7();
  }
  if (stmt.timestamp === undefined) {
    stmt.timestamp = new Date().toISOString();
  }

  return { valid: true, statement: stmt as unknown as XAPIValidatedStatement };
}

// ============================================================================
// CMI5 shape detection + narrowing
// ============================================================================

/** Check if all validated statements have the shape expected by the CMI5 registration machine */
export function allHaveCmi5Shape(statements: XAPIValidatedStatement[]): boolean {
  return statements.every(hasCmi5Shape);
}

/** Check if a single validated statement has CMI5-compatible shape */
export function hasCmi5Shape(statement: XAPIValidatedStatement): boolean {
  // Must have context.registration
  if (!statement.context?.registration) return false;
  // Actor must be Agent with account IFI
  const actor = statement.actor;
  if (actor.objectType === "Group") return false;
  if (!("account" in actor) || actor.account === undefined) return false;
  // Object must be Activity or StatementRef
  const obj = statement.object;
  const ot = obj.objectType ?? "Activity";
  if (ot !== "Activity" && ot !== "StatementRef") return false;
  return true;
}

// ============================================================================
// Statement comparison (for duplicate detection)
// ============================================================================

/** Compare two statements for equality, excluding server-set fields (stored, authority, version) */
export function statementsMatch(existing: Record<string, unknown>, incoming: unknown): boolean {
  const a = { ...existing };
  const b = { ...(incoming as Record<string, unknown>) };

  // Remove server-set fields from comparison
  for (const key of ["stored", "authority", "version"]) {
    delete a[key];
    delete b[key];
  }

  // Normalize timestamps to the same instant for comparison
  if (typeof a.timestamp === "string" && typeof b.timestamp === "string") {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    if (ta === tb) {
      // Same instant — treat as matching regardless of timezone representation
      delete a.timestamp;
      delete b.timestamp;
    }
  }

  // Use sorted-key serialization for order-independent comparison
  return stableStringify(a) === stableStringify(b);
}

/** JSON.stringify with sorted keys for deterministic comparison */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]));
  return "{" + parts.join(",") + "}";
}
