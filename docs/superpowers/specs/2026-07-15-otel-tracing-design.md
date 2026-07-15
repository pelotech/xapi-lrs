# OpenTelemetry Tracing Design

**Goal:** Add distributed tracing to xapi-lrs on the existing OpenTelemetry stack, exporting spans via OTLP while metrics stay on Prometheus. Tracing is off unless an OTLP endpoint is configured.

## Context

- OpenTelemetry is currently **metrics-only**: `@opentelemetry/api` + `sdk-metrics` + `exporter-prometheus`, feeding a Prometheus pull endpoint on the admin server (`src/metrics.ts`). No tracing exists.
- The service runs Hono on `@hono/node-server` with two servers — xAPI on `config.port`, admin on `config.adminPort` — plus node-`pg`, under ESM. Bootstrap is in `src/server.ts` `main()`, which already has a graceful-shutdown sequence that flushes metrics.
- Natural instrumentation seams already exist: the xAPI middleware chain (`src/app.ts`), the universal DB query wrapper `startTimer(metrics.dbQueryDuration, { query_name })` in `src/db.ts`, and the SSE producer.

## Decisions

1. **Export:** OTLP/HTTP (`@opentelemetry/exporter-trace-otlp-http`, default protocol `http/protobuf`, port 4318). Backend-agnostic — small envs point at a collector (deployment A), prod points at a managed backend with auth headers (deployment B), both through the same OTLP config.
2. **Instrumentation:** seam-based and manual — no auto-instrumentation, no module patching, no `--import` preload. This keeps the setup ESM-clean and gives precise, well-named spans.
3. **Scope:** xAPI data plane only — HTTP request spans and DB query spans.
4. **Config:** standard `OTEL_*` env vars only. No `XAPI_LRS_`-prefixed vars and no entries in the Zod config; `OTEL_*` are ecosystem standards, the same category kept bare in the env-var namespace work (`PG*`, `DATABASE_URL`, `NODE_ENV`).
5. **Enable:** on if and only if an OTLP endpoint is configured. When off, the tracing middleware is not mounted and no provider or context manager is registered — genuinely zero request-path cost, not merely a no-op span.

## Non-goals (deferred)

- SSE spans — the connection lifecycle is long-lived; `sseClients` / `sseEventsEmitted` metrics already cover it.
- Admin-plane tracing (health probes, `/metrics`, admin UI) — noise for request debugging.
- Metrics↔traces exemplars — a future enhancement.
- Any change to the Prometheus metrics stack.
- Outbound JWKS-fetch spans — possible future add, out of scope for v1.
- Requests rejected before the tracing middleware runs — version-negotiation 400s, oversized-body 413s, CORS preflight — produce no span. Accepted: these are cheap rejections that never reach the data path.

## Components

### `src/tracing.ts`

Owns the trace SDK, mirroring how `src/metrics.ts` owns metrics — one module, one responsibility.

`initTracing(): TracingHandle`, where `TracingHandle = { enabled: boolean, tracer: Tracer, shutdown(): Promise<void> }`. The `tracer` is threaded to the seams the same way `metrics` already is — via `AppDeps` for the middleware, and as a direct function parameter to the `db.ts` query functions (which take `metrics` directly today) — rather than fetched via a global `trace.getTracer()` lookup. This keeps the seams injectable and unit-testable.

