/**
 * Shared xAPI-version plumbing for the ADL conformance harness.
 *
 * Holds the per-battery spec section maps (used to bucket the suite's flat
 * test log into one Vitest test per top-level describe()), the pending-test
 * allowlist, and the total-test-count floors used by adl-conformance.test.ts
 * to guard against silent coverage loss.
 */

export type XapiVersion = '1.0.3' | '2.0.0';

export function parseXapiVersion(raw: string | undefined): XapiVersion {
  if (raw === undefined || raw === '1.0.3') return '1.0.3';
  if (raw === '2.0.0') return '2.0.0';
  throw new Error(`Unsupported xAPI conformance version: ${raw} (expected "1.0.3" or "2.0.0")`);
}

export interface SpecSection {
  /** Unique substring of the battery's top-level describe() title. */
  match: string;
  /** Human-readable label for vitest output. */
  label: string;
  /**
   * The suite ships some sections as empty describe() blocks that never emit
   * a `suite start` event; those may be absent from the log without failing.
   */
  mayBeAbsent?: boolean;
}

/** One entry per top-level describe() in the v1_0_3 battery (33 sections). */
const SPEC_SECTIONS_1_0_3: SpecSection[] = [
  { match: '(Data 2.2)', label: 'Formatting Requirements' },
  { match: '(Data 2.3)', label: 'Statement Lifecycle' },
  { match: '(Data 2.4.1)', label: 'ID Property' },
  { match: '(Data 2.4.2)', label: 'Actor Property' },
  { match: '(Data 2.4.3)', label: 'Verb Property' },
  { match: '(Data 2.4.4)', label: 'Object Property' },
  { match: '(Data 2.4.5)', label: 'Result Property' },
  { match: '(Data 2.4.6)', label: 'Context Property' },
  { match: '(Data 2.4.7)', label: 'Timestamp Property' },
  { match: '(Data 2.4.8)', label: 'Stored Property' },
  { match: '(Data 2.4.9)', label: 'Authority Property' },
  { match: '(Data 2.4.10)', label: 'Version Property' },
  { match: '(Data 2.4.11)', label: 'Attachments Property' },
  { match: '(Data 2.5)', label: 'Retrieval of Statements' },
  { match: '(Data 2.6)', label: 'Signed Statements' },
  { match: '(Data 4.0)', label: 'Special Data Types and Rules' },
  { match: '(Communication 1.1)', label: 'HEAD Request Implementation' },
  { match: '(Communication 1.2)', label: 'Headers', mayBeAbsent: true },
  { match: '(Communication 1.3)', label: 'Alternate Request Syntax' },
  { match: '(Communication 1.4)', label: 'Encoding' },
  { match: '(Communication 1.5)', label: 'Content Types' },
  { match: '(Communication 2.1)', label: 'Statement Resource' },
  { match: '(Communication 2.2)', label: 'Document Resources' },
  { match: '(Communication 2.3)', label: 'State Resource' },
  { match: '(Communication 2.4)', label: 'Agents Resource' },
  { match: '(Communication 2.5)', label: 'Activities Resource' },
  { match: '(Communication 2.6)', label: 'Agent Profile Resource' },
  { match: '(Communication 2.7)', label: 'Activity Profile Resource' },
  { match: '(Communication 2.8)', label: 'About Resource' },
  { match: '(Communication 3.1)', label: 'Concurrency' },
  { match: '(Communication 3.2)', label: 'Error Codes' },
  { match: '(Communication 3.3)', label: 'Versioning' },
  { match: '(Communication 4.0)', label: 'Authentication' },
];

