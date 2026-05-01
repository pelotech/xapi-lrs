/**
 * Trusted client IP extraction.
 *
 * When behind a reverse proxy, X-Forwarded-For contains a chain of IPs:
 *   client, proxy1, proxy2
 *
 * The rightmost N entries (where N = trustedProxyHops) are trusted proxies.
 * The client IP is the entry just before the trusted proxies.
 *
 * Set TRUSTED_PROXY_HOPS=1 for a single reverse proxy (e.g., nginx, cloud LB).
 * Set TRUSTED_PROXY_HOPS=0 (default) to use the leftmost IP (legacy behavior).
 */

/**
 * Extract the client IP from a request, accounting for trusted proxy hops.
 *
 * @param xForwardedFor - value of the X-Forwarded-For header
 * @param trustedProxyHops - number of trusted proxy hops to skip from the right
 * @returns the resolved client IP, or "unknown"
 */
export function resolveClientIp(xForwardedFor: string | undefined, trustedProxyHops: number): string {
  if (!xForwardedFor) return 'unknown';

  const parts = xForwardedFor.split(',').map((s) => s.trim());
  if (parts.length === 0) return 'unknown';

  if (trustedProxyHops <= 0) {
    // Legacy: trust leftmost (least safe, but backwards-compatible)
    return parts[0] || 'unknown';
  }

  // Pick the entry just before the trusted proxy chain
  const clientIndex = parts.length - trustedProxyHops - 1;
  if (clientIndex < 0) {
    // Fewer entries than expected hops — use the leftmost as best-effort
    return parts[0] || 'unknown';
  }

  return parts[clientIndex] || 'unknown';
}
