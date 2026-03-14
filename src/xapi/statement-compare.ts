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
