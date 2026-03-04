import type { Request } from 'express';

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]!);
}

export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

/**
 * If the request is an htmx request, return the fragment only.
 * Otherwise, wrap the fragment in the full page layout.
 */
export function render(
  req: Request,
  fragment: string,
  layout: (content: string) => string,
): string {
  if (req.headers['hx-request']) {
    return fragment;
  }
  return layout(fragment);
}
