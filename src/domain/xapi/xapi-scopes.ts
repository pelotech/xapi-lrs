/**
 * xAPI 1.0.3 OAuth scope enforcement.
 *
 * The xAPI spec (§6.4) defines 8 scopes that control what operations a
 * credential can perform. Since TSOA's OpenAPI `http` security scheme type
 * does not support scopes (always passes []), we derive the required scope
 * from the request method + path using a static routing table.
 */

export type XapiScope =
  | 'all'
  | 'all/read'
  | 'statements/write'
  | 'statements/read'
  | 'statements/read/mine'
  | 'state'
  | 'define'
  | 'profile';

export const VALID_SCOPES: readonly XapiScope[] = [
  'all',
  'all/read',
  'statements/write',
  'statements/read',
  'statements/read/mine',
  'state',
  'define',
  'profile',
];

// ---------------------------------------------------------------------------
// Routing table: (method, path) → required specific scopes
// ---------------------------------------------------------------------------

interface ScopeRoute {
  method: string;
  path: string;
  scopes: XapiScope[];
}

/**
 * Each entry lists the **specific** scopes that grant access to a route.
 * `all` and `all/read` (for reads) are handled implicitly in `checkScope`.
 * HEAD is normalized to GET before lookup.
 */
const REQUIRED_SCOPES: readonly ScopeRoute[] = [
  // Statements
  { method: 'GET',    path: '/xapi/statements', scopes: ['statements/read', 'statements/read/mine'] },
  { method: 'PUT',    path: '/xapi/statements', scopes: ['statements/write'] },
  { method: 'POST',   path: '/xapi/statements', scopes: ['statements/write'] },
  // State
  { method: 'GET',    path: '/xapi/activities/state', scopes: ['state'] },
  { method: 'PUT',    path: '/xapi/activities/state', scopes: ['state'] },
  { method: 'POST',   path: '/xapi/activities/state', scopes: ['state'] },
  { method: 'DELETE', path: '/xapi/activities/state', scopes: ['state'] },
  // Activity Profile
  { method: 'GET',    path: '/xapi/activities/profile', scopes: ['define'] },
  { method: 'PUT',    path: '/xapi/activities/profile', scopes: ['define'] },
  { method: 'POST',   path: '/xapi/activities/profile', scopes: ['define'] },
  { method: 'DELETE', path: '/xapi/activities/profile', scopes: ['define'] },
  // Activities
  { method: 'GET',    path: '/xapi/activities', scopes: ['define'] },
  // Agent Profile
  { method: 'GET',    path: '/xapi/agents/profile', scopes: ['profile'] },
  { method: 'PUT',    path: '/xapi/agents/profile', scopes: ['profile'] },
  { method: 'POST',   path: '/xapi/agents/profile', scopes: ['profile'] },
  { method: 'DELETE', path: '/xapi/agents/profile', scopes: ['profile'] },
  // Agents
  { method: 'GET',    path: '/xapi/agents', scopes: ['profile'] },
];

// Build a lookup map for O(1) access: "METHOD /path" → ScopeRoute
const scopeMap = new Map<string, ScopeRoute>();
for (const route of REQUIRED_SCOPES) {
  scopeMap.set(`${route.method} ${route.path}`, route);
}

// ---------------------------------------------------------------------------
// checkScope
// ---------------------------------------------------------------------------

export interface ScopeCheckResult {
  allowed: boolean;
  readMineOnly: boolean;
}

/**
 * Check whether the granted scopes allow a request to proceed.
 *
 * @param grantedScopes - scopes associated with the credential
 * @param method - HTTP method (GET, POST, PUT, DELETE, HEAD)
 * @param path - request path (e.g. /xapi/statements)
 * @returns whether the request is allowed and whether read/mine filtering applies
 */
export function checkScope(
  grantedScopes: readonly string[],
  method: string,
  path: string,
): ScopeCheckResult {
  // 1. Normalize HEAD → GET
  const normalizedMethod = method === 'HEAD' ? 'GET' : method;

  // 2. `all` grants unrestricted access
  if (grantedScopes.includes('all')) {
    return { allowed: true, readMineOnly: false };
  }

  // 3. `all/read` grants any read (GET/HEAD)
  if (normalizedMethod === 'GET' && grantedScopes.includes('all/read')) {
    return { allowed: true, readMineOnly: false };
  }

  // 4. Look up the route
  const route = scopeMap.get(`${normalizedMethod} ${path}`);

  // 5. No match → passthrough (non-xAPI routes, /xapi/about handled by @NoSecurity)
  if (!route) {
    return { allowed: true, readMineOnly: false };
  }

  // 6. Check if any of the route's required scopes are granted
  const matchingScopes = route.scopes.filter((s) => grantedScopes.includes(s));
  if (matchingScopes.length === 0) {
    return { allowed: false, readMineOnly: false };
  }

  // 7. Special case: statements/read/mine is the only matching scope
  const readMineOnly =
    matchingScopes.length === 1 && matchingScopes[0] === 'statements/read/mine';

  return { allowed: true, readMineOnly };
}

// ---------------------------------------------------------------------------
// hasDefineScope
// ---------------------------------------------------------------------------

/**
 * Returns true if the credential has permission to merge Activity definitions
 * into the canonical Activity store. Per xAPI spec, this requires the `define`
 * scope (or `all` which implies everything).
 */
export function hasDefineScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes('all') || grantedScopes.includes('define');
}
