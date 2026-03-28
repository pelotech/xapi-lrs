# Security Audit — xAPI LRS

**Date:** 2026-03-11
**Branch:** `feat/lrs` (commit `bb72c65`)
**Status:** 21 of 23 findings addressed; 2 blocked by schema freeze (C3, L1)

---

## Critical (3)

### C1: `statements/read/mine` scope not enforced — FIXED

- GET `/statements` handler now injects the authenticated agent as a mandatory filter when the
  credential has only `statements/read/mine` scope
- SSE stream also filters events to the authenticated agent's statements

---

### C2: JWT defaults to `all` scope — FIXED

- JWTs without a `scope` or `scopes` claim are now rejected with an error

---

### C3: Plaintext API credentials — BLOCKED (schema frozen)

**Issue:** API credential secrets are stored and compared as plaintext.

**Fix requires:** DB migration to hash existing `secret_key` values and update queries to use
`crypt()`. Blocked until schema freeze is lifted.

---

## High (6)

### H1: CSRF timing attack — FIXED

- CSRF token comparison now uses `timingSafeEqual`

---

### H2: httpOnly CSRF cookie breaks double-submit pattern — FIXED

- CSRF cookie now sets `httpOnly: false` so JS can read the token for the double-submit pattern

---

### H3: Spoofable X-Forwarded-For for admin login rate limiting — FIXED

- Now uses `resolveClientIp()` with configurable `TRUSTED_PROXY_HOPS`

---

### H4: Spoofable X-Forwarded-For for SSE per-IP rate limiting — FIXED

- Now uses `resolveClientIp()` with configurable `TRUSTED_PROXY_HOPS`

---

### H5: No rate limiting on xAPI API endpoints — FIXED

- Added per-credential/per-IP sliding window rate limiter on `/xapi/*` routes
- Configurable via `XAPI_RATE_LIMIT_WINDOW` and `XAPI_RATE_LIMIT_MAX`

---

### H6: OpenAPI endpoint exposed without authentication — FIXED

- `/xapi/openapi.json` route removed; spec only available in admin UI

---

## Medium (8)

### M1: CORS wildcard default — FIXED

- `CORS_ORIGIN=*` now throws at startup in production; must be explicitly configured
- `CORS_ENABLED=false` available when CORS is handled by a reverse proxy

---

### M2: No password complexity requirements — FIXED

- Enforced 12-character minimum server-side and client-side (no complexity rules to allow passphrases)

---

### M3: No server-side session revocation — MITIGATED

- Sessions now expire after 15 minutes (sliding window with renewal on each request)
- Limits exposure window for stolen cookies without requiring server-side session store

---

### M4: Unbounded rate limiter memory — FIXED

- `LoginRateLimiter` now prunes stale keys every 5 minutes via `setInterval`
- Empty entries removed immediately after filtering

---

### M5: Body size limit bypass via chunked encoding — FIXED

- Added post-read body size check on actual buffer length, enforced regardless of `Content-Length`

---

### M6: Content-Disposition header injection — FIXED

- Filename sanitized to hex characters only via `sha.replace(/[^a-fA-F0-9]/g, "")`

---

### M7: Signature verification disabled by default — FIXED

- Default flipped to `true`; console warning emitted when explicitly disabled

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

### L1: Account IFI parsing ambiguity — BLOCKED (schema frozen)

**Issue:** Agent account IFI formatted as `account::name@homePage` could be ambiguous if the
account name contains `@` or `::`. Fix requires migration to update stored IFI values.

---

### L2: Alternate request syntax auth header override — DOCUMENTED

- Per xAPI spec (section 1.3); security note added in `src/app.ts`

---

### L3: Attachment content type XSS — FIXED

- Dangerous content types (`text/html`, `image/svg+xml`, etc.) replaced with `application/octet-stream`

---

### L4: Missing admin security headers — FIXED

- Added CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy to admin routes

---

### L5: Admin SSE no per-IP connection limits — FIXED

- `src/admin/index.ts` — added per-IP connection tracking (max 3) with 429 rejection

---

### L6: SHA-1 ETags — DOCUMENTED

- SHA-1 is acceptable for ETag versioning (not a security boundary); comment added to source

---

## Summary

| Severity  | Count  | Fixed  | Mitigated | Documented | Blocked |
| --------- | ------ | ------ | --------- | ---------- | ------- |
| Critical  | 3      | 2      |           |            | 1 (C3)  |
| High      | 6      | 6      |           |            |         |
| Medium    | 8      | 5      | 1 (M3)    | 1 (M8)     |         |
| Low       | 6      | 3      |           | 2 (L2,L6)  | 1 (L1)  |
| **Total** | **23** | **16** | **1**     | **3**      | **2**   |
