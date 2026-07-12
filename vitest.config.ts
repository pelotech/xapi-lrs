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
          // Serialize integration files. Under the pg driver every worker shares
          // ONE Postgres database, and bootstrap.test.ts TRUNCATEs the shared
          // credential/account tables in beforeEach — running files in parallel
          // lets that truncation clobber other files' file-scoped credentials
          // (spurious 401/500s). The pglite driver gives each fork its own
          // in-memory database, so this only bit real pg. Files each use unique
          // random credentials and query by specific ids, so serial execution
          // against the shared DB is safe. Conformance is already serialized.
          //
          // This is a stopgap: the principled fix — isolating bootstrap.test.ts's
          // shared-table truncation so fileParallelism can be restored — is folded
          // into Task 9's test-provisioning rework.
          maxWorkers: 1,
          fileParallelism: false,
          sequence: { concurrent: false, groupOrder: 2 },
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
