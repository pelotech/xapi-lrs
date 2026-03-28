/**
 * Admin statement routes — list, detail, void, attachments.
 */

import type { Hono, Context } from "hono";
import { queryStatements, getStatementById, voidStatement } from "../../repositories/statements.ts";
import { listAttachments, getAttachment } from "../repositories/index.ts";
import { withClient } from "../../db.ts";
import {
  statementsPage,
  statementTable,
  statementDetail,
  voidedConfirmation,
} from "../views/statements.ts";
import type { RawHtml } from "../views/html.ts";
import type { AdminEnv, AdminDeps } from "../types.ts";

export function registerStatementRoutes(
  app: Hono<AdminEnv>,
  deps: AdminDeps,
  renderPage: (c: Context<AdminEnv>, content: RawHtml) => Response,
): void {
  app.get("/statements", (c) => {
    const { verb, agent, activity, since, until } = c.req.query();
    return renderPage(c, statementsPage({ verb, agent, activity, since, until }));
  });

  app.get("/statements/list", async (c) => {
    const { verb, agent, activity, since, until, cursor } = c.req.query();
    const params: Record<string, unknown> = { limit: 25 };
    if (verb) params.verb = verb;
    if (agent) params.agent = agent;
    if (activity) params.activity = activity;
    if (since) params.since = new Date(since).toISOString();
    if (until) params.until = new Date(until).toISOString();
    if (cursor) params.since = cursor;

    const result = await withClient(deps.pool, deps.metrics, (client) =>
      queryStatements(client, params as Parameters<typeof queryStatements>[1]),
    );

    const lastRow = result.rows[result.rows.length - 1];
    const nextCursor = result.hasMore && lastRow ? lastRow.stored.toISOString() : undefined;

    // Build filter query string for pagination links
    const filterParams = new URLSearchParams();
    if (verb) filterParams.set("verb", verb);
    if (agent) filterParams.set("agent", agent);
    if (activity) filterParams.set("activity", activity);
    if (since) filterParams.set("since", since);
    if (until) filterParams.set("until", until);

    return c.html(
      statementTable({
        rows: result.rows,
        hasMore: result.hasMore,
        cursor: nextCursor,
        filters: filterParams.toString(),
      }).value,
    );
  });

  app.get("/statements/:id", async (c) => {
    const statementId = c.req.param("id");

    const row = await withClient(deps.pool, deps.metrics, (client) =>
      getStatementById(client, statementId),
    );

    if (!row) {
      return c.text("Statement not found", 404);
    }

    const attachments = await listAttachments(deps.pool, deps.metrics, statementId);
    return renderPage(c, statementDetail(row, attachments));
  });

  app.post("/statements/:id/void", async (c) => {
    const statementId = c.req.param("id");
    const session = c.get("adminSession");

    await withClient(deps.pool, deps.metrics, (client) => voidStatement(client, statementId));

    c.var.logger.info(
      { admin: session.username, action: "statement.void", target: statementId },
      "Statement voided",
    );

    return c.html(voidedConfirmation().value);
  });

  app.get("/statements/:id/attachments/:sha", async (c) => {
    const statementId = c.req.param("id");
    const sha = c.req.param("sha");

    const attachment = await getAttachment(deps.pool, deps.metrics, statementId, sha);
    if (!attachment) {
      return c.text("Attachment not found", 404);
    }

    return c.body(new Uint8Array(attachment.contents), 200, {
      "Content-Type": attachment.content_type,
      "Content-Disposition": `attachment; filename="${sha.replace(/[^a-fA-F0-9]/g, "")}"`,
    });
  });
}
