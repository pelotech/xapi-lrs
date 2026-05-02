/**
 * Admin UI layout — HTML shell with nav, Pico CSS, and htmx.
 */

import { html, raw } from './html.ts';
import type { RawHtml } from './html.ts';

const CSS = /* css */ `
nav ul li a[aria-current="page"] { font-weight: bold; text-decoration: underline; }
.badge { display: inline-block; padding: 0.15em 0.5em; border-radius: 4px; font-size: 0.8em; }
.badge-voided { background: var(--pico-del-color); color: white; }
.badge-scope { background: var(--pico-primary-background); color: var(--pico-primary-inverse); margin: 0.1em; }
.mono { font-family: var(--pico-font-family-monospace, monospace); font-size: 0.85em; }
.text-muted { color: var(--pico-muted-color); }
.secret-display { background: var(--pico-code-background-color); padding: 0.5em; border-radius: 4px; word-break: break-all; }
tr.voided td { text-decoration: line-through; opacity: 0.7; }
.stat-card { text-align: center; }
.stat-card h3 { margin-bottom: 0; }
.stat-card p { margin-top: 0.25em; color: var(--pico-muted-color); }
.stream-card { border: 1px solid var(--pico-muted-border-color); border-radius: 8px; padding: 1em; margin-bottom: 0.5em; }
pre.json { background: var(--pico-code-background-color); padding: 1em; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
.metric-group { margin-bottom: 1.5em; }
.metric-group h4 { margin-bottom: 0.5em; border-bottom: 1px solid var(--pico-muted-border-color); padding-bottom: 0.25em; }
.tabs [role="tab"] { cursor: pointer; padding: 0.5em 1em; border: none; background: none; border-bottom: 2px solid transparent; --pico-color: inherit; --pico-background-color: transparent; --pico-border-color: transparent; }
.tabs [role="tab"][aria-selected="true"] { border-bottom-color: var(--pico-primary); color: var(--pico-primary); font-weight: bold; }
`;

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/accounts', label: 'Accounts' },
  { href: '/admin/credentials', label: 'Credentials' },
  { href: '/admin/statements', label: 'Statements' },
  { href: '/admin/documents', label: 'Documents' },
  { href: '/admin/stream', label: 'Stream' },
  { href: '/admin/metrics', label: 'Metrics' },
];

function isActive(linkHref: string, currentPath: string): boolean {
  if (linkHref === '/admin') return currentPath === '/admin' || currentPath === '/admin/';
  return currentPath.startsWith(linkHref);
}

export function layout(
  opts: { title: string; path?: string; username?: string; csrfToken?: string },
  content: RawHtml,
): RawHtml {
  const csrfJson = opts.csrfToken ? JSON.stringify({ 'X-CSRF-Token': opts.csrfToken }) : '';

  return html`<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title} — LRS Admin</title>
  <link rel="stylesheet" href="/admin/assets/pico.min.css">
  <script src="/admin/assets/htmx.min.js"></script>
  <script src="/admin/assets/sse.js"></script>
  <style>${raw(CSS)}</style>
</head>
<body${opts.csrfToken ? raw(` hx-headers='${csrfJson}'`) : false}>
  ${
    opts.username
      ? html`
          <header>
            <nav>
              <ul>
                <li><strong>LRS Admin</strong></li>
              </ul>
              <ul>
                ${NAV_LINKS.map(
                  (link) => html`
                    <li>
                      <a
                        href="${link.href}"
                        ${opts.path && isActive(link.href, opts.path) ? raw(' aria-current="page"') : false}
                      >
                        ${link.label}
                      </a>
                    </li>
                  `,
                )}
              </ul>
              <ul>
                <li class="text-muted">${opts.username}</li>
                <li>
                  <form method="post" action="/admin/logout" style="margin:0">
                    <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ''}" />
                    <button type="submit" class="outline secondary" style="padding:0.25em 0.75em;margin:0">
                      Logout
                    </button>
                  </form>
                </li>
              </ul>
            </nav>
          </header>
        `
      : false
  }
  <main>${content}</main>
</body>
</html>`;
}
