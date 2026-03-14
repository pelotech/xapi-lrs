/**
 * xAPI Activities Resource — route definitions and helpers.
 */

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { computeEtag } from "../helpers/etag.ts";

// ============================================================================
// OpenAPI route definitions
// ============================================================================

export const getActivityRoute = createRoute({
  method: "get",
  path: "/activities",
  operationId: "GetActivity",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ activityId: z.string() }) },
  responses: { 200: { description: "Ok", content: { "application/json": { schema: z.any() } } } },
});

export const putStateRoute = createRoute({
  method: "put",
  path: "/activities/state",
  operationId: "PutState",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      stateId: z.string(),
      activityId: z.string(),
      agent: z.string(),
      registration: z.string().optional(),
    }),
  },
  responses: { 204: { description: "No content" } },
});

export const postStateRoute = createRoute({
  method: "post",
  path: "/activities/state",
  operationId: "PostState",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      stateId: z.string(),
      activityId: z.string(),
      agent: z.string(),
      registration: z.string().optional(),
    }),
  },
  responses: { 204: { description: "No content" } },
});

export const getStateRoute = createRoute({
  method: "get",
  path: "/activities/state",
  operationId: "GetState",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      activityId: z.string(),
      agent: z.string(),
      stateId: z.string().optional(),
      registration: z.string().optional(),
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

export const deleteStateRoute = createRoute({
  method: "delete",
  path: "/activities/state",
  operationId: "DeleteState",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      activityId: z.string(),
      agent: z.string(),
      stateId: z.string().optional(),
      registration: z.string().optional(),
      since: z.string().optional(),
    }),
  },
  responses: { 204: { description: "No content" } },
});

export const putProfileRoute = createRoute({
  method: "put",
  path: "/activities/profile",
  operationId: "PutActivityProfile",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ profileId: z.string(), activityId: z.string() }) },
  responses: { 204: { description: "No content" } },
});

export const postProfileRoute = createRoute({
  method: "post",
  path: "/activities/profile",
  operationId: "PostActivityProfile",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ profileId: z.string(), activityId: z.string() }) },
  responses: { 204: { description: "No content" } },
});

export const getProfileRoute = createRoute({
  method: "get",
  path: "/activities/profile",
  operationId: "GetActivityProfile",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      activityId: z.string(),
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

export const deleteProfileRoute = createRoute({
  method: "delete",
  path: "/activities/profile",
  operationId: "DeleteActivityProfile",
  tags: ["xAPI Activities"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ profileId: z.string(), activityId: z.string() }) },
  responses: { 204: { description: "No content" } },
});

// ============================================================================
// Helpers
// ============================================================================

/** Extract If-Match / If-None-Match headers from a request. */
export function concurrencyHeaders(c: Context): {
  "if-match": string | undefined;
  "if-none-match": string | undefined;
} {
  return {
    "if-match": c.req.header("if-match"),
    "if-none-match": c.req.header("if-none-match"),
  };
}

/** Build a Response for a raw document with etag, last-modified, and content-type. */
export function documentResponse(
  c: Context,
  row: { contents: Buffer; content_type: string; last_modified: Date },
): Response {
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
}
