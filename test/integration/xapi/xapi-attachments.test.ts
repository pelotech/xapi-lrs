/**
 * Integration Tests: xAPI Statement Attachments (Multipart/Mixed)
 *
 * Tests the full attachment lifecycle: POST multipart/mixed with binary
 * attachments and fileUrl-only attachments.
 */

import { createHash, randomUUID } from "node:crypto";
import { test, describe, expect } from "../fixtures.ts";

const V = { "X-Experience-API-Version": "1.0.3" } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalStatement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actor: { mbox: "mailto:test@example.com" },
    verb: { id: "http://example.com/verbs/did", display: { "en-US": "did" } },
    object: { id: "http://example.com/activities/1" },
    ...overrides,
  };
}

/**
 * Build a multipart/mixed body for xAPI statement POST with binary attachments.
 *
 * Returns { body, boundary, contentType } ready to pass to fetch().
 */
function buildMultipartBody(
  statement: unknown,
  attachments: Array<{ data: Buffer; contentType: string; sha2: string }>,
): { body: Buffer; boundary: string; contentType: string } {
  const boundary = `xapi-test-boundary-${randomUUID().slice(0, 8)}`;
  const parts: Buffer[] = [];

  // Part 1: JSON statement
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from("Content-Type: application/json\r\n"));
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(JSON.stringify(statement)));
  parts.push(Buffer.from("\r\n"));

  // Subsequent parts: binary attachments
  for (const att of attachments) {
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Type: ${att.contentType}\r\n`));
    parts.push(Buffer.from("Content-Transfer-Encoding: binary\r\n"));
    parts.push(Buffer.from(`X-Experience-API-Hash: ${att.sha2}\r\n`));
    parts.push(Buffer.from("\r\n"));
    parts.push(att.data);
    parts.push(Buffer.from("\r\n"));
  }

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    boundary,
    contentType: `multipart/mixed; boundary=${boundary}`,
  };
}

// ---------------------------------------------------------------------------
// Tests: JSON-only (fileUrl attachments)
// ---------------------------------------------------------------------------

describe("xAPI Statement Attachments", () => {
  describe("POST /xapi/statements (JSON with fileUrl attachment)", () => {
    test("should accept statement with fileUrl-only attachment (no binary part)", async ({
      server,
      basicAuth,
    }) => {
      const stmt = minimalStatement({
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "A file URL attachment" },
            contentType: "text/plain",
            length: 100,
            sha2: "abc123",
            fileUrl: "https://example.com/files/test.txt",
          },
        ],
      });

      const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify(stmt),
      });

      expect(resp.status).toBe(200);
    });
  });

  // =========================================================================
  // Multipart/mixed — POST
  // =========================================================================

  describe("POST /xapi/statements (multipart/mixed)", () => {
    test("should store statement with binary attachment and return 200", async ({
      server,
      basicAuth,
    }) => {
      const attachmentData = Buffer.from("This is test attachment content");
      const sha2 = createHash("sha256").update(attachmentData).digest("hex");

      const stmt = minimalStatement({
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "Binary attachment" },
            contentType: "text/plain",
            length: attachmentData.length,
            sha2,
          },
        ],
      });

      const { body, contentType } = buildMultipartBody(stmt, [
        { data: attachmentData, contentType: "text/plain", sha2 },
      ]);

      const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
        method: "POST",
        headers: { "Content-Type": contentType, Authorization: `Basic ${basicAuth}`, ...V },
        body: new Uint8Array(body),
      });

      expect(resp.status).toBe(200);
      const ids = await resp.json();
      expect(ids).toHaveLength(1);
    });

    test("should reject when statement attachment has no fileUrl and no matching binary", async ({
      server,
      basicAuth,
    }) => {
      const sha2 = createHash("sha256").update("missing data").digest("hex");

      const stmt = minimalStatement({
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "Missing binary" },
            contentType: "text/plain",
            length: 12,
            sha2,
          },
        ],
      });

      // Send as multipart but with NO binary parts
      const boundary = `xapi-attachment-${randomUUID()}`;
      const jsonPart = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(stmt)}\r\n--${boundary}--\r\n`;

      const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
          Authorization: `Basic ${basicAuth}`,
          ...V,
        },
        body: Buffer.from(jsonPart),
      });

      expect(resp.status).toBe(400);
      const json = (await resp.json()) as { error: string };
      expect(json.error).toContain("Missing binary data for attachment");
    });

    test("should reject when attachment hash does not match binary data", async ({
      server,
      basicAuth,
    }) => {
      const binaryData = Buffer.from("actual data");
      const fakeSha2 = createHash("sha256").update("different data").digest("hex");

      const stmt = minimalStatement({
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "Bad hash" },
            contentType: "text/plain",
            length: binaryData.length,
            sha2: fakeSha2,
          },
        ],
      });

      const { body, contentType } = buildMultipartBody(stmt, [
        { data: binaryData, contentType: "text/plain", sha2: fakeSha2 },
      ]);

      const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Authorization: `Basic ${basicAuth}`,
          ...V,
        },
        body: new Uint8Array(body),
      });

      expect(resp.status).toBe(400);
      const json = (await resp.json()) as { error: string };
      expect(json.error).toContain("Attachment hash mismatch");
    });
  });

  // =========================================================================
  // Multipart/mixed — PUT
  // =========================================================================

  describe("PUT /xapi/statements (multipart/mixed)", () => {
    test("should store statement with attachment via PUT", async ({ server, basicAuth }) => {
      const binaryData = Buffer.from("PUT attachment data");
      const sha2 = createHash("sha256").update(binaryData).digest("hex");
      const statementId = randomUUID();

      const stmt = minimalStatement({
        id: statementId,
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "PUT attachment" },
            contentType: "application/octet-stream",
            length: binaryData.length,
            sha2,
          },
        ],
      });

      const { body, boundary } = buildMultipartBody(stmt, [
        { sha2, contentType: "application/octet-stream", data: binaryData },
      ]);

      const resp = await fetch(`${server.apiUrl}/xapi/statements?statementId=${statementId}`, {
        method: "PUT",
        headers: {
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
          Authorization: `Basic ${basicAuth}`,
          ...V,
        },
        body: new Uint8Array(body),
      });

      expect(resp.status).toBe(204);
    });
  });

  // =========================================================================
  // GET ?attachments=true
  // =========================================================================

  describe("GET /xapi/statements?attachments=true", () => {
    test("should return multipart/mixed response with attachment data", async ({
      server,
      basicAuth,
    }) => {
      const binaryData = Buffer.from("GET attachment round-trip");
      const sha2 = createHash("sha256").update(binaryData).digest("hex");

      const stmt = minimalStatement({
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "Round-trip attachment" },
            contentType: "text/plain",
            length: binaryData.length,
            sha2,
          },
        ],
      });

      // POST the statement with attachment
      const { body, boundary } = buildMultipartBody(stmt, [
        { sha2, contentType: "text/plain", data: binaryData },
      ]);
      const postResp = await fetch(`${server.apiUrl}/xapi/statements`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
          Authorization: `Basic ${basicAuth}`,
          ...V,
        },
        body: new Uint8Array(body),
      });
      expect(postResp.status).toBe(200);
      const [statementId] = (await postResp.json()) as string[];

      // GET with attachments=true
      const getResp = await fetch(
        `${server.apiUrl}/xapi/statements?statementId=${statementId}&attachments=true`,
        {
          headers: { Authorization: `Basic ${basicAuth}`, ...V },
        },
      );

      expect(getResp.status).toBe(200);
      const ct = getResp.headers.get("content-type") ?? "";
      expect(ct).toContain("multipart/mixed");

      // Verify the response body contains both the JSON statement and the binary data
      const respBody = Buffer.from(await getResp.arrayBuffer());
      const respText = respBody.toString("utf8");
      expect(respText).toContain("application/json");
      expect(respText).toContain(statementId);
      expect(respBody.includes(binaryData)).toBe(true);
    });

    test("should return plain JSON when attachments=false", async ({ server, basicAuth }) => {
      const binaryData = Buffer.from("no-attachments test");
      const sha2 = createHash("sha256").update(binaryData).digest("hex");

      const stmt = minimalStatement({
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "No-attachments test" },
            contentType: "text/plain",
            length: binaryData.length,
            sha2,
          },
        ],
      });

      // POST with attachment
      const { body, boundary } = buildMultipartBody(stmt, [
        { sha2, contentType: "text/plain", data: binaryData },
      ]);
      const postResp = await fetch(`${server.apiUrl}/xapi/statements`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
          Authorization: `Basic ${basicAuth}`,
          ...V,
        },
        body: new Uint8Array(body),
      });
      expect(postResp.status).toBe(200);
      const [statementId] = (await postResp.json()) as string[];

      // GET without attachments
      const getResp = await fetch(
        `${server.apiUrl}/xapi/statements?statementId=${statementId}&attachments=false`,
        {
          headers: { Authorization: `Basic ${basicAuth}`, ...V },
        },
      );

      expect(getResp.status).toBe(200);
      const ct = getResp.headers.get("content-type") ?? "";
      expect(ct).toContain("application/json");
    });

    test("should return multipart/mixed for list query with attachments=true", async ({
      server,
      basicAuth,
    }) => {
      const binaryData = Buffer.from("list query attachment");
      const sha2 = createHash("sha256").update(binaryData).digest("hex");

      const stmt = minimalStatement({
        attachments: [
          {
            usageType: "http://example.com/attachment-usage/test",
            display: { "en-US": "List query attachment" },
            contentType: "text/plain",
            length: binaryData.length,
            sha2,
          },
        ],
      });

      // POST with attachment
      const { body, boundary } = buildMultipartBody(stmt, [
        { sha2, contentType: "text/plain", data: binaryData },
      ]);
      const postResp = await fetch(`${server.apiUrl}/xapi/statements`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
          Authorization: `Basic ${basicAuth}`,
          ...V,
        },
        body: new Uint8Array(body),
      });
      expect(postResp.status).toBe(200);

      // GET list query with attachments=true
      const getResp = await fetch(`${server.apiUrl}/xapi/statements?attachments=true`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(getResp.status).toBe(200);
      const ct = getResp.headers.get("content-type") ?? "";
      expect(ct).toContain("multipart/mixed");

      // Verify the response contains the binary attachment data
      const respBody = Buffer.from(await getResp.arrayBuffer());
      expect(respBody.includes(binaryData)).toBe(true);
    });
  });
});
