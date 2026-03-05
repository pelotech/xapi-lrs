import { escapeHtml, formatDate, truncate } from './helpers.js';
import type { TenantOption } from './statements-list.js';
import { VALID_SCOPES } from '../../xapi/xapi-scopes.js';

export interface TokenRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  user_sub: string;
  scopes: string[];
  created_at: Date;
}

export interface CreatedToken {
  id: string;
  secret: string;
}

export function tokensPage(
  tokens: TokenRow[],
  search: string,
  tenants: TenantOption[],
  created?: CreatedToken,
): string {
  return `
    <h1>Tokens</h1>

    ${created ? createdFlash(created) : ''}

    <details>
      <summary>Create Token</summary>
      <form method="post" action="/admin/tokens"
            hx-post="/admin/tokens"
            hx-target="#tokens-page"
            hx-select="#tokens-page"
            hx-swap="outerHTML"
            style="margin-top:1rem">
        <div class="filter-form">
          <label>
            Tenant
            <select name="tenantId" required>
              <option value="">Select tenant…</option>
              ${tenants.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')}
            </select>
          </label>
          <label>
            User Sub
            <input type="text" name="userSub" placeholder="user@example.com" required>
          </label>
          <fieldset>
            <legend>Scopes</legend>
            ${VALID_SCOPES.map((s) => `
              <label>
                <input type="checkbox" name="scopes" value="${escapeHtml(s)}"${s === 'all' ? ' checked' : ''}>
                ${escapeHtml(s)}
              </label>`).join('')}
          </fieldset>
          <button type="submit">Create Token</button>
        </div>
      </form>
    </details>

    <div id="tokens-page">
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
            <th></th>
          </tr>
        </thead>
        <tbody id="tokens-body">
          ${tokens.map(tokenRow).join('')}
        </tbody>
      </table>
    </div>`;
}

export function tokensBody(tokens: TokenRow[]): string {
  return tokens.map(tokenRow).join('');
}

function createdFlash(created: CreatedToken): string {
  return `
    <div role="alert" style="padding:1rem;margin-bottom:1rem;border:2px solid green;border-radius:0.5rem;background:#f0fff0">
      <strong>Token created.</strong> Copy the secret now — it won't be shown again:<br>
      <code>ID: ${escapeHtml(created.id)}</code><br>
      <code>Secret: ${escapeHtml(created.secret)}</code>
    </div>`;
}

function tokenRow(t: TokenRow): string {
  return `
        <tr>
          <td><code title="${escapeHtml(t.id)}">${escapeHtml(truncate(t.id, 8))}</code></td>
          <td>${escapeHtml(t.tenant_name)}</td>
          <td>${escapeHtml(t.user_sub)}</td>
          <td>${escapeHtml(t.scopes.join(', '))}</td>
          <td>${formatDate(t.created_at)}</td>
          <td>
            <button hx-delete="/admin/tokens/${escapeHtml(t.id)}"
                    hx-confirm="Delete token ${escapeHtml(truncate(t.id, 8))}?"
                    hx-target="#tokens-page"
                    hx-select="#tokens-page"
                    hx-swap="outerHTML"
                    class="outline secondary"
                    style="padding:0.3rem 0.6rem;font-size:0.8rem">
              Delete
            </button>
          </td>
        </tr>`;
}
