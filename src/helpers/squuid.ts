/**
 * SQUUID — Sequential UUID
 *
 * Matches lrsql's com.yetanalytics/squuid format:
 * - Start with a random UUID v4 (crypto.randomUUID)
 * - Overwrite the top 48 bits with current millis
 * - Version nibble (bits 48-51) stays 0100 (v4)
 * - Result looks like a standard v4 UUID
 *
 * SQUUIDs sort chronologically when compared as strings because the
 * most-significant 48 bits encode the timestamp. Within the same
 * millisecond, ordering is random.
 */

/**
 * Generate a SQUUID: a time-sortable UUID v4-compatible identifier.
 *
 * @param now - Optional timestamp in millis (defaults to Date.now()).
 *              Exposed for testing determinism.
 */
export function squuid(now: number = Date.now()): string {
  const base = crypto.randomUUID();

  // Encode timestamp into the first 12 hex chars (48 bits)
  const hex = now.toString(16).padStart(12, '0');

  // UUID format: xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  // We overwrite positions 0-7 (8 chars), skip dash, 9-12 (4 chars) = 12 hex chars
  // But we must preserve the version nibble at position 14 (the 'M' = '4')
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    base.slice(14) // keeps '4xxx-Nxxx-xxxxxxxxxxxx'
  );
}

/**
 * Generate a "minimum" SQUUID for a given timestamp.
 * Used for since/until boundary comparisons — all random bits zeroed,
 * sorts before any real SQUUID at the same millisecond.
 */
export function squuidMin(timestampMs: number): string {
  const hex = timestampMs.toString(16).padStart(12, '0');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-0000-0000-000000000000'
  );
}

/**
 * Extract the timestamp (millis since epoch) from a SQUUID.
 */
export function squuidTimestamp(id: string): number {
  const hex = id.slice(0, 8) + id.slice(9, 13);
  return parseInt(hex, 16);
}
