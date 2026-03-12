/**
 * Integration Tests: xAPI About Resource
 * GET /xapi/about — no auth required, returns supported versions
 */

import { test, describe, expect } from "../fixtures.ts";

describe("xAPI About Resource", () => {
  test("should return version array without auth", async ({ server }) => {
    const response = await fetch(`${server.apiUrl}/xapi/about`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ version: ["1.0.3"] });
  });

  test("should include X-Experience-API-Version response header", async ({ server }) => {
    const response = await fetch(`${server.apiUrl}/xapi/about`);

    expect(response.headers.get("X-Experience-API-Version")).toBe("1.0.3");
  });
});
