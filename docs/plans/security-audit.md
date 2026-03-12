# Security Audit — xAPI LRS

**Date:** 2026-03-11
**Branch:** `feat/lrs` (commit `bb72c65`)
**Status:** All findings unaddressed

---

## Critical (3)

### C1: `statements/read/mine` scope not enforced

- `src/middleware/authorization.ts:39` — scope list includes `statements/read/mine`
- `src/routes/statements.ts:249-396` — GET `/statements` handler never filters by authenticated agent
- `src/repositories/statements.ts:464-599` — `queryStatements()` has no auth parameter

**Issue:** Authorization middleware accepts `statements/read/mine` as a valid scope, but the
statements query path never restricts results to statements where the authenticated agent is the
actor. A credential with only `statements/read/mine` can read ALL statements.

**Fix:** In the GET statements handler, detect when the credential has `statements/read/mine` but
NOT `statements/read` or `all/read` or `all`. In that case, inject the authenticated agent as a
mandatory filter on the query.

---

### C2: JWT defaults to `all` scope

- `src/auth/jwt.ts:73` — `const JWT_DEFAULT_SCOPES: XapiScope[] = ["all"]`
- `src/auth/jwt.ts:125` — `const scopes = extractScopes(payload) ?? JWT_DEFAULT_SCOPES`
- `src/auth/jwt.ts:80-98` — `extractScopes()` returns `null` when no scope claim present

**Issue:** When a JWT has no `scope` or `scopes` claim, the LRS defaults to granting `all` scope
(unrestricted access). Any OIDC-issued token without explicit scopes gets full admin-level access.

**Fix:** Default to an empty or minimal scope set (e.g. `[]`), or reject JWTs that lack a scope
claim entirely.

---

### C3: Plaintext API credentials

- `src/admin/repositories.ts:212` — `INSERT INTO lrs_credential ... VALUES (... $2 ...)` stores `secret_key` as plaintext
- `src/admin/repositories.ts:222` — `UPDATE lrs_credential SET secret_key = $1` rotation also plaintext
- `src/middleware/authentication.ts:70-75` — `WHERE c.api_key = $1 AND c.secret_key = $2` plaintext comparison
- `db/migrations/committed/000001-lrsql-schema.sql:62` — `secret_key text NOT NULL`

**Issue:** API credential secrets are stored and compared as plaintext. If the database is
compromised (SQL injection, backup leak, replica access), all API credentials are immediately
exposed. Admin passwords are correctly bcrypt-hashed in the same schema.

**Fix:** Hash `secret_key` with bcrypt (or similar) on creation/rotation. Compare using
`crypt(input, stored_hash)` in the SQL query, mirroring the admin password pattern.

---

## High (6)

### H1: CSRF timing attack

- `src/admin/middleware.ts:140` — `if (headerToken === token)` uses `===`
- `src/admin/middleware.ts:32` — `timingSafeEqual` is imported but not used here

**Issue:** String equality comparison for CSRF tokens leaks timing information, allowing an
attacker to brute-force the token one character at a time.

**Fix:** Replace `===` with `timingSafeEqual(Buffer.from(headerToken), Buffer.from(token))`.

---

### H2: httpOnly CSRF cookie breaks double-submit pattern

- `src/admin/middleware.ts:82-88` — CSRF cookie set with `httpOnly: true`

**Issue:** The double-submit CSRF pattern requires JavaScript to read the CSRF cookie value and
include it in a request header. `httpOnly: true` prevents JS from reading the cookie, breaking
the pattern. The CSRF token must be delivered via a non-httpOnly cookie or embedded in HTML.

**Fix:** Set `httpOnly: false` on the CSRF cookie (it's a random token, not a secret that needs
httpOnly protection — the security comes from the Same-Origin Policy preventing cross-site reads).

---

### H3: Spoofable X-Forwarded-For for admin login rate limiting

- `src/admin/index.ts:182` — `c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"`
- `src/admin/index.ts:81-103` — `LoginRateLimiter` keyed on unsanitized IP

**Issue:** An attacker can set arbitrary X-Forwarded-For values to bypass per-IP login rate
limiting, enabling brute-force attacks.

**Fix:** Use `c.req.header("x-real-ip")` or configure Hono's trusted proxy support. In production
behind a reverse proxy, trust only the last proxy-appended value.

---

### H4: Spoofable X-Forwarded-For for SSE per-IP rate limiting

- `src/sse/sse-producer.ts:36` — `c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"`
- `src/sse/sse-producer.ts:37-43` — per-IP connection limit uses unsanitized header

**Issue:** Same X-Forwarded-For spoofing vulnerability as H3, applied to SSE connection limits.

**Fix:** Same as H3 — use trusted proxy IP resolution.

---

### H5: No rate limiting on xAPI API endpoints

- `src/app.ts:57-414` — no rate limiting middleware on `/xapi/*` routes
- Rate limiting only exists on admin login (`src/admin/index.ts:81-103`) and SSE (`src/sse/sse-producer.ts:32-33`)

**Issue:** xAPI statement submission and query endpoints have no rate limiting. An attacker can
flood the LRS with requests, causing resource exhaustion.

**Fix:** Add configurable rate limiting middleware to `/xapi/*` routes (per-IP or per-credential).

---

### H6: OpenAPI endpoint exposed without authentication

- `src/app.ts:389-398` — `/xapi/openapi.json` registered as a route
- `src/app.ts:342-347` — auth middleware skips `/xapi/about` but not openapi

