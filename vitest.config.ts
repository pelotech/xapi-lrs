import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: {
      NODE_ENV: 'test',
      API_PORT: '0',
      ADMIN_PORT: '0',
      ...(process.env['DATABASE_URL'] ? { DATABASE_URL: process.env['DATABASE_URL'] } : {}),
    },
    exclude: ['node_modules/**', '.docker-build/**', 'test/lrs-conformance-test-suite/**'],
    include: ['src/**/*.spec.ts'],
    reporters: process.env['GITHUB_ACTIONS']
      ? ['verbose', 'github-actions', 'junit']
      : ['verbose', 'junit'],
    outputFile: { junit: './test-results/xapi-lrs.xml' },
  },
  plugins: [tsconfigPaths()],
});
