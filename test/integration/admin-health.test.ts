/**
 * Integration tests for admin server health and readiness endpoints.
 */

import { test, describe, expect } from "./fixtures.ts";

describe("Admin health endpoints", () => {
  test("GET /healthz returns 200", async ({ server }) => {
    const res = await fetch(`${server.adminUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("GET /ready returns 200 when DB is reachable", async ({ server }) => {
    const res = await fetch(`${server.adminUrl}/ready`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("GET /ready returns 503 when DB pool is closed", async ({ server }) => {
    // End the pool to simulate DB unavailability, then create a replacement
    // so that the server.close() teardown doesn't fail.
    const originalPool = server.pool;
    await originalPool.end();

    const res = await fetch(`${server.adminUrl}/ready`);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("database unavailable");
  });

  test("GET /metrics returns Prometheus text", async ({ server }) => {
    const res = await fetch(`${server.adminUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });
});
