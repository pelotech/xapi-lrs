# OpenTelemetry Tracing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OTLP distributed tracing to the xAPI data plane (HTTP request + DB query spans) on the existing OpenTelemetry stack, off unless an OTLP endpoint is configured, with metrics unchanged.

**Architecture:** A new `src/tracing.ts` owns the trace SDK (mirroring `src/metrics.ts`) and returns a `TracingHandle {enabled, tracer, shutdown}`, endpoint-gated. A custom Hono middleware creates the `SERVER` span (injected tracer via `AppDeps`); `src/db.ts` creates gated `CLIENT` spans at its two query seams using a module tracer set via `setDbTracer()` at bootstrap. Nesting relies on the `AsyncLocalStorageContextManager` that `provider.register()` installs. `src/server.ts` initializes tracing early and flushes it in graceful shutdown.

**Tech Stack:** TypeScript (ESM), Hono + `@hono/node-server`, node-`pg`, `@opentelemetry/*` 2.x, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-otel-tracing-design.md`

**Deviation from spec (deliberate):** The spec says the DB seam gets its tracer "as a parameter like `metrics`." In the code that is 34 call sites (`withClient`×27, `poolQuery`×7) plus their repository signatures. This plan instead uses a module-level `setDbTracer()` in `db.ts` (default no-op, set at bootstrap, overridden in tests). Same goal — injectable, unit-testable, no global provider registration — with near-zero call-site churn. The HTTP middleware still takes its tracer by injection via `AppDeps`, per spec.

---

## File Structure

- Create `src/tracing.ts` — `initTracing()` → `TracingHandle`; the trace SDK setup. One responsibility: build/register (or no-op) the trace provider.
- Create `src/middleware/tracing.ts` — `tracingMiddleware(tracer)` → Hono middleware that opens the `SERVER` span.
- Create `src/helpers/route-path.ts` — `safeRoutePath(c)` moved out of `src/app.ts` so both `app.ts` and the middleware share it (avoids app↔middleware coupling).
- Modify `src/db.ts` — add `setDbTracer()` + a `withDbSpan()` helper; wrap the two seams (`poolQuery`, `instrumentQuery`) in gated `CLIENT` spans.
- Modify `src/app.ts` — add `tracing: TracingHandle` to `AppDeps`; conditionally mount the tracing middleware on `/xapi/*` after version negotiation; import `safeRoutePath` from the new helper.
- Modify `src/server.ts` — `initTracing()` early; `setDbTracer()` when enabled; pass `tracing` into `createApp`; `tracing.shutdown()` in graceful shutdown.
- Modify `package.json` — add 4 `@opentelemetry/*` packages; align existing on 2.x.
- Modify `README.md` — "Tracing" subsection with `OTEL_*` vars + sampling advice.
- Tests: `test/unit/tracing.test.ts`, `test/unit/middleware/tracing.test.ts`, `test/unit/db-tracing.test.ts`.

**Test helper shared by the span tests** (a `NodeTracerProvider` + `SimpleSpanProcessor` + `InMemorySpanExporter`, no global registration):

```ts
// used inline in each test file (small enough to duplicate; do NOT register() globally)
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'; // re-exports the base test utilities
function makeTestTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
}
```

---

## Chunk 1: Tracing subsystem

### Task 1: Dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add the trace packages and align versions**

Run (in the worktree root) — use `@latest`, NOT a caret. The experimental exporter's current build is `0.2xx.x`; a range like `^0.2` resolves to an ancient 2021-era `0.2.x` incompatible with `sdk-trace` 2.x (and `pnpm up` without `--latest` will not correct it):

```bash
mise exec pnpm@10.33.2 -- pnpm add \
  @opentelemetry/sdk-trace-node@latest \
  @opentelemetry/exporter-trace-otlp-http@latest \
  @opentelemetry/resources@latest \
  @opentelemetry/semantic-conventions@latest
# devDep: the DB span unit test enables an AsyncLocalStorage context manager directly
mise exec pnpm@10.33.2 -- pnpm add -D @opentelemetry/context-async-hooks@latest
```

Then align the existing metrics packages to the same current line (what Renovate #67 was doing):

```bash
mise exec pnpm@10.33.2 -- pnpm up --latest '@opentelemetry/*'
```

Expected: `pnpm-lock.yaml` updated; stable packages (`api`, `sdk-metrics`, `sdk-trace-node`, `resources`, `semantic-conventions`) on the 2.x/1.x line, experimental ones (`exporter-prometheus`, `exporter-trace-otlp-http`) on the matching `0.2xx` line. Tests import OTel test utilities (`BasicTracerProvider`, `InMemorySpanExporter`, `SimpleSpanProcessor`) from `@opentelemetry/sdk-trace-node`, which re-exports them — so **no** separate `@opentelemetry/sdk-trace-base` dependency (pnpm's strict isolation would make a transitive-only import unresolvable).

- [ ] **Step 2: Verify install + build still green**

Run: `mise exec pnpm@10.33.2 -- pnpm install --frozen-lockfile && mise exec pnpm@10.33.2 -- pnpm typecheck && mise exec pnpm@10.33.2 -- pnpm test`
Expected: install clean, `tsc` clean, existing unit tests pass (metrics still works on the bumped `sdk-metrics`).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add @opentelemetry trace packages; align otel on 2.x"
```

---

### Task 2: `src/tracing.ts` — `initTracing()`

**Files:**

- Create: `src/tracing.ts`
- Test: `test/unit/tracing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/tracing.test.ts
import { describe, test, expect, afterEach } from 'vitest';
import { initTracing } from '../../src/tracing.ts';

describe('initTracing', () => {
  const OTLP_KEYS = ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'];
  afterEach(() => OTLP_KEYS.forEach((k) => delete process.env[k]));

  test('disabled when no OTLP endpoint is configured', async () => {
    const h = initTracing({}); // empty env
    expect(h.enabled).toBe(false);
    // no-op tracer: span is not recording
    expect(h.tracer.startSpan('x').isRecording()).toBe(false);
    await expect(h.shutdown()).resolves.toBeUndefined();
  });

  test('enabled when an endpoint is set', async () => {
    const h = initTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' });
    expect(h.enabled).toBe(true);
    await h.shutdown(); // flush + shut down the provider registered by this test
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `mise exec pnpm@10.33.2 -- pnpm vitest run --project unit test/unit/tracing.test.ts`
Expected: FAIL — cannot find `../../src/tracing.ts`.

- [ ] **Step 3: Implement `src/tracing.ts`**

```ts
/**
 * OpenTelemetry tracing for the LRS service.
 *
 * Off unless an OTLP endpoint is configured (OTEL_EXPORTER_OTLP_ENDPOINT or
 * OTEL_EXPORTER_OTLP_TRACES_ENDPOINT). When enabled, exports spans over OTLP/HTTP
 * and registers the AsyncLocalStorageContextManager + W3C tracecontext propagator.
 * Metrics are unaffected (see src/metrics.ts).
 */

