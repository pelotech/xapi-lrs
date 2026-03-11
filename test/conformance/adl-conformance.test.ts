/**
 * ADL xAPI 1.0.3 Conformance Test — Vitest Wrapper
 *
 * Runs the official ADL LRS conformance test suite as a single Vitest test.
 * Guarded by CONFORMANCE=1 env var so it doesn't run in normal test passes.
 *
 * Usage:
 *   CONFORMANCE=1 pnpm vitest run --project conformance
 *   pnpm test:conformance
 */

import { describe, it, expect } from "vitest";
import { runConformanceSuite } from "./run-adl-suite.ts";

const ENABLED = process.env.CONFORMANCE === "1";

describe.skipIf(!ENABLED)("ADL xAPI 1.0.3 Conformance (LRS)", () => {
  it(
    "passes the official ADL LRS conformance test suite",
    { timeout: 360_000 },
    async () => {
      const result = await runConformanceSuite({ timeout: 300_000 });

      // Always log the summary for visibility in CI output
      console.log(
        `\nADL Conformance (LRS): ${result.passing}/${result.total} passing, ${result.failing} failing (${(result.duration / 1000).toFixed(1)}s)`,
      );

      if (result.failures.length > 0) {
        console.log("\nFailing requirements:");
        for (const f of result.failures) {
          const req = f.requirement ? ` [${f.requirement}]` : "";
          console.log(`  FAIL${req}: ${f.title}`);
        }
      }

      expect(result.state).toBe("finished");
      expect(result.total).toBeGreaterThan(0);
      expect(result.failing).toBe(0);
    },
  );
});
