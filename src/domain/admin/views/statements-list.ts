import { escapeHtml, formatDate, truncate } from './helpers.js';

export interface StatementRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  verb_id: string;
  actor_ifi: string | null;
  activity_id: string | null;
  timestamp: Date;
  stored: Date;
}

export interface StatementsFilter {
  tenantId?: string;
  verbId?: string;
  actorIfi?: string;
  activityId?: string;
  since?: string;
  limit: number;
  offset: number;
}

export interface TenantOption {
  id: string;
  name: string;
}

export function statementsPage(
  statements: StatementRow[],
  filters: StatementsFilter,
  tenants: TenantOption[],
  total: number,
): string {
  const page = Math.floor(filters.offset / filters.limit) + 1;
  const totalPages = Math.ceil(total / filters.limit) || 1;

  return `
    <h1>Statements</h1>
    <form class="filter-form"
          hx-get="/admin/statements"
          hx-target="#statements-content"
          hx-select="#statements-content"
          hx-push-url="true">
      <label>
        Tenant
        <select name="tenantId">
          <option value="">All</option>
          ${tenants.map((t) => `<option value="${escapeHtml(t.id)}"${filters.tenantId === t.id ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
        </select>
      </label>
      <label>
        Verb
        <input type="text" name="verbId" value="${escapeHtml(filters.verbId ?? '')}" placeholder="e.g. http://adlnet.gov/...">
      </label>
      <label>
        Actor IFI
        <input type="text" name="actorIfi" value="${escapeHtml(filters.actorIfi ?? '')}" placeholder="mbox::mailto:...">
      </label>
      <label>
        Activity
        <input type="text" name="activityId" value="${escapeHtml(filters.activityId ?? '')}" placeholder="Activity IRI">
      </label>
      <label>
        Since
        <input type="datetime-local" name="since" value="${escapeHtml(filters.since ?? '')}">
      </label>
      <button type="submit">Filter</button>
    </form>
    <div id="statements-content">
      <p>${total} statement${total === 1 ? '' : 's'} found. Page ${page} of ${totalPages}.</p>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Tenant</th>
            <th>Verb</th>
            <th>Actor</th>
            <th>Activity</th>
            <th>Timestamp</th>
            <th>Stored</th>
          </tr>
        </thead>
        <tbody>
          ${statements.map(statementRow).join('')}
        </tbody>
      </table>
      <div style="display:flex;gap:1rem;justify-content:center">
        ${filters.offset > 0 ? `<a href="/admin/statements?${paginationQs(filters, filters.offset - filters.limit)}" hx-boost="true">Previous</a>` : ''}
        ${filters.offset + filters.limit < total ? `<a href="/admin/statements?${paginationQs(filters, filters.offset + filters.limit)}" hx-boost="true">Next</a>` : ''}
      </div>
    </div>`;
}

function paginationQs(f: StatementsFilter, offset: number): string {
  const params = new URLSearchParams();
  if (f.tenantId) params.set('tenantId', f.tenantId);
  if (f.verbId) params.set('verbId', f.verbId);
  if (f.actorIfi) params.set('actorIfi', f.actorIfi);
  if (f.activityId) params.set('activityId', f.activityId);
  if (f.since) params.set('since', f.since);
  params.set('limit', String(f.limit));
  params.set('offset', String(Math.max(0, offset)));
  return params.toString();
}

function statementRow(s: StatementRow): string {
  return `
          <tr>
            <td>
              <a href="#"
                 hx-get="/admin/statements/${escapeHtml(s.id)}"
                 hx-target="#detail-${escapeHtml(s.id)}"
                 hx-swap="innerHTML"
                 style="cursor:pointer">
                <code title="${escapeHtml(s.id)}">${escapeHtml(truncate(s.id, 8))}</code>
              </a>
            </td>
            <td>${escapeHtml(s.tenant_name)}</td>
            <td>${escapeHtml(truncate(s.verb_id, 40))}</td>
            <td>${s.actor_ifi ? escapeHtml(truncate(s.actor_ifi, 30)) : '<em>anon</em>'}</td>
            <td>${s.activity_id ? escapeHtml(truncate(s.activity_id, 40)) : ''}</td>
            <td>${formatDate(s.timestamp)}</td>
            <td>${formatDate(s.stored)}</td>
          </tr>
          <tr id="detail-${escapeHtml(s.id)}"></tr>`;
}

export function statementDetail(raw: unknown): string {
  return `
    <td colspan="7" class="json-detail">
      <pre><code>${escapeHtml(JSON.stringify(raw, null, 2))}</code></pre>
    </td>`;
}
