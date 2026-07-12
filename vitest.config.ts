import { defineConfig } from 'vitest/config';

// Set NODE_ENV before any test modules are imported (suppresses pino logging)
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    envFile: '.env.test',
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
          pool: 'threads',
          fileParallelism: true,
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          pool: 'forks',
          // Files run in parallel. Under the pg driver every worker shares ONE
          // Postgres database; each file uses unique random credentials and
          // queries by specific ids, so parallel forks don't collide. The one
          // exception — bootstrap.test.ts, whose assertions are whole-table and
          // whose beforeEach TRUNCATEs shared tables — is isolated into its own
          // schema (see bootstrap.test.ts), so it can't clobber peers.
          fileParallelism: true,
          sequence: { groupOrder: 2 },
          testTimeout: 30_000,
          hookTimeout: 30_000,
          retry: 1,
        },
      },
      {
        test: {
          name: 'conformance',
          environment: 'node',
          include: ['test/conformance/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          pool: 'forks',
          maxWorkers: 1,
          fileParallelism: false,
          sequence: { groupOrder: 3 },
          testTimeout: 200_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