**Issue:** The OpenAPI spec is accessible to any authenticated user, disclosing the full API
surface including internal endpoints. Note: auth is still required (only `/about` is exempted),
but any valid credential can access it.

**Fix:** Either gate behind admin-only auth, or accept the risk since authenticated access is
required. Consider removing in production builds.

---

## Medium (8)

### M1: CORS wildcard default

- `src/config.ts:46` — `corsOrigin: z.string().default("*")`
- `src/app.ts:144-145` — `cors({ origin: deps.config.corsOrigin })`

**Issue:** Default CORS origin is `*`, allowing any website to make credentialed requests.

**Fix:** Default to empty/restrictive origin; require explicit configuration in production.

---

### M2: No password complexity requirements

- `src/admin/views/accounts.ts:28` — `minlength="4"` on password input
- `src/admin/index.ts:275` — server-side validation only checks max length

**Issue:** Admin passwords have a 4-character minimum with no complexity requirements.

**Fix:** Enforce minimum 8+ characters with complexity rules, or use a password strength estimator.

---

### M3: No server-side session revocation

- `src/admin/middleware.ts:59-70` — `parseSession()` only checks HMAC and expiration
- `src/admin/index.ts:218-225` — logout only clears the cookie client-side

**Issue:** Once a session cookie is issued, it cannot be revoked server-side. Stolen cookies remain
valid until expiration.

**Fix:** Add a server-side session store (database or in-memory) with revocation on logout.

---

### M4: Unbounded rate limiter memory

- `src/admin/index.ts:81-103` — `LoginRateLimiter.attempts = new Map<string, number[]>()`

**Issue:** The rate limiter Map grows without bound. Each unique IP adds an entry that is never
removed even when its timestamps expire.

**Fix:** Prune empty entries after filtering, or use a TTL-based cache (e.g. periodic sweep).

---

### M5: Body size limit bypass via chunked encoding

- `src/app.ts:273-282` — size check reads `Content-Length` header only
- `src/app.ts:305` — `Buffer.from(await c.req.arrayBuffer())` reads full body regardless

**Issue:** Chunked transfer encoding omits `Content-Length`, bypassing the size check. The body is
still fully read into memory.

**Fix:** Check the actual body size after reading, or use a streaming size limiter.

---

### M6: Content-Disposition header injection

- `src/admin/index.ts:503` — `` `attachment; filename="${sha}"` ``

**Issue:** If the SHA value is somehow controllable, CRLF characters could inject additional
headers. Low likelihood since SHA is hex, but worth sanitizing.

**Fix:** Sanitize the filename or use a fixed format that can't contain special characters.

---

### M7: Signature verification disabled by default

- `src/config.ts:53-55` — `xapiVerifySignatures` defaults to `false`
- `src/xapi/signature.ts:124-131` — verification skipped when disabled

**Issue:** xAPI signed statement verification is off by default. Signed statements are accepted
without verifying the JWS signature.

**Fix:** Document the setting prominently. Consider defaulting to `true` in production.

---

### M8: Unauthenticated metrics endpoint — DOCUMENTED / WONTFIX

- `src/server.ts:111-114` — `/metrics` on admin port with no auth

**Issue:** Prometheus metrics are exposed without authentication on the admin port. Internal
system details (request counts, latencies, error rates) are visible to anyone who can reach the
admin port.

**Resolution:** The admin port relies on network-level access control (firewall, network policy,
internal-only binding). A comment has been added to `src/server.ts` documenting this requirement.

---

## Low (6)

### L1: Account IFI parsing ambiguity

- `src/helpers/agent.ts:29-45` — IFI extraction and formatting

**Issue:** Agent account IFI formatted as `account::name@homePage` could be ambiguous if the
account name contains `@` or `::`.

---

### L2: Alternate request syntax auth header override

- `src/app.ts:32-39` — `ALTERNATE_HEADER_FIELDS` includes `"Authorization"`
- `src/app.ts:200-205` — form body values override request headers

**Issue:** xAPI alternate request syntax allows the Authorization header to be overridden via a
form field. This is per-spec (xAPI 1.0.3 section 1.3) but could be surprising.

---

### L3: Attachment content type XSS

- `src/xapi/multipart.ts:128` — content type taken from attachment headers without sanitization

**Issue:** Attachment content types are stored as-is. If served back with `text/html`, could
enable stored XSS.

---

### L4: Missing admin security headers

- `src/app.ts:120-127` — security headers only on `/xapi/*`
- `src/admin/index.ts` — no CSP, Referrer-Policy, or X-Permitted-Cross-Domain-Policies

**Issue:** Admin UI HTML pages lack Content-Security-Policy and other hardening headers.

---

### L5: Admin SSE no per-IP connection limits — FIXED

- `src/admin/index.ts` — added per-IP connection tracking (max 3) with 429 rejection

---

### L6: SHA-1 ETags

- `src/helpers/etag.ts:10` — `createHash("sha1")`

**Issue:** ETags use SHA-1 which is cryptographically weak. Acceptable for document versioning
(not a security boundary) and may be required by xAPI conformance tests.

---

## Summary

| Severity  | Count  | Status      |
| --------- | ------ | ----------- |
| Critical  | 3      | Not started |
| High      | 6      | Not started |
| Medium    | 8      | Not started |
| Low       | 6      | Not started |
| **Total** | **23** |             |
