/**
 * Supported xAPI protocol versions.
 *
 * Single source of truth for the versions the LRS negotiates and advertises.
 * Consumed by the version-negotiation middleware (src/app.ts), the About
 * resource (src/routes/about.ts), and the HonoEnv context type. Phase 2B will
 * extend the version-specific behavior; new supported patches go here.
 */

/** Every xAPI version this LRS supports, in ascending order. */
export const SUPPORTED_VERSIONS = ['1.0.3', '2.0.0'] as const;

/** A version string the LRS supports (one of {@link SUPPORTED_VERSIONS}). */
export type XapiVersion = (typeof SUPPORTED_VERSIONS)[number];

/**
 * The version string echoed for an accepted request of each major.minor line.
 * A request may send any patch (or omit the patch, e.g. `2.0`); we negotiate it
 * to the latest patch we implement for that line.
 */
export const LATEST_PATCH = {
  '1.0': '1.0.3',
  '2.0': '2.0.0',
} as const satisfies Record<'1.0' | '2.0', XapiVersion>;

/** The newest supported version — used as the default echo when none is negotiated. */
export const LATEST_VERSION: XapiVersion = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];

/**
 * True when the negotiated version is on the 2.x line. Behavior gates (2.0-only
 * schema features, State-resource concurrency, ...) MUST use this rather than an
 * exact `=== '2.0.0'` literal, so that a future patch (e.g. `2.0.1`) keeps the
 * 2.0 behavior instead of silently falling back to 1.0. Exact-string logic that
 * legitimately deals in patches (negotiation, {@link LATEST_PATCH}) stays literal.
 */
export function isV2(version: XapiVersion): boolean {
  return version.startsWith('2.');
}