import { createRequire } from 'node:module';
import { trace, type Tracer } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export interface TracingHandle {
  enabled: boolean;
  tracer: Tracer;
  shutdown(): Promise<void>;
}

// Before any provider is registered, trace.getTracer() returns a no-op tracer.
const NOOP_TRACER = trace.getTracer('xapi-lrs');

export function initTracing(env: NodeJS.ProcessEnv = process.env): TracingHandle {
  const endpointConfigured =
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT !== undefined || env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined;

  if (!endpointConfigured) {
    return { enabled: false, tracer: NOOP_TRACER, shutdown: async () => {} };
  }

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'xapi-lrs',
      [ATTR_SERVICE_VERSION]: version,
    }),
  );

  // OTLPTraceExporter reads OTEL_EXPORTER_OTLP_* natively; NodeTracerProvider
  // reads OTEL_TRACES_SAMPLER / _ARG from env (default parentbased_always_on).
  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register(); // installs AsyncLocalStorageContextManager + W3C propagator

  return {
    enabled: true,
    tracer: provider.getTracer('xapi-lrs'),
    shutdown: () => provider.shutdown(),
  };
}
```

Note on `version`: `createRequire('../package.json')` resolves to the repo/image root `package.json`. Verify at Task 6's smoke step that it resolves from `dist/`.

- [ ] **Step 4: Run it — expect PASS**

Run: `mise exec pnpm@10.33.2 -- pnpm vitest run --project unit test/unit/tracing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `mise exec pnpm@10.33.2 -- pnpm typecheck && mise exec pnpm@10.33.2 -- pnpm run fmt`

```bash
git add src/tracing.ts test/unit/tracing.test.ts
git commit -m "feat: add initTracing (OTLP, endpoint-gated)"
```

