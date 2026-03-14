/**
 * xAPI Statements Resource — helper functions and constants.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { LrsDeps } from "../deps.ts";
import type { AuthInfo } from "../auth/types.ts";
import { HttpError } from "../db.ts";
import { getStatementById, voidStatement } from "../repositories/statements.ts";
import { getAttachmentsByStatement } from "../repositories/attachments.ts";
import { canonicalAgentIfi } from "../helpers/agent.ts";
import { agentIfiFromAuth } from "../helpers/auth-agent.ts";
import { buildAuthority } from "../helpers/enrichment.ts";
import type { MultipartAttachmentPart, ResponseAttachmentPart } from "../xapi/multipart.ts";
import { validateSignedStatements } from "../xapi/signature.ts";

export const VOIDED_VERB_ID = "http://adlnet.gov/expapi/verbs/voided";

// ============================================================================
// OpenAPI route definitions (for doc generation)
// ============================================================================

export const postStatementsRoute = createRoute({
  method: "post",
  path: "/statements",
  operationId: "PostStatements",
  tags: ["xAPI Statements"],
  security: [{ basic: [] }, { jwt: [] }],
  responses: {
    200: {
      description: "Ok",
      content: { "application/json": { schema: z.array(z.string()) } },
    },
  },
});

export const putStatementRoute = createRoute({
  method: "put",
  path: "/statements",
  operationId: "PutStatement",
  tags: ["xAPI Statements"],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ statementId: z.string() }) },
  responses: { 204: { description: "No content" } },
});

export const getStatementsRoute = createRoute({
  method: "get",
  path: "/statements",
  operationId: "GetStatements",
  tags: ["xAPI Statements"],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      statementId: z.string().optional(),
      voidedStatementId: z.string().optional(),
      agent: z.string().optional(),
      verb: z.string().optional(),
      activity: z.string().optional(),
      registration: z.string().optional(),
      related_activities: z.coerce.boolean().optional(),
      related_agents: z.coerce.boolean().optional(),
      format: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.coerce.number().optional(),
      ascending: z.coerce.boolean().optional(),
      attachments: z.coerce.boolean().optional(),
    }),
  },
  responses: { 204: { description: "No content" } },
});

// ============================================================================
// Constants
// ============================================================================

export const STATEMENTS_KNOWN_PARAMS = new Set([
  "statementId",
  "voidedStatementId",
  "agent",
  "verb",
  "activity",
  "registration",
  "related_activities",
  "related_agents",
  "format",
  "since",
  "until",
  "limit",
  "ascending",
  "attachments",
]);

// ============================================================================
// Helper functions
// ============================================================================

export async function handleVoiding(
  client: import("pg").PoolClient,
  stmt: Record<string, unknown>,
): Promise<void> {
  const obj = stmt.object as Record<string, unknown> | undefined;
  const targetId = obj?.id as string | undefined;
  const objectType = obj?.objectType as string | undefined;

  if (objectType !== "StatementRef" || !targetId) {
    throw new HttpError(400, "Voiding statement must reference a StatementRef");
  }

  const target = await getStatementById(client, targetId);
  if (target) {
    const targetVerb = (target.payload as Record<string, unknown>).verb as Record<string, unknown>;
    if (targetVerb?.id === VOIDED_VERB_ID) {
      throw new HttpError(400, "Cannot void a voiding statement");
    }
  }

  await voidStatement(client, targetId);
}

export async function validateAttachmentParts(
  statements: Record<string, unknown>[],
  parts: Map<string, MultipartAttachmentPart>,
  deps: LrsDeps,
): Promise<void> {
  const allHashes = new Set<string>();
  const requiredHashes = new Set<string>();
  for (const stmt of statements) {
    const atts = stmt.attachments as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(atts)) continue;
    for (const att of atts) {
      if (att.sha2) {
        allHashes.add(att.sha2 as string);
        if (!att.fileUrl) {
          requiredHashes.add(att.sha2 as string);
        }
      }
    }
  }

  for (const sha2 of parts.keys()) {
    if (!allHashes.has(sha2)) {
      throw new HttpError(
        400,
        `Excess multipart section with hash ${sha2} does not match any statement attachment`,
      );
    }
  }

  for (const sha2 of requiredHashes) {
    if (!parts.has(sha2)) {
      throw new HttpError(400, `Missing binary data for attachment with sha2 ${sha2}`);
    }
  }

  for (const [sha2, part] of parts) {
    const actualHash = createHash("sha256").update(part.data).digest("hex");
    if (actualHash !== sha2) {
      throw new HttpError(400, `Attachment hash mismatch: expected ${sha2}, got ${actualHash}`);
    }
  }

  await validateSignedStatements(statements, parts, {
    verifySignatures: deps.xapiVerifySignatures,
    logger: deps.logger,
  });
}

export function authorityFromAuth(auth: AuthInfo): Record<string, unknown> {
  if (auth.type === "basic") {
    return buildAuthority(auth.payload.accountName);
  }
  return {
    objectType: "Agent",
    account: { homePage: auth.payload.iss, name: auth.payload.sub },
  };
}

/**
 * Verify that a statement's actor matches the authenticated agent.
 * Throws 403 if the statement does not belong to the authenticated user.
 */
export function assertStatementBelongsToAgent(
  payload: Record<string, unknown>,
  auth: AuthInfo,
): void {
  const actor = payload.actor as Record<string, unknown> | undefined;
  if (!actor) throw new HttpError(403, "Forbidden");

  try {
    const stmtIfi = canonicalAgentIfi(actor);
    const authIfi = agentIfiFromAuth(auth);
    if (stmtIfi !== authIfi) {
      throw new HttpError(403, "Forbidden");
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "Forbidden");
  }
}

export async function collectAttachmentParts(
  client: import("pg").PoolClient,
  stmt: unknown,
): Promise<ResponseAttachmentPart[]> {
  const parts: ResponseAttachmentPart[] = [];
  const stmtObj = stmt as Record<string, unknown>;
  const stmtId = stmtObj.id as string | undefined;
  if (!stmtId) return parts;

  const rows = await getAttachmentsByStatement(client, stmtId);
  for (const row of rows) {
    parts.push({
      sha2: row.attachment_sha,
      contentType: row.content_type,
      stream: Readable.from(row.contents),
    });
  }
  return parts;
}

export async function collectAttachmentPartsFromList(
  client: import("pg").PoolClient,
  statements: unknown[],
): Promise<ResponseAttachmentPart[]> {
  const parts: ResponseAttachmentPart[] = [];
  const seen = new Set<string>();
  for (const stmt of statements) {
    for (const part of await collectAttachmentParts(client, stmt)) {
      if (!seen.has(part.sha2)) {
        seen.add(part.sha2);
        parts.push(part);
      }
    }
  }
  return parts;
}
