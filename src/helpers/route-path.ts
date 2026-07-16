/**
 * Return the matched route pattern (e.g. `/xapi/statements/:statementId`).
 * Falls back to `c.req.path` for unmatched requests (404s, OPTIONS preflight, etc.)
 * where Hono's routePath getter is unavailable.
 */
export function safeRoutePath(c: { req: { routePath: string; path: string } }): string {
  try {
    return c.req.routePath || c.req.path;
  } catch {
    return c.req.path;
  }
}
