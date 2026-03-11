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
          maxWorkers: 6,
          fileParallelism: true,
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
