/**
 * xAPI Statement Comparison
 *
 * Implements §2.3.1 Statement Comparison Requirements for signed statement
 * payload equivalence validation. Strips immutability exception fields
 * before deep comparison.
 */

/**
 * Fields that the LRS may assign or modify per §2.3.1 immutability exceptions.
 * These are stripped before comparison so that a signed payload (which omits
 * these fields) is logically equivalent to the received statement (which has
 * them filled in by the LRS).
 */
const EXCEPTION_FIELDS = [
  "id",
  "authority",
  "stored",
  "timestamp",
  "version",
  "attachments",
] as const;

function stripExceptions(stmt: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...stmt };
  for (const f of EXCEPTION_FIELDS) delete copy[f];
  return copy;
}

/**
 * Recursive deep equality check. Handles objects, arrays, and primitives.
 * Treats `undefined` and missing keys equivalently.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  // null/undefined equivalence for missing keys
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of allKeys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Compare a signed statement payload against the received statement,
 * ignoring differences caused by immutability exceptions (§2.3.1).
 *
 * Returns true if the statements are logically equivalent.
 */
export function statementsEquivalent(
  signed: Record<string, unknown>,
  received: Record<string, unknown>,
): boolean {
  return deepEqual(stripExceptions(signed), stripExceptions(received));
}