---

### Task 3: `safeRoutePath` helper extraction

**Files:**

- Create: `src/helpers/route-path.ts`
- Modify: `src/app.ts` (remove local `safeRoutePath`, import it)

- [ ] **Step 1: Create the helper (move the existing function verbatim)**

```ts
// src/helpers/route-path.ts
/**
 * Return the matched route pattern (e.g. `/xapi/statements/:statementId`).
 * Falls back to `c.req.path` for unmatched requests (404s, OPTIONS preflight, etc.)
 * where Hono's routePath getter is unavailable.
 */
export function safeRoutePath(c: { req: { routePath: string; path: string } }): string {
  try {
    return c.req.routePath || c.req.path;
  } catch {
    return c.req.path;
  }
}
```

- [ ] **Step 2: Update `src/app.ts`** — delete the local `safeRoutePath` (currently ~lines 58-69) and add `import { safeRoutePath } from './helpers/route-path.ts';` with the other imports.

- [ ] **Step 3: Verify no behavior change**

Run: `mise exec pnpm@10.33.2 -- pnpm typecheck && mise exec pnpm@10.33.2 -- pnpm test`
Expected: clean; all existing tests pass (the logging middleware still uses `safeRoutePath`).

- [ ] **Step 4: Commit**

```bash
git add src/helpers/route-path.ts src/app.ts
git commit -m "refactor: extract safeRoutePath to a shared helper"
```

---

### Task 4: HTTP tracing middleware

**Files:**

- Create: `src/middleware/tracing.ts`
- Test: `test/unit/middleware/tracing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/middleware/tracing.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'; // re-exports the base test utilities
import { tracingMiddleware } from '../../../src/middleware/tracing.ts';

function makeTestTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
}

describe('tracingMiddleware', () => {
  let exporter: InMemorySpanExporter;
  let app: Hono;

  beforeEach(() => {
    const t = makeTestTracer();
    exporter = t.exporter;
    app = new Hono();
    app.use('/xapi/*', tracingMiddleware(t.tracer));
    app.get('/xapi/statements/:id', (c) => c.text('ok'));
    app.get('/xapi/boom', () => {
      throw new Error('kaboom');
    });
  });

  test('emits one SERVER span named by method + matched route', async () => {
    await app.request('/xapi/statements/abc');
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe(SpanKind.SERVER);
    expect(spans[0].name).toBe('GET /xapi/statements/:id');
    expect(spans[0].attributes['http.route']).toBe('/xapi/statements/:id');
    expect(spans[0].attributes['http.response.status_code']).toBe(200);
  });

  test('records exception and ERROR status on a thrown handler', async () => {
    await app.request('/xapi/boom');
    const span = exporter.getFinishedSpans()[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((e) => e.name === 'exception')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

- [ ] **Step 3: Implement `src/middleware/tracing.ts`**

```ts
import { context, propagation, trace, SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../hono-env.ts';
import { safeRoutePath } from '../helpers/route-path.ts';

// TextMapGetter for a Fetch `Headers` carrier.
const headersGetter = {
  get: (h: Headers, k: string) => h.get(k) ?? undefined,
  keys: (h: Headers) => [...h.keys()],
};

/** SERVER-span middleware for the xAPI data plane. Mount on `/xapi/*` when tracing is enabled. */
export function tracingMiddleware(tracer: Tracer): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const parentCtx = propagation.extract(context.active(), c.req.raw.headers, headersGetter);
    // Provisional name — the matched route is unknown until next() runs.
    const span = tracer.startSpan(c.req.method, { kind: SpanKind.SERVER }, parentCtx);
    const activeCtx = trace.setSpan(parentCtx, span);
    try {
      await context.with(activeCtx, next);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      const route = safeRoutePath(c);
      span.updateName(`${c.req.method} ${route}`);
      span.setAttribute('http.request.method', c.req.method);
      span.setAttribute('http.route', route);
      span.setAttribute('url.path', c.req.path);
      span.setAttribute('http.response.status_code', c.res.status);
      const xapiVersion = c.get('xapiVersion');
      if (xapiVersion) span.setAttribute('xapi.version', xapiVersion);
      if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
  };
}
```

- [ ] **Step 4: Run — expect PASS** (2 tests).

- [ ] **Step 5: Typecheck, fmt, commit**

```bash
git add src/middleware/tracing.ts test/unit/middleware/tracing.test.ts
git commit -m "feat: add xAPI request tracing middleware"
```

Note: adopting an incoming `traceparent` as the parent trace (spec test case) is **not** unit-tested here — `propagation.extract` needs the global W3C propagator that `provider.register()` installs in production, which this test (no registered provider/propagator) lacks. It is verified by the enabled-path smoke in Task 7 Step 3.

---

### Task 5: DB query spans (gated) + `setDbTracer`

**Files:**

- Modify: `src/db.ts`
- Test: `test/unit/db-tracing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/db-tracing.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { context, trace, SpanKind } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'; // re-exports the base test utilities
import { poolQuery, setDbTracer } from '../../src/db.ts';
import type { DbPool } from '../../src/db.ts';
import type { LrsMetrics } from '../../src/metrics.ts';

