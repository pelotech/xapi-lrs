/**
 * xAPI Agents + Agent Profile Resource
 * GET /xapi/agents, /xapi/agents/profile CRUD
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { HonoEnv } from "../hono-env.ts";
import { HttpError, withClient, parseMergeBody } from "../db.ts";
import { computeEtag, checkConcurrencyHeaders } from "../helpers/etag.ts";
import { canonicalAgentIfi, validateSince } from "../helpers/agent.ts";
import {
  upsertAgentProfile,
  getAgentProfile,
  listAgentProfileIds,
  deleteAgentProfile,
} from "../repositories/agent-profile.ts";
import { getPersonObject } from "../repositories/agents.ts";
import type { PersonObject } from "../repositories/agents.ts";

// ============================================================================
// Route definitions
// ============================================================================

const getAgentRoute = createRoute({
  method: "get",
  path: "/agents",
  operationId: "GetAgent",
  tags: ["xAPI Agents"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ agent: z.string() }) },
  responses: { 200: { description: "Ok", content: { "application/json": { schema: z.any() } } } },
});

const putProfileRoute = createRoute({
  method: "put",
  path: "/agents/profile",
  operationId: "PutAgentProfile",
  tags: ["xAPI Agents"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ profileId: z.string(), agent: z.string() }) },
  responses: { 204: { description: "No content" } },
});

const postProfileRoute = createRoute({
  method: "post",
  path: "/agents/profile",
  operationId: "PostAgentProfile",
  tags: ["xAPI Agents"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ profileId: z.string(), agent: z.string() }) },
  responses: { 204: { description: "No content" } },
});

const getProfileRoute = createRoute({
  method: "get",
  path: "/agents/profile",
  operationId: "GetAgentProfile",
  tags: ["xAPI Agents"],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      agent: z.string(),
      profileId: z.string().optional(),
      since: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Ok",
      content: { "application/json": { schema: z.union([z.array(z.string()), z.any()]) } },
    },
  },
});

const deleteProfileRoute = createRoute({
  method: "delete",
  path: "/agents/profile",
  operationId: "DeleteAgentProfile",
  tags: ["xAPI Agents"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ profileId: z.string(), agent: z.string() }) },
  responses: { 204: { description: "No content" } },
});

// ============================================================================
// Helpers
// ============================================================================

// ============================================================================
// Route app
// ============================================================================

export function createAgentsApp() {
  const app = new OpenAPIHono<HonoEnv>();

  // GET /xapi/agents — Person Object
  app.openapi(getAgentRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const agentParam = c.req.query("agent")!;

    let agentObj: Record<string, unknown>;
    try {
      agentObj = JSON.parse(agentParam) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Agent parameter is not valid JSON");
    }

    if (!agentObj.account && !agentObj.mbox && !agentObj.mbox_sha1sum && !agentObj.openid) {
      throw new HttpError(400, "Agent must have at least one identifying property");
    }

    const ifi = canonicalAgentIfi(agentObj);

    const row = await withClient(pool, metrics, (client) => getPersonObject(client, ifi));

    if (!row) {
      const person: PersonObject = { objectType: "Person" };
      if (agentObj.name) person.name = [agentObj.name as string];
      if (agentObj.mbox) person.mbox = [agentObj.mbox as string];
      if (agentObj.mbox_sha1sum) person.mbox_sha1sum = [agentObj.mbox_sha1sum as string];
      if (agentObj.openid) person.openid = [agentObj.openid as string];
      if (agentObj.account)
        person.account = [agentObj.account as { homePage: string; name: string }];
      return c.json(person, 200);
    }

    return c.json(row, 200);
  });

  // PUT /xapi/agents/profile
  app.openapi(putProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const profileId = c.req.query("profileId")!;
    const agent = c.req.query("agent")!;
    const agentIfi = canonicalAgentIfi(agent);
    const body = c.var.rawBody;
    const contentType = c.req.header("content-type") ?? "application/octet-stream";
    const timestamp = new Date().toISOString();

    await withClient(pool, metrics, async (client) => {
      const existing = await getAgentProfile(client, { profileId, agentIfi });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(
        { "if-match": c.req.header("if-match"), "if-none-match": c.req.header("if-none-match") },
        existingEtag,
        true,
      );
      await upsertAgentProfile(client, {
        profileId,
        agentIfi,
        contents: body,
        contentType,
        lastModified: timestamp,
      });
    });

    return c.body(null, 204);
  });

  // POST /xapi/agents/profile (JSON merge)
  app.openapi(postProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const profileId = c.req.query("profileId")!;
    const agent = c.req.query("agent")!;
    const agentIfi = canonicalAgentIfi(agent);
    const contentType = c.req.header("content-type") ?? "";
    const body = c.var.rawBody;
    const incomingData = parseMergeBody(body, contentType);
    const timestamp = new Date().toISOString();

    await withClient(pool, metrics, async (client) => {
      const existing = await getAgentProfile(client, { profileId, agentIfi });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(
        { "if-match": c.req.header("if-match"), "if-none-match": c.req.header("if-none-match") },
        existingEtag,
      );

      if (existing && !existing.content_type.includes("application/json")) {
        throw new HttpError(400, "Cannot merge into non-JSON document");
      }

      const existingData = existing
        ? (JSON.parse(existing.contents.toString("utf8")) as Record<string, unknown>)
        : {};
      const merged = { ...existingData, ...incomingData };
      const mergedBuf = Buffer.from(JSON.stringify(merged), "utf8");

      await upsertAgentProfile(client, {
        profileId,
        agentIfi,
        contents: mergedBuf,
        contentType: existing?.content_type ?? "application/json",
        lastModified: timestamp,
      });
    });

    return c.body(null, 204);
  });

  // GET /xapi/agents/profile
  app.openapi(getProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const agent = c.req.query("agent")!;
    const profileId = c.req.query("profileId");
    const since = c.req.query("since");
    const agentIfi = canonicalAgentIfi(agent);
    validateSince(since);

    if (!profileId) {
      const ids = await withClient(pool, metrics, async (client) =>
        listAgentProfileIds(client, { agentIfi, since }),
      );
      return c.json(ids, 200);
    }

    const row = await withClient(pool, metrics, async (client) => {
      const doc = await getAgentProfile(client, { profileId, agentIfi });
      if (!doc) throw new HttpError(404, "Agent profile not found");
      return doc;
    });

    const etag = computeEtag(row.contents);
    const headers: Record<string, string> = {
      ETag: `"${etag}"`,
      "Last-Modified": row.last_modified.toUTCString(),
      "Content-Type": row.content_type,
    };

    if (row.content_type.includes("application/json")) {
      return c.json(JSON.parse(row.contents.toString("utf8")), 200, headers);
    }
    return new Response(new Uint8Array(row.contents), { status: 200, headers });
  });

  // DELETE /xapi/agents/profile
  app.openapi(deleteProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const profileId = c.req.query("profileId")!;
    const agent = c.req.query("agent")!;
    const agentIfi = canonicalAgentIfi(agent);

    await withClient(pool, metrics, async (client) => {
      const existing = await getAgentProfile(client, { profileId, agentIfi });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(
        { "if-match": c.req.header("if-match"), "if-none-match": c.req.header("if-none-match") },
        existingEtag,
      );
      await deleteAgentProfile(client, { profileId, agentIfi });
    });

    return c.body(null, 204);
  });

  return app;
}
