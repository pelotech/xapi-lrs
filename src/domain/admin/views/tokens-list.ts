import { escapeHtml, formatDate, truncate } from './helpers.js';

export interface TokenRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  user_sub: string;
  scopes: string[];
  created_at: Date;
}

export function tokensPage(tokens: TokenRow[], search: string): string {
  return `
    <h1>Tokens</h1>
    <input type="search"
           name="search"
           placeholder="Search by user, tenant..."
           value="${escapeHtml(search)}"
           hx-get="/admin/tokens"
           hx-trigger="input changed delay:300ms"
           hx-target="#tokens-body"
           hx-select="#tokens-body"
           hx-push-url="true">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Tenant</th>
          <th>User</th>
          <th>Scopes</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody id="tokens-body">
        ${tokens.map(tokenRow).join('')}
      </tbody>
    </table>`;
}

export function tokensBody(tokens: TokenRow[]): string {
  return tokens.map(tokenRow).join('');
}

function tokenRow(t: TokenRow): string {
  return `
        <tr>
          <td><code title="${escapeHtml(t.id)}">${escapeHtml(truncate(t.id, 8))}</code></td>
          <td>${escapeHtml(t.tenant_name)}</td>
          <td>${escapeHtml(t.user_sub)}</td>
          <td>${escapeHtml(t.scopes.join(', '))}</td>
          <td>${formatDate(t.created_at)}</td>
        </tr>`;
}
