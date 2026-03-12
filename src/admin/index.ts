/**
 * Admin UI — Hono sub-app mounted at /admin.
 * Server-rendered HTML with htmx for interactivity.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import {
  XAPI_NOTIFY_CHANNEL,
  HEARTBEAT_INTERVAL_MS,
  buildStatementEvent,
} from "../sse/statement-event.ts";
import type { Pool } from "pg";
import type { LrsMetrics } from "../metrics.ts";
import type { Logger } from "../logger.ts";
import type { PgListener } from "../sse/pg-listener.ts";
import type { AdminSession } from "./types.ts";
import { adminAuthMiddleware, csrfMiddleware, createSession, clearSession } from "./middleware.ts";
import { HTMX_JS, HTMX_SSE_JS, PICO_CSS } from "./assets.ts";
import {
  verifyPassword,
  getDashboardCounts,
  getRecentStatements,
  listAccounts,
  createAccount,
  deleteAccount,
  changePassword,
  listCredentials,
  createCredential,
  deleteCredential,
  rotateSecret,
  setCredentialScopes,
  listAttachments,
  getAttachment,
  listStateDocuments,
  listActivityProfiles,
  listAgentProfiles,
  getStateDocumentById,
  getActivityProfileById,
  getAgentProfileById,
  deleteStateDocumentById,
  deleteActivityProfileById,
  deleteAgentProfileById,
  bulkDeleteStateDocuments,
} from "./repositories.ts";
import { queryStatements, getStatementById, voidStatement } from "../repositories/statements.ts";
import { withClient } from "../db.ts";
import { randomBytes } from "node:crypto";
import { resolveClientIp } from "../helpers/client-ip.ts";
import { loginPage } from "./views/login.ts";
import { layout } from "./views/layout.ts";
import { dashboardPage } from "./views/dashboard.ts";
import { metricsPage } from "./views/metrics.ts";
import { accountsPage, accountList } from "./views/accounts.ts";
import { credentialsPage, rotatedSecret, scopeUpdated, deletedRow } from "./views/credentials.ts";
import {
  statementsPage,
  statementTable,
  statementDetail,
  voidedConfirmation,
} from "./views/statements.ts";
import {
  documentsPage,
  stateDocumentTable,
  activityProfileTable,
  agentProfileTable,
  documentDetailView,
  bulkDeleteResult,
  deletedDocRow,
} from "./views/documents.ts";
import { streamPage } from "./views/stream.ts";
import type { RawHtml } from "./views/html.ts";

// ============================================================================
// Login rate limiter — per-IP sliding window
// ============================================================================

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

class LoginRateLimiter {
  private attempts = new Map<string, number[]>();

  /** Interval handle for periodic pruning of stale keys */
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Prune stale keys every 5 minutes to prevent unbounded memory growth
    this.pruneTimer = setInterval(() => this.pruneStaleKeys(), 5 * 60 * 1000);
    if (this.pruneTimer && typeof this.pruneTimer === "object" && "unref" in this.pruneTimer) {
      this.pruneTimer.unref();
    }
  }

  isBlocked(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.attempts.get(ip);
    if (!timestamps) return false;
    const recent = timestamps.filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length === 0) {
      this.attempts.delete(ip);
      return false;
    }
    this.attempts.set(ip, recent);
    return recent.length >= LOGIN_MAX_ATTEMPTS;
  }

  recordFailure(ip: string): void {
    const now = Date.now();
    const timestamps = this.attempts.get(ip) ?? [];
    timestamps.push(now);
    this.attempts.set(ip, timestamps);
  }

  reset(ip: string): void {
    this.attempts.delete(ip);
  }

  private pruneStaleKeys(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter((t) => now - t < LOGIN_WINDOW_MS);
      if (recent.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, recent);
      }
    }
  }
}

// ============================================================================
// Hono env for admin routes
// ============================================================================

type AdminEnv = {
  Variables: {
    adminSession: AdminSession;
    csrfToken: string;
    adminDeps: AdminDeps;
  };
};

export interface AdminDeps {
  pool: Pool;
  metrics: LrsMetrics;
  logger: Logger;
  pgListener: PgListener;
  sessionSecret: string;
  startedAt: Date;
  trustedProxyHops: number;
}

