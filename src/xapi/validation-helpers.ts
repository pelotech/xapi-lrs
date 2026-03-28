/**
 * xAPI Statement Validation Types and Helpers
 *
 * Shared types and the IRI validator used by statement-schema.ts.
 */

// ============================================================================
// Validation result types
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; statement: import("../xapi-types/index.ts").XAPIValidatedStatement }
  | { valid: false; errors: ValidationError[] };

// ============================================================================
// IRI validation (used as Zod refinement)
// ============================================================================

/** IRI validation: scheme must match RFC 3986 §3.1, no unencoded spaces */
const IRI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/;

export function isValidIRI(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!IRI_SCHEME_RE.test(value)) return false;
  if (value.includes(" ")) return false;
  return true;
}
