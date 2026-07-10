/**
 * Shared xAPI-version plumbing for the ADL conformance harness.
 * Section maps, pending allowlist, and total floors are added in Task 3.
 */

export type XapiVersion = '1.0.3' | '2.0.0';

export function parseXapiVersion(raw: string | undefined): XapiVersion {
  if (raw === undefined || raw === '1.0.3') return '1.0.3';
  if (raw === '2.0.0') return '2.0.0';
  throw new Error(`Unsupported xAPI conformance version: ${raw} (expected "1.0.3" or "2.0.0")`);
}
