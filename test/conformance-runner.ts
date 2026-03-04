/**
 * ADL LRS Conformance Test Suite runner.
 *
 * Starts the xAPI LRS Express server against a real PostgreSQL database,
 * seeds a test tenant with Basic Auth credentials, then spawns the ADL
 * conformance suite as a child process pointed at the local server.
 *
 * Prerequisites:
 *   - Docker PostgreSQL running with migrations applied
 *   - `npm install` in test/lrs-conformance-test-suite/
 *
 * Usage:
 *   pnpm test:conformance:xapi
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import { parseConfigFromEnv } from '../src/core/config.js';
import { createMetrics } from '../src/core/metrics.js';
import { createLocalAssetStore } from '../src/core/asset-store.js';
import { createApiApp } from '../src/server.js';
import type { AppContext } from '../src/core/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://lrs:insecure@localhost:5432/postgres';
const CONFORMANCE_PORT = Number(process.env['CONFORMANCE_PORT'] ?? '8181');
const TOKEN_ID = '00000000-0000-4000-8000-000000000099';
const TOKEN_SECRET = 'conformance-secret';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ASSET_STORAGE_PATH = path.join(os.tmpdir(), 'xapi-lrs-conformance-assets');

// Debug: rolling buffer of recent requests for hang diagnosis
const recentRequests: string[] = [];

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

async function seedDatabase(pool: pg.Pool): Promise<void> {
  const seedSql = readFileSync(path.join(__dirname, 'conformance-seed.sql'), 'utf-8');
  await pool.query(seedSql);
  console.log('[conformance] Seeded tenant and xAPI token.');
}

async function cleanTenantData(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM xapi.documents   WHERE tenant_id = $1`, [TENANT_ID]);
  await pool.query(`DELETE FROM xapi.attachments WHERE tenant_id = $1`, [TENANT_ID]);
  await pool.query(`DELETE FROM xapi.statements  WHERE tenant_id = $1`, [TENANT_ID]);
  await pool.query(`DELETE FROM xapi.activities  WHERE tenant_id = $1`, [TENANT_ID]);
  await pool.query(`DELETE FROM xapi.agents      WHERE tenant_id = $1`, [TENANT_ID]);
  console.log('[conformance] Cleaned previous xAPI data for conformance tenant.');
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

function startServer(pool: pg.Pool): Promise<{ server: http.Server; url: string }> {
  const config = parseConfigFromEnv({
    NODE_ENV: 'test',
    DATABASE_URL,
    API_PORT: String(CONFORMANCE_PORT),
    ADMIN_PORT: '0',
    LOG_LEVEL: 'warn',
    ASSET_STORAGE_PATH,
  });

  const ctx: AppContext = {
    config,
    logger: pino({ level: config.logLevel }),
    pool,
    metrics: createMetrics(config),
    jwtVerifier: {
      verifyToken: () => Promise.reject(new Error('JWT not supported in conformance mode')),
      seedFromDb: () => Promise.resolve(),
    },
    assetStore: createLocalAssetStore(ASSET_STORAGE_PATH),
    isShuttingDown: false,
  };

  const app = createApiApp(ctx);
  const server = http.createServer(app);

  // Track recent requests (rolling buffer for timeout diagnosis)
  server.on('request', (req, res) => {
    const entry = `${req.method} ${req.url}`;
    recentRequests.push(entry);
    if (recentRequests.length > 30) recentRequests.shift();
    res.on('finish', () => {
      const idx = recentRequests.lastIndexOf(entry);
      if (idx >= 0) recentRequests[idx] = `${entry} → ${String(res.statusCode)}`;
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(CONFORMANCE_PORT, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${String(CONFORMANCE_PORT)}`;
      resolve({ server, url });
    });
    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Run conformance suite
// ---------------------------------------------------------------------------

function runConformanceSuite(endpoint: string): Promise<number> {
  const suitePath = path.join(__dirname, 'lrs-conformance-test-suite', 'bin', 'console_runner.js');
  const SUITE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes max

  const child = spawn('node', [
    suitePath,
    '-e', `${endpoint}/xapi`,
    '-a',
    '-u', TOKEN_ID,
    '-p', TOKEN_SECRET,
    '-x', '1.0.3',
  ], {
    stdio: 'inherit',
    cwd: path.join(__dirname, 'lrs-conformance-test-suite'),
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.log(`\n[conformance] Suite timed out after ${String(SUITE_TIMEOUT_MS / 1000)}s — killing.`);
      console.log('[debug] Last requests before hang:');
      for (const r of recentRequests) console.log('  ', r);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, SUITE_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[conformance] Connecting to PostgreSQL...');
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

  try {
    // Verify connection
    await pool.query('SELECT 1');
    console.log('[conformance] Connected.');

    // Seed and clean
    await seedDatabase(pool);
    await cleanTenantData(pool);
    // Clean and recreate asset storage directory
    await rm(ASSET_STORAGE_PATH, { recursive: true, force: true });
    await mkdir(ASSET_STORAGE_PATH, { recursive: true });
    console.log(`[conformance] Cleaned asset storage at ${ASSET_STORAGE_PATH}`);

    // Start server
    console.log(`[conformance] Starting LRS on port ${String(CONFORMANCE_PORT)}...`);
    const { server, url } = await startServer(pool);
    console.log(`[conformance] LRS running at ${url}`);

    // Run suite
    console.log('[conformance] Launching ADL conformance test suite...\n');
    const exitCode = await runConformanceSuite(url);

    // Shutdown
    console.log(`\n[conformance] Suite finished with exit code ${String(exitCode)}.`);
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();

    process.exit(exitCode);
  } catch (err) {
    console.error('[conformance] Fatal error:', err);
    await pool.end();
    process.exit(1);
  }
}

main();
