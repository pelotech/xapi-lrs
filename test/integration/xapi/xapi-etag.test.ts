/**
 * Integration Tests: xAPI ETag Concurrency Control
 * Tests If-Match, If-None-Match across document resources
 */

import { test, describe, expect } from "../fixtures.ts";

const V = { "X-Experience-API-Version": "1.0.3" } as const;

const agentJson = JSON.stringify({
  objectType: "Agent",
  account: { homePage: "https://example.com", name: "test-user" },
});
const activityId = "https://example.com/activities/test-activity";

describe("xAPI ETag Concurrency Control", () => {
  describe("Activity State — ETag", () => {
    test("GET single state should return ETag and Last-Modified", async ({ server, basicAuth }) => {
      const qs = new URLSearchParams({
        stateId: "etag-test",
        activityId,
        agent: agentJson,
      }).toString();

      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify({ data: 1 }),
      });

      const resp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(resp.status).toBe(200);
      expect(resp.headers.get("ETag")).toBeDefined();
      expect(resp.headers.get("ETag")).toMatch(/^"/);
      expect(resp.headers.get("Last-Modified")).toBeDefined();
    });

    test("PUT with If-None-Match: * should fail when document exists", async ({
      server,
      basicAuth,
    }) => {
      const qs = new URLSearchParams({
        stateId: "ifnm-test",
        activityId,
        agent: agentJson,
      }).toString();

      // First PUT succeeds
      const resp1 = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
          "If-None-Match": "*",
          ...V,
        },
        body: JSON.stringify({ v: 1 }),
      });
      expect(resp1.status).toBe(204);

      // Second PUT with If-None-Match: * should fail
      const resp2 = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
          "If-None-Match": "*",
          ...V,
        },
        body: JSON.stringify({ v: 2 }),
      });
      expect(resp2.status).toBe(412);
    });

    test("PUT with wrong If-Match should return 412", async ({ server, basicAuth }) => {
      const qs = new URLSearchParams({
        stateId: "ifm-test",
        activityId,
        agent: agentJson,
      }).toString();

      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify({ v: 1 }),
      });

      const resp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
          "If-Match": '"wrong-etag"',
          ...V,
        },
        body: JSON.stringify({ v: 2 }),
      });
      expect(resp.status).toBe(412);
    });

    test("PUT with correct If-Match should succeed", async ({ server, basicAuth }) => {
      const qs = new URLSearchParams({
        stateId: "ifm-ok",
        activityId,
        agent: agentJson,
      }).toString();

      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify({ v: 1 }),
      });

      // Get current ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      const etag = getResp.headers.get("ETag")!;

      // PUT with matching ETag
      const resp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
          "If-Match": etag,
          ...V,
        },
        body: JSON.stringify({ v: 2 }),
      });
      expect(resp.status).toBe(204);
    });
  });

  describe("Activity Profile — ETag", () => {
    test("If-None-Match: * should prevent overwrite", async ({ server, authToken }) => {
      const qs = new URLSearchParams({ profileId: "etag-act-prof", activityId }).toString();

      const resp1 = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "If-None-Match": "*",
          ...V,
        },
        body: JSON.stringify({ v: 1 }),
      });
      expect(resp1.status).toBe(204);

      const resp2 = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "If-None-Match": "*",
          ...V,
        },
        body: JSON.stringify({ v: 2 }),
      });
      expect(resp2.status).toBe(412);
    });
  });

  describe("Agent Profile — ETag", () => {
    test("If-None-Match: * should prevent overwrite", async ({ server, authToken }) => {
      const qs = new URLSearchParams({ profileId: "etag-agent-prof", agent: agentJson }).toString();

      const resp1 = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "If-None-Match": "*",
          ...V,
        },
        body: JSON.stringify({ v: 1 }),
      });
      expect(resp1.status).toBe(204);

      const resp2 = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "If-None-Match": "*",
          ...V,
        },
        body: JSON.stringify({ v: 2 }),
      });
      expect(resp2.status).toBe(412);
    });
  });
});
