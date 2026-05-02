/**
 * xAPI 1.0.3 Statement Validator
 *
 * Main entry point. Validates incoming statements using Zod schemas
 * defined in statement-schema.ts.
 */

import { uuidv7 } from 'uuidv7';
import type { ZodIssue } from 'zod';
import type { XAPIValidatedStatement } from '../xapi-types/index.ts';
import { statementInputSchema } from './statement-schema.ts';
import type { ValidationError, ValidationResult } from './validation-helpers.ts';

export type { ValidationError, ValidationResult };

export function validateStatement(input: unknown): ValidationResult {
  // Pre-check for better error message on non-objects
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: [{ path: '', message: 'Statement must be a JSON object' }] };
  }

  const result = statementInputSchema.safeParse(input);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(zodIssueToValidationError),
    };
  }

  // Server-side generation: strip client-provided stored/authority (server-set only)
  const stmt = { ...result.data } as Record<string, unknown>;
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

function zodIssueToValidationError(issue: ZodIssue): ValidationError {
  return {
    path: issue.path.map(String).join('.'),
    message: issue.message,
  };
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
  if (actor.objectType === 'Group') return false;
  if (!('account' in actor) || actor.account === undefined) return false;
  // Object must be Activity or StatementRef
  const obj = statement.object;
  const ot = obj.objectType ?? 'Activity';
  if (ot !== 'Activity' && ot !== 'StatementRef') return false;
  return true;
}
