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
