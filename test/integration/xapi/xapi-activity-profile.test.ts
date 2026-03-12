/**
 * Integration Tests: xAPI Activity Profile Resource
 * PUT, POST (merge), GET (single + list), DELETE
 */

import { randomUUID } from "node:crypto";
import { test, describe, expect } from "../fixtures.ts";

const activityId = `https://example.com/activities/test-activity-${randomUUID().slice(0, 8)}`;

function profileParams(opts: { profileId?: string; since?: string } = {}): string {
  const params = new URLSearchParams({ activityId });
  if (opts.profileId) {
    params.set("profileId", opts.profileId);
  }
  if (opts.since) {
    params.set("since", opts.since);
  }
  return params.toString();
}

describe("xAPI Activity Profile Resource", () => {
  describe("PUT /xapi/activities/profile", () => {
    test("should store a profile and return 204", async ({ server, authToken }) => {
      const response = await fetch(
        `${server.apiUrl}/xapi/activities/profile?${profileParams({ profileId: "prof-1" })}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            "X-Experience-API-Version": "1.0.3",
            "If-None-Match": "*",
          },
          body: JSON.stringify({ key: "value" }),
        },
      );

      expect(response.status).toBe(204);
    });

    test("should overwrite existing profile", async ({ server, authToken }) => {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
        "X-Experience-API-Version": "1.0.3",
      };
      const qs = profileParams({ profileId: "prof-overwrite" });

      // Create
      await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: { ...headers, "If-None-Match": "*" },
        body: JSON.stringify({ original: true }),
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      const etag = getResp.headers.get("ETag")!;

      // Overwrite with If-Match
      const resp2 = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: { ...headers, "If-Match": etag },
        body: JSON.stringify({ updated: true }),
      });
      expect(resp2.status).toBe(204);

      // Verify
      const verifyResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      const data = await verifyResp.json();
      expect(data).toEqual({ updated: true });
    });
  });

  describe("POST /xapi/activities/profile (merge)", () => {
    test("should merge top-level keys", async ({ server, authToken }) => {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
        "X-Experience-API-Version": "1.0.3",
      };
      const qs = profileParams({ profileId: "prof-merge" });

      // PUT initial
      await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: { ...headers, "If-None-Match": "*" },
        body: JSON.stringify({ a: 1, b: 2 }),
      });

      // Get ETag
      const etagResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      const etag = etagResp.headers.get("ETag")!;

      // POST merge with If-Match
      const resp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "POST",
        headers: { ...headers, "If-Match": etag },
        body: JSON.stringify({ b: "updated", c: 3 }),
      });
      expect(resp.status).toBe(204);

      // Verify
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      expect(await getResp.json()).toEqual({ a: 1, b: "updated", c: 3 });
    });
  });

  describe("GET /xapi/activities/profile", () => {
    test("should return single profile with ETag and Last-Modified", async ({
      server,
      authToken,
    }) => {
      const qs = profileParams({ profileId: "prof-get" });
      await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-Experience-API-Version": "1.0.3",
          "If-None-Match": "*",
        },
        body: JSON.stringify({ hello: "world" }),
      });

      const resp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });

      expect(resp.status).toBe(200);
      expect(await resp.json()).toEqual({ hello: "world" });
      expect(resp.headers.get("ETag")).toBeDefined();
      expect(resp.headers.get("Last-Modified")).toBeDefined();
    });

    test("should return 404 for non-existent profile", async ({ server, authToken }) => {
      const resp = await fetch(
        `${server.apiUrl}/xapi/activities/profile?${profileParams({ profileId: "nonexistent" })}`,
        { headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" } },
      );
      expect(resp.status).toBe(404);
    });

    test("should return list of profileIds when profileId is omitted", async ({
      server,
      authToken,
    }) => {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
        "X-Experience-API-Version": "1.0.3",
        "If-None-Match": "*",
      };

      await fetch(
        `${server.apiUrl}/xapi/activities/profile?${profileParams({ profileId: "alpha" })}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ a: 1 }),
        },
      );
      await fetch(
        `${server.apiUrl}/xapi/activities/profile?${profileParams({ profileId: "beta" })}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ b: 2 }),
        },
      );

      const resp = await fetch(`${server.apiUrl}/xapi/activities/profile?${profileParams()}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });

      expect(resp.status).toBe(200);
      const data: string[] = await resp.json();
      expect(data).toContain("alpha");
      expect(data).toContain("beta");
    });

    test("should filter profileId list by since parameter", async ({ server, authToken }) => {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
        "X-Experience-API-Version": "1.0.3",
        "If-None-Match": "*",
      };

      await fetch(
        `${server.apiUrl}/xapi/activities/profile?${profileParams({ profileId: "old-prof" })}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ old: true }),
        },
      );

      const midpoint = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await fetch(
        `${server.apiUrl}/xapi/activities/profile?${profileParams({ profileId: "new-prof" })}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ new: true }),
        },
      );

      const resp = await fetch(
        `${server.apiUrl}/xapi/activities/profile?${profileParams({ since: midpoint })}`,
        {
          headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
        },
      );

      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toEqual(["new-prof"]);
    });
  });

  describe("DELETE /xapi/activities/profile", () => {
    test("should delete a profile", async ({ server, authToken }) => {
      const qs = profileParams({ profileId: "prof-del" });
      await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-Experience-API-Version": "1.0.3",
          "If-None-Match": "*",
        },
        body: JSON.stringify({ data: 1 }),
      });

      // Get ETag for delete
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      const etag = getResp.headers.get("ETag")!;

      const resp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "X-Experience-API-Version": "1.0.3",
          "If-Match": etag,
        },
      });
      expect(resp.status).toBe(204);

      // Verify gone
      const verifyResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      expect(verifyResp.status).toBe(404);
    });
  });

  describe("Non-JSON document content", () => {
    test("should store and retrieve non-JSON content via PUT/GET", async ({
      server,
      authToken,
    }) => {
      const qs = profileParams({ profileId: "binary-prof" });
      const binaryContent = "abcdefg";

      const putResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${authToken}`,
          "X-Experience-API-Version": "1.0.3",
          "If-None-Match": "*",
        },
        body: binaryContent,
      });
      expect(putResp.status).toBe(204);

      const getResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      expect(getResp.status).toBe(200);
      expect(getResp.headers.get("Content-Type")).toContain("application/octet-stream");
      const body = await getResp.text();
      expect(body).toBe(binaryContent);
    });

    test("should reject POST merge when existing document is non-JSON", async ({
      server,
      authToken,
    }) => {
      const qs = profileParams({ profileId: "non-json-merge-prof" });

      // PUT non-JSON content
      await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${authToken}`,
          "X-Experience-API-Version": "1.0.3",
          "If-None-Match": "*",
        },
        body: "abcdefg",
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      const etag = getResp.headers.get("ETag")!;

      // POST JSON merge should fail with 400
      const postResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-Experience-API-Version": "1.0.3",
          "If-Match": etag,
        },
        body: JSON.stringify({ key: "value" }),
      });
      expect(postResp.status).toBe(400);
    });

    test("should return correct Content-Type for JSON documents", async ({ server, authToken }) => {
      const qs = profileParams({ profileId: "json-ct-prof" });

      await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-Experience-API-Version": "1.0.3",
          "If-None-Match": "*",
        },
        body: JSON.stringify({ hello: "world" }),
      });

      const getResp = await fetch(`${server.apiUrl}/xapi/activities/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Experience-API-Version": "1.0.3" },
      });
      expect(getResp.status).toBe(200);
      expect(getResp.headers.get("Content-Type")).toContain("application/json");
      expect(await getResp.json()).toEqual({ hello: "world" });
    });
  });
});
