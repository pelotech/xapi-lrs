import { escapeHtml, formatDate } from './helpers.js';
import type { TenantOption } from './statements-list.js';

export interface ForwardTargetRow {
  tenant_id: string;
  tenant_name: string;
  url: string;
  auth_header: string;
  enabled: boolean;
  last_forwarded_stored: Date | null;
  last_error: string | null;
  error_count: number;
}

function statusBadge(row: ForwardTargetRow): string {
  if (!row.enabled) return '<span style="color:var(--pico-muted-color)">Disabled</span>';
  if (row.error_count > 0) {
    return `<span style="color:red" title="${escapeHtml(row.last_error ?? '')}">Error (${row.error_count})</span>`;
  }
  return '<span style="color:green">Healthy</span>';
}

export function forwardingPage(
  targets: ForwardTargetRow[],
  tenants: TenantOption[],
): string {
  return `
    <h1>Statement Forwarding</h1>

    <details>
      <summary>Add / Edit Forward Target</summary>
      <form method="post" action="/admin/forwarding" hx-post="/admin/forwarding" hx-target="#forwarding-table" hx-select="#forwarding-table" hx-swap="outerHTML" style="margin-top:1rem">
        <div class="filter-form">
          <label>
            Tenant
            <select name="tenantId" required>
              <option value="">Select tenant…</option>
              ${tenants.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')}
            </select>
          </label>
          <label>
            Target URL
            <input type="url" name="url" placeholder="https://upstream-lrs.example.com/xapi/statements" required>
          </label>
          <label>
            Authorization Header
            <input type="text" name="authHeader" placeholder="Basic dXNlcjpwYXNz">
          </label>
          <label>
            <input type="checkbox" name="enabled" value="true" checked>
            Enabled
          </label>
          <button type="submit">Save</button>
        </div>
      </form>
    </details>

    <table id="forwarding-table">
      <thead>
        <tr>
          <th>Tenant</th>
          <th>URL</th>
          <th>Enabled</th>
          <th>Last Forwarded</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${targets.length === 0 ? '<tr><td colspan="6">No forwarding targets configured.</td></tr>' : targets.map(forwardTargetRow).join('')}
      </tbody>
    </table>`;
}

function forwardTargetRow(row: ForwardTargetRow): string {
  return `
        <tr>
          <td>${escapeHtml(row.tenant_name)}</td>
          <td><code>${escapeHtml(row.url)}</code></td>
          <td>${row.enabled ? 'Yes' : 'No'}</td>
          <td>${row.last_forwarded_stored ? formatDate(row.last_forwarded_stored) : '—'}</td>
          <td>${statusBadge(row)}</td>
          <td>
            <button hx-delete="/admin/forwarding/${escapeHtml(row.tenant_id)}"
                    hx-confirm="Remove forwarding for ${escapeHtml(row.tenant_name)}?"
                    hx-target="#forwarding-table"
                    hx-select="#forwarding-table"
                    hx-swap="outerHTML"
                    class="outline secondary"
                    style="padding:0.3rem 0.6rem;font-size:0.8rem">
              Delete
            </button>
          </td>
        </tr>`;
}
