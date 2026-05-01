/**
 * ADL xAPI 1.0.3 Conformance Test — Per-Section Vitest Wrapper
 *
 * Runs the full ADL suite once, then reports results as 33 individual
 * Vitest tests (one per xAPI spec section). Each failing requirement
 * is reported via expect.soft() for granular diagnostics.
 *
 * Usage:
 *   pnpm test:conformance
 *   pnpm test:conformance -- --grep "Communication 2.1"
 *   CONFORMANCE_GREP="XAPI-00139" pnpm test:conformance
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  runConformanceSuite,
  collectLeafTests,
  type ConformanceSuiteResult,
  type CleanLogNode,
} from './run-adl-suite.ts';

/** ADL v1_0_3 spec sections — one per test file, matched by parenthetical ref in suite title. */
const SPEC_SECTIONS = [
  { ref: 'Data 2.2', label: 'Formatting Requirements' },
  { ref: 'Data 2.3', label: 'Statement Lifecycle' },
  { ref: 'Data 2.4.1', label: 'ID Property' },
  { ref: 'Data 2.4.2', label: 'Actor Property' },
  { ref: 'Data 2.4.3', label: 'Verb Property' },
  { ref: 'Data 2.4.4', label: 'Object Property' },
  { ref: 'Data 2.4.5', label: 'Result Property' },
  { ref: 'Data 2.4.6', label: 'Context Property' },
  { ref: 'Data 2.4.7', label: 'Timestamp Property' },
  { ref: 'Data 2.4.8', label: 'Stored Property' },
  { ref: 'Data 2.4.9', label: 'Authority Property' },
  { ref: 'Data 2.4.10', label: 'Version Property' },
  { ref: 'Data 2.4.11', label: 'Attachments Property' },
  { ref: 'Data 2.5', label: 'Retrieval of Statements' },
  { ref: 'Data 2.6', label: 'Signed Statements' },
  { ref: 'Data 4.0', label: 'Special Data Types and Rules' },
  { ref: 'Communication 1.1', label: 'HEAD Request Implementation' },
  { ref: 'Communication 1.2', label: 'Headers' },
  { ref: 'Communication 1.3', label: 'Alternate Request Syntax' },
  { ref: 'Communication 1.4', label: 'Encoding' },
  { ref: 'Communication 1.5', label: 'Content Types' },
  { ref: 'Communication 2.1', label: 'Statement Resource' },
  { ref: 'Communication 2.2', label: 'Document Resources' },
  { ref: 'Communication 2.3', label: 'State Resource' },
  { ref: 'Communication 2.4', label: 'Agents Resource' },
  { ref: 'Communication 2.5', label: 'Activities Resource' },
  { ref: 'Communication 2.6', label: 'Agent Profile Resource' },
  { ref: 'Communication 2.7', label: 'Activity Profile Resource' },
  { ref: 'Communication 2.8', label: 'About Resource' },
  { ref: 'Communication 3.1', label: 'Concurrency' },
  { ref: 'Communication 3.2', label: 'Error Codes' },
  { ref: 'Communication 3.3', label: 'Versioning' },
  { ref: 'Communication 4.0', label: 'Authentication' },
] as const;

let result: ConformanceSuiteResult;

function findSection(ref: string): CleanLogNode | undefined {
  return result.log?.tests.find((t) => t.title.includes(`(${ref})`));
}

describe('ADL Conformance', () => {
  beforeAll(async () => {
    result = await runConformanceSuite({
      timeout: 300_000,
      grep: process.env.CONFORMANCE_GREP,
      onSectionStart: (title) => console.log(`  ▸ ${title}`),
    });
    expect(result.state).toBe('finished');
    expect(result.total).toBeGreaterThan(0);
  }, 360_000);

  it.each(SPEC_SECTIONS)('$ref — $label', ({ ref }) => {
    const section = findSection(ref);
    if (!section) {
      // Some ADL sections have an empty describe() with no tests (e.g., Headers).
      // Skip rather than fail — the section simply has no requirements to check.
      return;
    }

    const leaves = collectLeafTests(section);
    for (const leaf of leaves) {
      if (leaf.status === 'failed') {
        const req = leaf.requirement ? `[${leaf.requirement}] ` : '';
        expect.soft(leaf.status, `${req}${leaf.title}: ${leaf.error}`).toBe('passed');
      }
    }

    const failures = leaves.filter((l) => l.status === 'failed');
    expect(failures).toHaveLength(0);
  });

  it('summary', () => {
    console.log(
      `\nADL Conformance: ${result.passing}/${result.total} passing, ` +
        `${result.failing} failing (${(result.duration / 1000).toFixed(1)}s)`,
    );
  });
});
