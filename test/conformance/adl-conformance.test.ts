/**
 * ADL xAPI Conformance Test — Per-Section Vitest Wrapper
 *
 * Runs one full ADL battery (selected by CONFORMANCE_XAPI_VERSION, default
 * 1.0.3), then reports results as one Vitest test per spec section, plus
 * three guards against silent coverage loss:
 *   - a section expected by our map but missing from the log fails
 *   - a pending/cancelled test outside the allowlist fails
 *   - a total test count below the recorded floor fails
 * Guards are skipped when CONFORMANCE_GREP filters the run.
 *
 * The 2.0 battery bootstraps and executes all sections; four sections are
 * still red pending Phase 2B (contextAgents/contextGroups, the 2.0.x version
 * property, Last-Modified headers, State-resource ETag concurrency). See
 * docs/superpowers/plans/2026-07-12-xapi-2.0-negotiation-baseline.md.
 *
 * Usage:
 *   pnpm test:conformance          # 1.0.3 battery
 *   pnpm test:conformance:2.0     # 2.0 battery
 *   CONFORMANCE_GREP="XAPI-00139" pnpm test:conformance
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  runConformanceSuite,
  collectLeafTests,
  type ConformanceSuiteResult,
  type CleanLogNode,
} from './run-adl-suite.ts';
import { parseXapiVersion, PENDING_ALLOWLIST, SPEC_SECTIONS, TOTAL_FLOOR } from './spec-sections.ts';

const XAPI_VERSION = parseXapiVersion(process.env.CONFORMANCE_XAPI_VERSION);
const GREP = process.env.CONFORMANCE_GREP;
const sections = SPEC_SECTIONS[XAPI_VERSION];

let result: ConformanceSuiteResult;

function findSections(match: string): CleanLogNode[] {
  return result.log?.tests.filter((t) => t.title.includes(match)) ?? [];
}

describe(`ADL Conformance (xAPI ${XAPI_VERSION})`, () => {
  beforeAll(async () => {
    if (GREP) console.warn('CONFORMANCE_GREP set; coverage guards are disabled for this run');
    result = await runConformanceSuite({
      xapiVersion: XAPI_VERSION,
      timeout: 600_000,
      grep: GREP,
      onSectionStart: (title) => console.log(`  ▸ ${title}`),
    });
    expect(result.state).toBe('finished');
    expect(result.total, 'suite ran zero tests (empty grep match or battery failed to load)').toBeGreaterThan(0);
  }, 660_000);

  it.each(sections)('$label — $match', ({ match, mayBeAbsent }) => {
    const matched = findSections(match);
    if (matched.length === 0) {
      // Under a grep filter, unmatched sections didn't run.
      if (GREP || mayBeAbsent) return;
      return expect.fail(
        `Expected suite section matching "${match}" was not reported. ` +
          'Either the battery changed shape (update spec-sections.ts) or the run lost coverage.',
      );
    }
    if (matched.length > 1) {
      // Two suites matching one entry means the battery changed shape and the
      // map needs updating; the extra suite must not pass unexamined.
      return expect.fail(
        `Map entry "${match}" matched ${matched.length} suite sections: ` +
          `${matched.map((s) => `"${s.title}"`).join(', ')}. ` +
          'Each entry must match exactly one top-level suite — update spec-sections.ts.',
      );
    }

    const leaves = matched.flatMap(collectLeafTests);
    for (const leaf of leaves) {
      if (leaf.status === 'failed') {
        const req = leaf.requirement ? `[${leaf.requirement}] ` : '';
        expect.soft(leaf.status, `${req}${leaf.title}: ${leaf.error}`).toBe('passed');
      }
    }

    const failures = leaves.filter((l) => l.status === 'failed');
    expect(failures).toHaveLength(0);
  });

  it.skipIf(Boolean(GREP))('maps every reported suite section exactly once', () => {
    for (const suite of result.log?.tests ?? []) {
      const matches = sections.filter((s) => suite.title.includes(s.match));
      expect(
        matches.map((m) => m.label),
        `Suite section "${suite.title}" must match exactly one spec-sections.ts entry`,
      ).toHaveLength(1);
    }
  });

  it.skipIf(Boolean(GREP))('has no pending tests outside the allowlist', () => {
    expect(result.pendingTests.length, 'clean-log pending tree disagrees with runner summary counters').toBe(
      result.pending,
    );
    const allowed = new Set(PENDING_ALLOWLIST[XAPI_VERSION].map((a) => `${a.suite} :: ${a.title}`));
    const unexpected = result.pendingTests.filter((p) => !allowed.has(`${p.suite} :: ${p.title}`));
    for (const p of unexpected) {
      expect.soft(p, `Pending test not in allowlist: [${p.suite}] ${p.title}`).toBeUndefined();
    }
    expect(unexpected).toHaveLength(0);
  });

  it.skipIf(Boolean(GREP))('ran at least the expected number of tests', () => {
    expect(result.total).toBeGreaterThanOrEqual(TOTAL_FLOOR[XAPI_VERSION]);
  });

  it('summary', () => {
    console.log(
      `\nADL Conformance (xAPI ${XAPI_VERSION}): ${result.passing}/${result.total} passing, ` +
        `${result.failing} failing, ${result.pending} pending (${(result.duration / 1000).toFixed(1)}s)`,
    );
  });
});