export function createAdminApp(deps: AdminDeps): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  const loginLimiter = new LoginRateLimiter();

  // --------------------------------------------------------------------------
  // Security headers
  // --------------------------------------------------------------------------
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    if (process.env.NODE_ENV === "production") {
      c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
    await next();
  });

  // --------------------------------------------------------------------------
  // Deps injection
  // --------------------------------------------------------------------------
  app.use("*", async (c, next) => {
    c.set("adminDeps", deps);
    await next();
  });

  // --------------------------------------------------------------------------
  // Static assets (public, no auth)
  // --------------------------------------------------------------------------
  app.get("/assets/pico.min.css", (c) => {
    c.header("Cache-Control", "public, max-age=604800, immutable");
    return c.text(PICO_CSS, 200, { "Content-Type": "text/css; charset=utf-8" });
  });
  app.get("/assets/htmx.min.js", (c) => {
    c.header("Cache-Control", "public, max-age=604800, immutable");
    return c.text(HTMX_JS, 200, { "Content-Type": "application/javascript; charset=utf-8" });
  });
  app.get("/assets/sse.js", (c) => {
    c.header("Cache-Control", "public, max-age=604800, immutable");
    return c.text(HTMX_SSE_JS, 200, { "Content-Type": "application/javascript; charset=utf-8" });
  });

  // --------------------------------------------------------------------------
  // Auth + CSRF middleware
  // --------------------------------------------------------------------------
  app.use("*", adminAuthMiddleware(deps.sessionSecret));
  app.use("*", csrfMiddleware());

  // --------------------------------------------------------------------------
  // Helper: render a page within the layout
  // --------------------------------------------------------------------------
  function renderPage(c: Context<AdminEnv>, content: RawHtml) {
    const session = c.get("adminSession");
    const csrf = c.get("csrfToken");
    return c.html(
      layout(
        { title: "Admin", path: c.req.path, username: session.username, csrfToken: csrf },
        content,
      ).value,
    );
  }

  // --------------------------------------------------------------------------
  // Login / Logout
  // --------------------------------------------------------------------------
  app.get("/login", (c) => {
    return c.html(loginPage().value);
  });

  app.post("/login", async (c) => {
    const ip = resolveClientIp(c.req.header("x-forwarded-for"), deps.trustedProxyHops);
    if (loginLimiter.isBlocked(ip)) {
      deps.logger.warn({ ip, action: "login.rate_limited" }, "Admin login rate limited");
      return c.html(loginPage("Too many login attempts. Try again later.").value, 429);
    }

    const body = await c.req.parseBody();
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");

    if (!username || !password) {
      return c.html(loginPage("Username and password are required").value, 400);
    }
    if (username.length > 64 || password.length > 1024) {
      return c.html(loginPage("Username or password too long").value, 400);
    }

    const account = await verifyPassword(deps.pool, deps.metrics, username, password);
    if (!account) {
      loginLimiter.recordFailure(ip);
      deps.logger.info({ admin: username, action: "login.failed" }, "Admin login failed");
      return c.html(loginPage("Invalid username or password").value, 401);
    }

    loginLimiter.reset(ip);
    const session: AdminSession = {
      accountId: account.id,
      username: account.username,
      exp: Date.now() + 900_000, // 15 min (sliding window renews on each request)
    };

    createSession(c, session, deps.sessionSecret);
    deps.logger.info({ admin: username, action: "login.success" }, "Admin login");
    return c.redirect("/admin");
  });

  app.post("/logout", (c) => {
    const session = c.get("adminSession");
    if (session) {
      deps.logger.info({ admin: session.username, action: "logout" }, "Admin logout");
    }
    clearSession(c);
    return c.redirect("/admin/login");
  });

  // --------------------------------------------------------------------------
  // Dashboard
  // --------------------------------------------------------------------------
  app.get("/", async (c) => {
    const [counts, recent] = await Promise.all([
      getDashboardCounts(deps.pool, deps.metrics),
      getRecentStatements(deps.pool, deps.metrics),
    ]);

    const uptimeMs = Date.now() - deps.startedAt.getTime();
    const hours = Math.floor(uptimeMs / 3_600_000);
    const minutes = Math.floor((uptimeMs % 3_600_000) / 60_000);
    const uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return renderPage(c, dashboardPage(counts, recent, uptime));
  });

  // --------------------------------------------------------------------------
  // Metrics
  // --------------------------------------------------------------------------
  app.get("/metrics", async (c) => {
    const rawMetrics = await deps.metrics.getPrometheusText();
    return renderPage(c, metricsPage(rawMetrics));
  });

  app.get("/metrics/raw", async (c) => {
    const content = await deps.metrics.getPrometheusText();
    return c.text(content, 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  });

  // --------------------------------------------------------------------------
  // Accounts
  // --------------------------------------------------------------------------
  app.get("/accounts", async (c) => {
    const accounts = await listAccounts(deps.pool, deps.metrics);
    const csrf = c.get("csrfToken");
    return renderPage(c, accountsPage(accounts, csrf));
  });

  app.post("/accounts", async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    const session = c.get("adminSession");

    if (!username || !password) {
      return c.text("Username and password are required", 400);
    }
    if (username.length > 64 || password.length > 1024) {
      return c.text("Username or password too long", 400);
    }
    if (password.length < 12) {
      return c.text("Password must be at least 12 characters", 400);
    }

    await createAccount(deps.pool, deps.metrics, username, password);
    deps.logger.info(
      { admin: session.username, action: "account.create", target: username },
      "Admin account created",
    );

    const accounts = await listAccounts(deps.pool, deps.metrics);
    return c.html(accountList(accounts).value);
  });

  app.delete("/accounts/:id", async (c) => {
    const accountId = c.req.param("id");
    const session = c.get("adminSession");

    if (accountId === session.accountId) {
      return c.text("Cannot delete your own account", 400);
    }

    await deleteAccount(deps.pool, deps.metrics, accountId);
    deps.logger.info(
      { admin: session.username, action: "account.delete", target: accountId },
      "Admin account deleted",
    );

    const accounts = await listAccounts(deps.pool, deps.metrics);
    return c.html(accountList(accounts).value);
  });

  app.put("/accounts/:id/password", async (c) => {
    const accountId = c.req.param("id");
    const body = await c.req.parseBody();
    const password = String(body.password ?? "");
    const session = c.get("adminSession");

    if (!password) {
      return c.text("Password is required", 400);
    }
    if (password.length > 1024) {
      return c.text("Password too long", 400);
    }
    if (password.length < 12) {
      return c.text("Password must be at least 12 characters", 400);
    }

    await changePassword(deps.pool, deps.metrics, accountId, password);
    deps.logger.info(
      { admin: session.username, action: "account.changePassword", target: accountId },
      "Password changed",
    );

    const accounts = await listAccounts(deps.pool, deps.metrics);
    return c.html(accountList(accounts).value);
  });

  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------
  app.get("/credentials", async (c) => {
    const [credentials, accounts] = await Promise.all([
      listCredentials(deps.pool, deps.metrics),
      listAccounts(deps.pool, deps.metrics),
    ]);
    const csrf = c.get("csrfToken");
    return renderPage(c, credentialsPage(credentials, accounts, csrf));
  });

  app.post("/credentials", async (c) => {
    const body = await c.req.parseBody();
    const accountId = String(body.account_id ?? "");
    const scopes = (
      Array.isArray(body.scopes) ? body.scopes : body.scopes ? [body.scopes] : []
    ) as string[];
    const session = c.get("adminSession");

    if (!accountId) {
      return c.text("Account is required", 400);
    }

    const apiKey = randomBytes(20).toString("hex");
    const secretKey = randomBytes(32).toString("hex");
    const credId = await createCredential(deps.pool, deps.metrics, apiKey, secretKey, accountId);

    if (scopes.length > 0) {
      await setCredentialScopes(deps.pool, deps.metrics, credId, scopes);
    }

    deps.logger.info(
      { admin: session.username, action: "credential.create", target: credId },
      "Credential created",
    );

    // Re-render full page to show the new credential alert
    const [credentials, accounts] = await Promise.all([
      listCredentials(deps.pool, deps.metrics),
      listAccounts(deps.pool, deps.metrics),
    ]);
    const csrf = c.get("csrfToken");
    return renderPage(c, credentialsPage(credentials, accounts, csrf, { apiKey, secretKey }));
  });

  app.delete("/credentials/:id", async (c) => {
    const credId = c.req.param("id");
    const session = c.get("adminSession");

    await deleteCredential(deps.pool, deps.metrics, credId);
    deps.logger.info(
      { admin: session.username, action: "credential.delete", target: credId },
      "Credential deleted",
    );

    return c.html(deletedRow().value);
  });

  app.post("/credentials/:id/rotate", async (c) => {
    const credId = c.req.param("id");
    const session = c.get("adminSession");

    const newSecret = randomBytes(32).toString("hex");
    await rotateSecret(deps.pool, deps.metrics, credId, newSecret);
    deps.logger.info(
      { admin: session.username, action: "credential.rotate", target: credId },
      "Secret rotated",
    );

    return c.html(rotatedSecret(newSecret).value);
  });

  app.put("/credentials/:id/scopes", async (c) => {
    const credId = c.req.param("id");
    const body = await c.req.parseBody();
    const scopes = (
      Array.isArray(body.scopes) ? body.scopes : body.scopes ? [body.scopes] : []
    ) as string[];
    const session = c.get("adminSession");

    await setCredentialScopes(deps.pool, deps.metrics, credId, scopes);
    deps.logger.info(
      { admin: session.username, action: "credential.scopes", target: credId, scopes },
      "Scopes updated",
    );

    return c.html(scopeUpdated().value);
  });

  // --------------------------------------------------------------------------
  // Statements
  // --------------------------------------------------------------------------
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

    deps.logger.info(
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

  // --------------------------------------------------------------------------
  // Documents
  // --------------------------------------------------------------------------
  app.get("/documents", (c) => {
    return renderPage(c, documentsPage());
  });

  app.get("/documents/list", async (c) => {
    const type = c.req.query("type") ?? "state";
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
    const pageSize = 25;
    const offset = (page - 1) * pageSize;

    if (type === "state") {
      const { rows, total } = await listStateDocuments(deps.pool, deps.metrics, pageSize, offset);
      return c.html(stateDocumentTable(rows, total, page, pageSize).value);
    } else if (type === "activity-profile") {
      const { rows, total } = await listActivityProfiles(deps.pool, deps.metrics, pageSize, offset);
      return c.html(activityProfileTable(rows, total, page, pageSize).value);
    } else {
      const { rows, total } = await listAgentProfiles(deps.pool, deps.metrics, pageSize, offset);
      return c.html(agentProfileTable(rows, total, page, pageSize).value);
    }
  });

  app.get("/documents/state/:id", async (c) => {
    const doc = await getStateDocumentById(deps.pool, deps.metrics, c.req.param("id"));
    if (!doc) return c.text("Not found", 404);
    return renderPage(c, documentDetailView(doc));
  });

  app.get("/documents/activity-profile/:id", async (c) => {
    const doc = await getActivityProfileById(deps.pool, deps.metrics, c.req.param("id"));
    if (!doc) return c.text("Not found", 404);
    return renderPage(c, documentDetailView(doc));
  });

  app.get("/documents/agent-profile/:id", async (c) => {
    const doc = await getAgentProfileById(deps.pool, deps.metrics, c.req.param("id"));
    if (!doc) return c.text("Not found", 404);
    return renderPage(c, documentDetailView(doc));
  });

  app.delete("/documents/state/:id", async (c) => {
    const session = c.get("adminSession");
    await deleteStateDocumentById(deps.pool, deps.metrics, c.req.param("id"));
    deps.logger.info(
      {
        admin: session.username,
        action: "document.delete",
        target: c.req.param("id"),
        type: "state",
      },
      "State document deleted",
    );
    return c.html(deletedDocRow().value);
  });

  app.delete("/documents/activity-profile/:id", async (c) => {
    const session = c.get("adminSession");
    await deleteActivityProfileById(deps.pool, deps.metrics, c.req.param("id"));
    deps.logger.info(
      {
        admin: session.username,
        action: "document.delete",
        target: c.req.param("id"),
        type: "activity-profile",
      },
      "Activity profile deleted",
    );
    return c.html(deletedDocRow().value);
  });

  app.delete("/documents/agent-profile/:id", async (c) => {
    const session = c.get("adminSession");
    await deleteAgentProfileById(deps.pool, deps.metrics, c.req.param("id"));
    deps.logger.info(
      {
        admin: session.username,
        action: "document.delete",
        target: c.req.param("id"),
        type: "agent-profile",
      },
      "Agent profile deleted",
    );
    return c.html(deletedDocRow().value);
  });

  app.delete("/documents/state/bulk", async (c) => {
    const body = await c.req.parseBody();
    const activityIri = String(body.activity_iri ?? "");
    const agentIfi = String(body.agent_ifi ?? "");
    const session = c.get("adminSession");

    if (!activityIri || !agentIfi) {
      return c.text("Activity IRI and Agent IFI are required", 400);
    }

    const count = await bulkDeleteStateDocuments(deps.pool, deps.metrics, activityIri, agentIfi);
    deps.logger.info(
      { admin: session.username, action: "document.bulkDelete", activityIri, agentIfi, count },
      "Bulk delete state documents",
    );
    return c.html(bulkDeleteResult(count).value);
  });

  // --------------------------------------------------------------------------
  // Live Stream
  // --------------------------------------------------------------------------
  app.get("/stream", (c) => {
    return renderPage(c, streamPage());
  });

  // SSE endpoint for admin stream page — session-authed, proxies pg_notify events
  app.get("/stream/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler = (payload: string) => {
        void (async () => {
          try {
            const event = await buildStatementEvent(deps.pool, deps.metrics, payload);
            if (!event) return;

            await stream.writeSSE({
              id: event.seq,
              event: "statement_stored",
              data: JSON.stringify(event),
            });
          } catch (err) {
            deps.logger.error(err, "Admin SSE: failed to fetch statement");
          }
        })();
      };

      deps.pgListener.on(XAPI_NOTIFY_CHANNEL, handler);

      stream.onAbort(() => {
        deps.pgListener.off(XAPI_NOTIFY_CHANNEL, handler);
      });

      // Heartbeat
      while (true) {
        await stream.write(":heartbeat\n\n");
        await stream.sleep(HEARTBEAT_INTERVAL_MS);
      }
    });
  });

  return app;
}