/** One entry per top-level describe() in the v2_0 battery (34 sections). */
const SPEC_SECTIONS_2_0_0: SpecSection[] = [
  { match: '(Data 2.2)', label: 'Formatting Requirements' },
  { match: '(Data 2.3)', label: 'Statement Lifecycle (Voiding)' },
  { match: '(Data 2.4.1)', label: 'ID Property' },
  { match: '(Data 2.4.2)', label: 'Actor Property' },
  { match: '(Data 2.4.3)', label: 'Verb Property' },
  { match: '(Data 2.4.4)', label: 'Object Property' },
  { match: '(Data 2.4.5)', label: 'Result Property' },
  { match: '(Data 2.4.6)', label: 'Context Property' },
  { match: '(Data 2.4.7)', label: 'Timestamp Property' },
  { match: '(Data 2.4.8)', label: 'Stored Property' },
  { match: '(Data 2.4.9)', label: 'Authority Property' },
  { match: '(Data 2.4.10)', label: 'Version Property' },
  { match: '(Data 2.4.11)', label: 'Attachments Property' },
  { match: '(Data 2.5)', label: 'Retrieval of Statements' },
  { match: '(Data 2.6)', label: 'Signed Statements' },
  { match: '(Data 4.0)', label: 'Special Data Types and Rules' },
  { match: '(4.2.7)', label: 'Additional Requirements for Data Types' },
  { match: '(Communication 1.1)', label: 'HEAD Request Implementation' },
  // Confirmed genuinely absent in the executed post-negotiation run (2026-07-13,
  // suite 5bc232d): the section ships as an empty describe() and emits no
  // `suite start`. All 33 other mapped sections ran. Keep mayBeAbsent.
  { match: '(Communication 1.2)', label: 'Headers', mayBeAbsent: true },
  // The v2_0 battery titles this section '(4.1.4) Concurrency'; it has no
  // '(Communication 3.1)' ref:
  { match: '(4.1.4) Concurrency', label: 'Concurrency' },
  // Single placeholder test; alternate request syntax was removed in xAPI 2.0:
  { match: 'Alternate Request Syntax Requirements', label: 'Alternate Request Syntax (placeholder)' },
  { match: '(Communication 1.4)', label: 'Encoding' },
  { match: '(Communication 1.5)', label: 'Content Types' },
  { match: '(Communication 2.1)', label: 'Statement Resource' },
  { match: '(Communication 2.2)', label: 'Document Resources' },
  { match: '(Communication 2.3)', label: 'State Resource' },
  { match: '(Communication 2.4)', label: 'Agents Resource' },
  { match: '(Communication 2.5)', label: 'Activities Resource' },
  { match: '(Communication 2.6)', label: 'Agent Profile Resource' },
  { match: '(Communication 2.7)', label: 'Activity Profile Resource' },
  { match: '(Communication 2.8)', label: 'About Resource' },
  { match: '(Communication 3.2)', label: 'Error Codes' },
  { match: '(Communication 3.3)', label: 'Versioning' },
  { match: '(Communication 4.0)', label: 'Authentication' },
];

export const SPEC_SECTIONS: Record<XapiVersion, SpecSection[]> = {
  '1.0.3': SPEC_SECTIONS_1_0_3,
  '2.0.0': SPEC_SECTIONS_2_0_0,
};

export interface PendingAllowlistEntry {
  /** Parent suite path exactly as reported in `pendingTests[].suite`. */
  suite: string;
  /** Exact leaf-test title as reported by the suite. */
  title: string;
  /** Why this is a suite defect, not an implementation gap. */
  reason: string;
  /** Link to the upstream adlnet/lrs-conformance-test-suite issue. */
  upstreamIssue: string;
}

/**
 * Pending tests tolerated per battery. Must stay empty unless an entry
 * documents a defect in the suite itself, with an upstream issue link; never
 * use it to paper over gaps in our implementation.
 */
export const PENDING_ALLOWLIST: Record<XapiVersion, PendingAllowlistEntry[]> = {
  '1.0.3': [],
  '2.0.0': [],
};

/**
 * Minimum expected total test count per battery, guarding against a shrunken
 * battery (bad grep, dependency change, partial run) passing CI. Each floor
 * is ~95% of the observed total recorded in its entry's comment; update the
 * observed totals (and floors) whenever the pinned suite commit is bumped.
 * Sanity-check the 2.0 floor against the executed-run total once the server
 * accepts 2.0 requests and the battery actually executes.
 */
export const TOTAL_FLOOR: Record<XapiVersion, number> = {
  // 1.0.3 battery observed total: 1365 on 2026-07-10 (suite 5bc232d), floor = 95%
  '1.0.3': 1296,
  // 2.0.0 battery total: 1435 on 2026-07-10 (suite 5bc232d), floor = 95%.
  // Phase 2B closed all 10 failures: the battery is now fully green —
  // observed executed total 1435 (1435 passing, 0 failing, 0 pending) on
  // 2026-07-13, on both the migration and lrsql-takeover schemas. Executed ==
  // registered (no pending), confirming the floor against a real run.
  // See docs/superpowers/plans/2026-07-13-xapi-2.0-phase2b-result.md.
  '2.0.0': 1363,
};
