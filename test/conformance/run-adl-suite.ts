/**
 * ADL xAPI Conformance Test Suite Runner for the LRS package.
 *
 * Programmatically invokes the official ADL LRS conformance test suite
 * (adlnet/lrs-conformance-test-suite) against the standalone LRS service,
 * in either the v1_0_3 or v2_0 battery.
 */

import { createRequire } from 'node:module';
import { createBasicAuth } from '../integration/basic-auth.ts';
import { truncateLrsqlTables } from '../integration/test-db.ts';
import { createLrsTestServer } from '../integration/test-server.ts';
import type { LrsTestServerHandle } from '../integration/test-server.ts';
import { parseXapiVersion, type XapiVersion } from './spec-sections.ts';

// The ADL test runner is a CJS module — use createRequire to load it.
const require = createRequire(import.meta.url);
const { testRunner: TestRunner } = require('adl-lrs-conformance-tests/bin/testRunner.js');

// ============================================================================
// Types
// ============================================================================

export interface CleanLogNode {
  title: string;
  name: string;
  requirement: string;
  log: string;
  status: string;
  error?: string;
  tests: CleanLogNode[];
}

export interface ConformanceSuiteResult {
  passing: number;
  failing: number;
  pending: number;
  total: number;
  duration: number;
  state: string;
  version: string;
  failures: Array<{ title: string; requirement: string; error: string }>;
  pendingTests: Array<{ title: string; suite: string }>;
  log: CleanLogNode | undefined;
}

// ============================================================================
// Helpers
// ============================================================================

/** Recursively collect all leaf tests from a log subtree. */
export function collectLeafTests(node: CleanLogNode): CleanLogNode[] {
  if (node.tests.length === 0) return [node];
  return node.tests.flatMap(collectLeafTests);
}

/** Recursively collect all failed leaf tests from the log tree. */
function collectFailures(log: CleanLogNode | undefined, failures: ConformanceSuiteResult['failures']): void {
  if (!log) return;
  if (log.status === 'failed' && log.tests.length === 0) {
    failures.push({
      title: log.title,
      requirement: log.requirement,
      error: log.error ?? 'unknown',
    });
  }
  for (const child of log.tests) {
    collectFailures(child, failures);
  }
}

/** Recursively collect all pending/cancelled leaf tests from the log tree. */
function collectPending(
  log: CleanLogNode | undefined,
  suitePath: string,
  pending: ConformanceSuiteResult['pendingTests'],
): void {
  if (!log) return;
  const currentPath = suitePath ? `${suitePath} > ${log.title}` : log.title;
  if (log.tests.length === 0 && log.status !== 'passed' && log.status !== 'failed') {
    pending.push({ title: log.title, suite: suitePath });
  }
  for (const child of log.tests) {
    collectPending(child, currentPath, pending);
  }
}

// ============================================================================
// Main runner
// ============================================================================

export interface RunOptions {
  /** Which ADL battery to run. Default: '1.0.3'. */
  xapiVersion?: XapiVersion;
  /** Mocha grep pattern to filter tests (e.g., "XAPI-00113" or "Statement Resource"). */
  grep?: string;
  /**
   * Timeout in ms to wait for the suite to finish. Default: 600_000 (10 min) —
   * deliberately raised from the old 180_000: full official batteries run
   * longer than the fork's, especially under pglite.
   */
  timeout?: number;
  /** Called when a top-level ADL suite section starts running. */
  onSectionStart?: (title: string) => void;
}

/**
 * Run the ADL conformance suite against a fresh LRS test server instance.
 *
 * Spins up the server, creates lrs_credential + scopes, runs the suite,
 * then tears everything down.
 */
