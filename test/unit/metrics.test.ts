import { describe, it, expect, afterEach } from "vitest";
import { createMetrics, startTimer } from "../../src/metrics.ts";
import type { LrsMetrics } from "../../src/metrics.ts";

describe("metrics", () => {
  let metrics: LrsMetrics;

  afterEach(async () => {
    await metrics?.shutdown();
  });

  it("createMetrics() returns all expected instruments", () => {
    metrics = createMetrics();

    expect(metrics.httpDuration).toBeDefined();
    expect(metrics.statementsReceived).toBeDefined();
    expect(metrics.statementsStored).toBeDefined();
    expect(metrics.statementValidationErrors).toBeDefined();
    expect(metrics.documentOps).toBeDefined();
    expect(metrics.dbQueryDuration).toBeDefined();
    expect(metrics.sseClients).toBeDefined();
    expect(metrics.sseEventsEmitted).toBeDefined();
    expect(metrics.authFailures).toBeDefined();
    expect(metrics.getPrometheusText).toBeInstanceOf(Function);
    expect(metrics.shutdown).toBeInstanceOf(Function);
  });

  it("getPrometheusText() returns valid Prometheus text", async () => {
    metrics = createMetrics();

    // OTel only exports instruments that have recorded data, so touch all of them
    metrics.httpDuration.record(0.05, { method: "GET", route: "/xapi/statements", status: "200" });
    metrics.statementsReceived.add(5, { method: "POST" });
    metrics.statementsStored.add(1, { source: "api" });
    metrics.statementValidationErrors.add(1);
    metrics.documentOps.add(1, { resource: "state", method: "PUT" });
    metrics.dbQueryDuration.record(0.01, { query_name: "test" });
    metrics.sseClients.add(2);
    metrics.sseEventsEmitted.add(1);
    metrics.authFailures.add(1, { scheme: "basic" });

    const text = await metrics.getPrometheusText();

    expect(text).toContain("lrs_http_request_duration_seconds");
    expect(text).toContain("lrs_xapi_statements_received_total");
    expect(text).toContain("lrs_xapi_statements_stored_total");
    expect(text).toContain("lrs_xapi_statement_validation_errors_total");
    expect(text).toContain("lrs_xapi_document_operations_total");
    expect(text).toContain("lrs_db_query_duration_seconds");
    expect(text).toContain("lrs_sse_clients_connected");
    expect(text).toContain("lrs_sse_events_emitted_total");
    expect(text).toContain("lrs_auth_failures_total");
  });

  it("shutdown() resolves without error", async () => {
    metrics = createMetrics();
    await expect(metrics.shutdown()).resolves.toBeUndefined();
  });

  it("startTimer() records elapsed duration", async () => {
    metrics = createMetrics();

    const end = startTimer(metrics.dbQueryDuration, { query_name: "test_query" });
    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 10));
    end();

    const text = await metrics.getPrometheusText();
    expect(text).toContain("lrs_db_query_duration_seconds");
    expect(text).toContain('query_name="test_query"');
  });
});
