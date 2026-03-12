/**
 * Integration Tests: xAPI HEAD Support
 * Tests that HEAD returns the same headers as GET with an empty body
 */

import { test, describe, expect } from "../fixtures.ts";

const V = { "X-Experience-API-Version": "1.0.3" } as const;

describe("xAPI HEAD Support", () => {
  // =========================================================================
  // /xapi/about
  // =========================================================================

  test("HEAD /xapi/about returns 200 with headers and empty body", async ({ server }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/about`, { method: "HEAD" });

    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Experience-API-Version")).toBe("1.0.3");
    expect(resp.headers.get("Content-Type")).toContain("application/json");

    const body = await resp.text();
    expect(body).toBe("");
  });

  // =========================================================================
  // /xapi/statements
  // =========================================================================

  test("HEAD /xapi/statements returns same status as GET with empty body", async ({
    server,
    authToken,
  }) => {
    const headers = { Authorization: `Bearer ${authToken}`, ...V };

    const getResp = await fetch(`${server.apiUrl}/xapi/statements`, { headers });
    const headResp = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: "HEAD",
      headers,
    });

    expect(headResp.status).toBe(getResp.status);
    expect(headResp.headers.get("Content-Type")).toContain("application/json");

    const body = await headResp.text();
    expect(body).toBe("");
  });

  test("HEAD /xapi/statements includes X-Experience-API-Consistent-Through", async ({
    server,
    authToken,
  }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${authToken}`, ...V },
    });

    expect(resp.status).toBe(200);
    const ct = resp.headers.get("X-Experience-API-Consistent-Through");
    expect(ct).toBeDefined();
    // Should be a valid ISO timestamp
    expect(Number.isNaN(new Date(ct!).getTime())).toBe(false);
  });

  // xAPI §6.2: version header required — request is rejected without it
  test("HEAD /xapi/statements returns 400 without version header", async ({
    server,
    authToken,
  }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(resp.status).toBe(400);
  });
});