- If neither `OTEL_EXPORTER_OTLP_ENDPOINT` nor `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set: register nothing and return `{ enabled: false, tracer: <no-op tracer>, shutdown: async () => {} }`. No provider, no context manager, and (per Lifecycle) no middleware — nothing runs on the request path.
- Otherwise build:
  - a resource via the 2.x functional API — `defaultResource().merge(resourceFromAttributes({ … }))` (the `Resource` class and its `.merge()` constructor were removed in `@opentelemetry/resources` 2.0) — setting `service.name` (`OTEL_SERVICE_NAME`, default `xapi-lrs`) and `service.version` (imported from `package.json`'s `version`);
  - an `OTLPTraceExporter` (reads `OTEL_EXPORTER_OTLP_*` natively) inside a `BatchSpanProcessor`;
  - a `NodeTracerProvider` wiring those together. No explicit sampler is constructed — the provider reads `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` from the environment itself (default `parentbased_always_on`).
  - `provider.register()` installs the provider, the `AsyncLocalStorageContextManager`, and the W3C tracecontext propagator globally (see Context propagation). The middleware uses `propagation.extract` from the already-present `@opentelemetry/api`, so **no** `@opentelemetry/core` dependency is needed.
- Returns `{ enabled: true, tracer: provider.getTracer('xapi-lrs'), shutdown }`, where `shutdown()` delegates to `provider.shutdown()` (flushing the batch processor).

### HTTP tracing middleware — `src/middleware/tracing.ts`

A small custom Hono middleware (rather than pulling `@hono/otel`, so span naming and attributes stay under our control), mounted on the **xAPI app only, and only when `tracing.enabled`** (see Lifecycle) — so a disabled deployment runs no tracing code per request at all.

- Position: mounted on `/xapi/*` after version negotiation (so `xapi.version` is available), wrapping the rest of the chain so downstream DB spans nest under the request span.
- Per request: extract parent context from the incoming headers via `propagation.extract` (linking distributed traces from `traceparent`); start a `SERVER` span from the injected tracer (provisional name `${method}`, since the matched route is not yet known); run `await next()` inside `context.with(ctx, …)`.
- **The matched route only resolves after routing completes** — inside a `/xapi/*` middleware, `c.req.routePath` returns the middleware pattern (`/xapi/*`), not the leaf route, until `next()` has run. So, mirroring the existing `safeRoutePath(c)` logging pattern (`src/app.ts`), the `finally` block reads `c.req.routePath`, sets `http.route`, and calls `span.updateName('${method} ${route}')` to keep names low-cardinality — then sets `http.request.method`, `url.path`, `http.response.status_code`, `xapi.version`, records any thrown exception with status `ERROR`, and ends the span. Setting the name up front would collapse every span to `${method} /xapi/*`.

### DB span — `src/db.ts`

At the two query seams (the existing `startTimer(metrics.dbQueryDuration, { query_name })` call sites), wrap query execution in a `CLIENT` span `db.query ${query_name}` — **but only when there is an active recording span** (`trace.getActiveSpan()?.isRecording()`), i.e. inside a traced xAPI request. This gate is what keeps the shared `db.ts` seam xAPI-plane-only: the admin UI (browsing statements, credentials, documents) runs the same seam but has no active request span, so it emits no orphan root spans. When the gate fires, the span is a child of the active context and nests under the request span. The `db.ts` query functions receive the tracer as a parameter alongside the `metrics` they already take. Attributes: `db.system=postgresql` and `query_name` (the operation name). No raw SQL text is attached (avoids PII and unbounded attribute size). Errors are recorded; the span ends when the query settles. The existing metric recording is unchanged. Because `instrumentQuery` patches `client.query`, transaction-control statements (`begin` / `commit` / `rollback`) each emit their own short child span — intentional, and useful for seeing transaction boundaries in a trace.

The `readyz` health check's direct `pool.query('SELECT 1')` bypasses both seams; that's admin-plane and intentionally untraced.

### Lifecycle — `src/server.ts`

- `const tracing = initTracing()` runs early in `main()`, before the app is constructed. Its `tracer` is passed into the app's `deps` alongside `metrics`; `src/app.ts` mounts the tracing middleware only when `tracing.enabled`.
- `await tracing.shutdown()` joins the existing graceful-shutdown sequence alongside `metrics.shutdown()`, so the `BatchSpanProcessor` flushes in-flight spans before exit (bounded by the existing `shutdownTimeoutMs` deadline). When disabled it is a no-op.

## Context propagation

Both nesting (DB spans under the request span) and the DB seam's active-span gate rely on the `AsyncLocalStorageContextManager` that `provider.register()` installs. The middleware runs `next()` inside `context.with(ctx, …)`, and ALS carries that active context across `await` boundaries down to the `pg` calls.

- It is installed **only when tracing is enabled**, so a disabled deployment pays no ALS cost.
- ALS propagates reliably across ordinary `async`/`await` — which is all the xAPI request → handler → `pg` path is. It can be lost across raw event-emitter callbacks, `setImmediate`, and long-lived streams — precisely the paths already scoped out (SSE, background listeners). A query reached without a propagated context simply fails the active-span gate and goes untraced, rather than producing a wrong or orphaned span.
- Avoiding ALS is possible only by threading the OTel context explicitly through every `db.ts` call site — invasive and easy to get wrong (a missed site yields a silent missing/orphan span). ALS is the standard mechanism and is preferred here.

## Error isolation

Span operations are guarded so a tracing or exporter fault can never fail an xAPI request. Exporter and network errors are logged and dropped by the `BatchSpanProcessor` (OTel's default behavior) and are never surfaced to the request path.

## Config reference (all standard `OTEL_*`)

| Variable                                                             | Purpose                   | Default                 |
| -------------------------------------------------------------------- | ------------------------- | ----------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Enable + target           | (unset → tracing off)   |
| `OTEL_EXPORTER_OTLP_HEADERS`                                         | Auth for managed backends | (none)                  |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                                        | Wire protocol             | `http/protobuf`         |
| `OTEL_SERVICE_NAME`                                                  | Service identity          | `xapi-lrs`              |
| `OTEL_RESOURCE_ATTRIBUTES`                                           | Extra resource attributes | (none)                  |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`                    | Sampling                  | `parentbased_always_on` |

The default samples every request (1.0) — fine for dev and low-traffic environments. For production ingest volume, operators should dial it down with `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.1` (or `0.01` / lower for heavy statement traffic). Parent-based sampling keeps a sampled upstream request's whole trace intact.

## Dependencies

- Add: `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`.
- `@opentelemetry/api` is already present.
- Align all `@opentelemetry/*` packages on the current 2.x line as part of this change — this absorbs Renovate PR #67 (the OTel-monorepo bump), which should then be closed.

## Testing

Unit tests run against a **test provider** — a `NodeTracerProvider` with a `SimpleSpanProcessor` + `InMemorySpanExporter` (synchronous export, so assertions need no batch flush). Its tracer is **injected** into the middleware and DB seam via `deps` (the same DI seam `metrics` uses), so tests never touch the global provider registration. `exporter.reset()` runs in `beforeEach`; cross-file safety comes free from vitest's per-file worker isolation. Production keeps the `BatchSpanProcessor`.

- The HTTP middleware emits one `SERVER` span with the expected name and attributes for a sample xAPI request, with `http.response.status_code` set from the response; the error path sets span status `ERROR` and records the exception.
- The DB seam, driven inside an active span (`context.with(trace.setSpan(context.active(), parent), …)`), emits a `CLIENT` span whose `parentSpanId` is the request span — **and** with no active span it emits nothing (the active-span gate).
- No-endpoint path: `initTracing` returns `{ enabled: false }`, registers no provider, and mounts no middleware.
- Context propagation: an incoming `traceparent` becomes the parent of the request span.

## Documentation

README gains a short "Tracing" subsection under observability: the `OTEL_*` variables, "off unless an endpoint is set," the collector-vs-managed-backend note, and the prod sampling advice (default 1.0; set a `parentbased_traceidratio` of `0.1` / `0.01` / lower for ingest volume).

## Rollout

Lands as a `feat:` — cuts the next minor release.