const metrics = { dbQueryDuration: { record() {} } } as unknown as LrsMetrics;
const pool = {
  async query() {
    return { rows: [], rowCount: 0 };
  },
} as unknown as DbPool;

function makeTestTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
}

describe('db query spans', () => {
  let exporter: InMemorySpanExporter;
  let tracer: ReturnType<typeof makeTestTracer>['tracer'];
  // context.with only propagates across awaits with a context manager installed;
  // in production initTracing's provider.register() installs one. Enable it here.
  const cm = new AsyncLocalStorageContextManager();
  beforeAll(() => context.setGlobalContextManager(cm.enable()));
  afterAll(() => {
    cm.disable();
    context.disable();
  });
  beforeEach(() => {
    const t = makeTestTracer();
    exporter = t.exporter;
    tracer = t.tracer;
    setDbTracer(tracer);
  });
  afterEach(() => setDbTracer(trace.getTracer('xapi-lrs'))); // reset to no-op

  test('emits a CLIENT span nested under an active parent span', async () => {
    const parent = tracer.startSpan('parent');
    await context.with(trace.setSpan(context.active(), parent), () =>
      poolQuery(pool, metrics, { name: 'select_thing', text: 'SELECT 1' }),
    );
    parent.end();
    const dbSpan = exporter.getFinishedSpans().find((s) => s.name === 'db.query select_thing');
    expect(dbSpan).toBeDefined();
    expect(dbSpan!.kind).toBe(SpanKind.CLIENT);
    expect(dbSpan!.attributes['db.system']).toBe('postgresql');
    expect(dbSpan!.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  test('emits NO span when there is no active recording span (admin/data-plane gate)', async () => {
    await poolQuery(pool, metrics, { name: 'select_thing', text: 'SELECT 1' });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`setDbTracer` not exported; no span created).

- [ ] **Step 3: Implement in `src/db.ts`**

Add imports at the top of `src/db.ts`:

```ts
import { context, trace, SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';
```

Add the module tracer + gate helper (after the imports / near the instrumentation section):

```ts
// Set at bootstrap when tracing is enabled (see src/server.ts); default no-op.
let dbTracer: Tracer = trace.getTracer('xapi-lrs');
export function setDbTracer(t: Tracer): void {
  dbTracer = t;
}

/**
 * Wrap a query in a CLIENT span — but only inside a traced xAPI request
 * (there must be an active recording span). Admin-plane queries run the same
 * seams with no active span and emit nothing.
 */
function withDbSpan<T>(queryName: string, run: () => Promise<T>): Promise<T> {
  if (!trace.getActiveSpan()?.isRecording()) return run();
  const span = dbTracer.startSpan(`db.query ${queryName}`, {
    kind: SpanKind.CLIENT,
    attributes: { 'db.system': 'postgresql', query_name: queryName },
  });
  return context.with(trace.setSpan(context.active(), span), () =>
    run().then(
      (res) => {
        span.end();
        return res;
      },
      (err: unknown) => {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw err;
      },
    ),
  );
}
```

Wrap `poolQuery`'s DB call — the metric timer stays, the query goes through `withDbSpan`:

```ts
export async function poolQuery<R extends QueryResultRow = QueryResultRow>(
  pool: DbPool,
  metrics: LrsMetrics,
  config: QueryConfig,
): Promise<QueryResult<R>> {
  const end = startTimer(metrics.dbQueryDuration, { query_name: config.name ?? 'unknown' });
  try {
    return await withDbSpan(config.name ?? 'unknown', () => pool.query<R>(config));
  } finally {
    end();
  }
}
```

Wrap the patched `client.query` inside `instrumentQuery` similarly — pg always returns a promise here, so wrap the original call:

```ts
client.query = ((...args: unknown[]) => {
  const queryName = extractQueryName(args[0]);
  const end = startTimer(metrics.dbQueryDuration, { query_name: queryName });
  return withDbSpan(queryName, () => (originalQuery as Function)(...args)).then(
    (res: unknown) => {
      end();
      return res;
    },
    (error: unknown) => {
      end();
      throw error;
    },
  );
}) as typeof client.query;
```

(The prior sync/non-promise branch is dropped — `pg` client queries always return a promise. `withDbSpan` returns `run()` directly when untraced, so behavior is unchanged when disabled.)

- [ ] **Step 4: Run — expect PASS** (2 tests). Also run the full unit suite: `mise exec pnpm@10.33.2 -- pnpm test` — existing `withClient`/transaction tests must stay green.

- [ ] **Step 5: Typecheck, fmt, commit**

```bash
git add src/db.ts test/unit/db-tracing.test.ts
git commit -m "feat: gated CLIENT spans at the DB query seams"
```

---

### Task 6: Wire tracing into the app (`AppDeps` + conditional mount)

**Files:**

- Modify: `src/app.ts`
- Test: `test/unit/app/tracing-mount.test.ts`

- [ ] **Step 1: Write the failing test** — the middleware is mounted only when `tracing.enabled`.

```ts
// test/unit/app/tracing-mount.test.ts
import { describe, test, expect } from 'vitest';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'; // re-exports the base test utilities
import { createApp, type AppDeps } from '../../../src/app.ts';

function makeTestTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
}

// Fill this by copying the AppDeps construction from `buildApp()` in
// test/unit/app/version-negotiation.test.ts (the canonical template — same
// config/pool/jwksCache/jwtConfig/metrics/logger/pgListener/sessionSecret/
// startedAt/shutdownSignal fields) and adding `tracing`.
function buildDeps(tracing: AppDeps['tracing']): AppDeps {
  return {
    /* ...copy the fields from version-negotiation.test.ts buildApp()... */
    tracing,
  } as AppDeps;
}

describe('tracing mount', () => {
  test('mounts the middleware only when tracing.enabled', async () => {
    const { tracer, exporter } = makeTestTracer();

    const enabledApp = createApp(buildDeps({ enabled: true, tracer, shutdown: async () => {} }));
    await enabledApp.request('/xapi/about'); // /xapi/about is unauthenticated
    expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);

    exporter.reset();
    const disabledApp = createApp(
      buildDeps({ enabled: false, tracer: trace.getTracer('noop'), shutdown: async () => {} }),
    );
    await disabledApp.request('/xapi/about');
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
```

`buildDeps` must be filled by copying the `AppDeps` construction from `buildApp()` in `test/unit/app/version-negotiation.test.ts` (the canonical template) and adding the `tracing` field. `/xapi/about` is unauthenticated (reachable without credentials).

- [ ] **Step 2: Run — expect FAIL** (`tracing` not on `AppDeps`; middleware not mounted).

- [ ] **Step 3: Implement in `src/app.ts`**
- Add to `AppDeps`: `tracing: TracingHandle;` and `import type { TracingHandle } from './tracing.ts';`, `import { tracingMiddleware } from './middleware/tracing.ts';`.
- After the version-negotiation middleware block (currently ~lines 287-346), add:

```ts
// Tracing (xAPI data plane only, and only when enabled) — mounted after version
// negotiation so xapi.version is available, wrapping the rest of the chain.
if (deps.tracing.enabled) {
  app.use('/xapi/*', tracingMiddleware(deps.tracing.tracer));
}
```

- **Update the two existing `AppDeps` construction sites** — making `tracing` required breaks them at typecheck, and the new `deps.tracing.enabled` check throws `Cannot read properties of undefined` at runtime, breaking every version-negotiation test. Add a disabled stub to each: `test/unit/app/version-negotiation.test.ts` (`buildApp()`, ~line 89) and `test/integration/test-server.ts` (~line 142) — `tracing: { enabled: false, tracer: trace.getTracer('noop'), shutdown: async () => {} }` (import `trace` from `@opentelemetry/api`).

- [ ] **Step 4: Run — expect PASS.** Full unit suite green (including the previously-passing version-negotiation tests, now with the stub).

- [ ] **Step 5: Typecheck, fmt, commit**

```bash
git add src/app.ts test/unit/app/tracing-mount.test.ts
git commit -m "feat: mount xAPI tracing middleware when enabled"
```

---

### Task 7: Bootstrap + graceful shutdown (`src/server.ts`)

**Files:**

- Modify: `src/server.ts`

Not unit-tested (this is process bootstrap); verified by typecheck + a live smoke.

- [ ] **Step 1: Wire it up**
- Add imports: `import { initTracing } from './tracing.ts';` and `import { setDbTracer } from './db.ts';`.
- In `main()`, right after `const metrics = createMetrics();` (line ~74):

```ts
const tracing = initTracing();
if (tracing.enabled) {
  setDbTracer(tracing.tracer);
  logger.info('Tracing enabled (OTLP)');
}
```

- In the `createApp({ ... })` deps object (~line 161), add `tracing,`.
- In the graceful-shutdown `try` block (next to `await metrics.shutdown();`, ~line 277), add `await tracing.shutdown();`.

- [ ] **Step 2: Typecheck + disabled-path smoke**

Run: `mise exec pnpm@10.33.2 -- pnpm typecheck && mise exec pnpm@10.33.2 -- pnpm build`
Then reproduce the migrate-gate smoke (no OTEL env → tracing disabled, server boots normally):

```bash
# with a local pg available (docker compose up -d --wait postgres) and .env.test sourced
node dist/migrate.js && node dist/server.js &  # boots; expect "Tracing enabled" ABSENT
# curl an authenticated /xapi/statements as the migrate-gate does; then kill it
```

Expected: server boots with tracing OFF; no errors; `../package.json` version resolved from `dist/` (no MODULE_NOT_FOUND).

- [ ] **Step 3: Enabled-path smoke (optional but recommended)**

Run a local collector or `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 OTEL_TRACES_SAMPLER=parentbased_always_on node dist/server.js`, hit `/xapi/statements`, confirm a `GET /xapi/...` span with a nested `db.query ...` child reaches the collector (or that no export error is thrown if none is running — BatchSpanProcessor drops/logs).

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: initialize tracing at bootstrap and flush on shutdown"
```

---

### Task 8: Docs + close #67

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add a "Tracing" subsection** under observability (near the metrics/health docs):

```markdown
### Tracing

xapi-lrs emits OpenTelemetry traces for the xAPI data plane (request + DB query spans) over OTLP. Tracing is **off unless an OTLP endpoint is configured** — set the standard `OTEL_*` variables:

| Variable                                                             | Purpose                                             |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Enable + target (a collector, or a managed backend) |
| `OTEL_EXPORTER_OTLP_HEADERS`                                         | Auth headers for a managed backend                  |
| `OTEL_SERVICE_NAME`                                                  | Service name (default `xapi-lrs`)                   |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`                    | Sampling (default `parentbased_always_on`)          |

Point the endpoint at a local **OpenTelemetry Collector** in small environments, or directly at a **managed backend** (with `OTEL_EXPORTER_OTLP_HEADERS`) in production. The default samples every request; for production ingest volume set `OTEL_TRACES_SAMPLER=parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG=0.1` (or `0.01` / lower).
```

- [ ] **Step 2: fmt + commit**

Run: `mise exec pnpm@10.33.2 -- pnpm run fmt`

```bash
git add README.md
git commit -m "docs: document tracing configuration"
```

- [ ] **Step 3: Close Renovate #67** — this PR upgrades and consumes the OTel monorepo, superseding the bump. After this branch merges (or when opening the PR), close #67 with a comment: "Superseded by the tracing work (feat/otel-tracing), which adds the trace packages and aligns all `@opentelemetry/*` on 2.x." (`gh pr close 67 --comment "..."`.)

---

## Final verification

- [ ] `mise exec pnpm@10.33.2 -- pnpm typecheck` — clean
- [ ] `mise exec pnpm@10.33.2 -- pnpm test` — all unit tests green (including the 3 new tracing test files)
- [ ] `mise exec pnpm@10.33.2 -- pnpm run fmt` — clean
- [ ] `mise exec pnpm@10.33.2 -- pnpm build` — clean; `dist/server.js` boots with tracing OFF (no OTEL env) and ON (endpoint set)
- [ ] Metrics unchanged — `test/unit/metrics.test.ts` still green