export async function runConformanceSuite(options: RunOptions = {}): Promise<ConformanceSuiteResult> {
  const { xapiVersion = '1.0.3', grep, timeout = 600_000, onSectionStart } = options;

  let server: LrsTestServerHandle | undefined;

  try {
    // 1. Start test server
    server = await createLrsTestServer();

    // 2. Create Basic Auth credentials (admin_account + lrs_credential + scopes)
    const basicAuth = await createBasicAuth(server.pool, {
      label: 'ADL Conformance Suite',
    });

    // basicAuth is Base64-encoded "apiKey:secretKey"
    const [authUser, authPass] = Buffer.from(basicAuth, 'base64').toString().split(':');

    // 3. Build the xAPI endpoint URL
    const endpoint = `${server.apiUrl}/xapi`;

    // 4. Run the ADL suite via TestRunner
    const result = await new Promise<ConformanceSuiteResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        runner.cancel();
        reject(new Error(`ADL conformance suite timed out after ${timeout}ms`));
      }, timeout);

      const runner = new TestRunner(
        'xAPI LRS Conformance',
        null,
        {
          endpoint,
          basicAuth: true,
          authUser,
          authPass,
          // xapiVersion MUST live in flags (3rd arg): the suite's child process
          // receives flags as its option set. A `directory` entry in the 5th
          // (options) arg is ignored, and an unspecified version silently
          // defaults to the v2_0 battery.
          xapiVersion,
        },
        null,
        { grep },
        'mustPassAll',
      );

      runner.on('message', (msg: { action: string; payload: unknown }) => {
        if (msg.action === 'suite start') {
          onSectionStart?.(String(msg.payload));
        }
        if (msg.action === 'end') {
          clearTimeout(timer);

          const record = runner.getCleanRecord();
          const failures: ConformanceSuiteResult['failures'] = [];
          collectFailures(record.log, failures);
          const pendingTests: ConformanceSuiteResult['pendingTests'] = [];
          collectPending(record.log, '', pendingTests);

          const passing = runner.summary.passed ?? 0;
          const failing = runner.summary.failed ?? 0;
          resolve({
            passing,
            failing,
            pending: (runner.summary.total ?? 0) - passing - failing,
            total: runner.summary.total ?? 0,
            duration: runner.duration ?? 0,
            state: runner.state,
            version: runner.summary.version ?? 'unknown',
            failures,
            pendingTests,
            log: record.log as CleanLogNode | undefined,
          });
        }
      });

      runner.start();
    });

    return result;
  } finally {
    if (server) {
      if (process.env['DATABASE_DRIVER'] !== 'pglite') {
        await truncateLrsqlTables(server.pool);
      }
      await server.close();
    }
  }
}

// ============================================================================
// CLI entrypoint — run directly with: npx tsx test/conformance/run-adl-suite.ts
// ============================================================================

const isMain = process.argv[1]?.endsWith('run-adl-suite.ts') || process.argv[1]?.endsWith('run-adl-suite.js');

if (isMain) {
  const args = process.argv.slice(2);

  const unknown = args.find((a) => a.startsWith('-') && !a.startsWith('--xapi-version='));
  if (unknown) {
    console.error(`Unknown flag: ${unknown}`);
    process.exit(2);
  }

  const versionFlag = args.find((a) => a.startsWith('--xapi-version='));
  const grep = args.find((a) => !a.startsWith('-')); // first positional arg is grep pattern

  let xapiVersion: XapiVersion;
  try {
    xapiVersion = parseXapiVersion(versionFlag?.slice('--xapi-version='.length));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  console.log(`Starting ADL xAPI ${xapiVersion} Conformance Suite (LRS)...`);
  if (grep) console.log(`  Grep filter: ${grep}`);

  runConformanceSuite({ grep, xapiVersion })
    .then((result) => {
      console.log('\n=== ADL Conformance Suite Results (LRS) ===');
      console.log(`  Version:  ${result.version}`);
      console.log(`  State:    ${result.state}`);
      console.log(`  Total:    ${result.total}`);
      console.log(`  Passing:  ${result.passing}`);
      console.log(`  Failing:  ${result.failing}`);
      console.log(`  Pending:  ${result.pending}`);
      console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);

      if (result.failures.length > 0) {
        console.log(`\n--- ${result.failures.length} Failing Tests ---`);
        for (const f of result.failures) {
          const req = f.requirement ? ` [${f.requirement}]` : '';
          console.log(`  FAIL${req}: ${f.title}`);
          console.log(`        ${f.error}`);
        }
      }

      if (result.pendingTests.length > 0) {
        // Group pending tests by their parent suite
        const bySuite = new Map<string, string[]>();
        for (const p of result.pendingTests) {
          const key = p.suite || '(root)';
          if (!bySuite.has(key)) bySuite.set(key, []);
          bySuite.get(key)!.push(p.title);
        }
        console.log(`\n--- ${result.pendingTests.length} Pending Tests (by suite) ---`);
        for (const [suite, tests] of bySuite) {
          console.log(`  ${suite} (${tests.length})`);
          for (const t of tests.slice(0, 5)) {
            console.log(`    - ${t}`);
          }
          if (tests.length > 5) {
            console.log(`    ... and ${tests.length - 5} more`);
          }
        }
      }

      process.exit(result.failing > 0 || result.pending > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Conformance suite failed:', err);
      process.exit(2);
    });
}
