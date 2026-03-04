import { escapeHtml, formatDate } from './helpers.js';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: Date;
  token_count: number;
  statement_count: number;
}

export function tenantsPage(tenants: TenantRow[]): string {
  return `
    <h1>Tenants</h1>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Slug</th>
          <th>Active</th>
          <th>Tokens</th>
          <th>Statements</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        ${tenants.map(tenantRow).join('')}
      </tbody>
    </table>`;
}

function tenantRow(t: TenantRow): string {
  return `
        <tr>
          <td>${escapeHtml(t.name)}</td>
          <td><code>${escapeHtml(t.slug)}</code></td>
          <td>${t.is_active ? 'Yes' : 'No'}</td>
          <td>${t.token_count}</td>
          <td>${t.statement_count}</td>
          <td>${formatDate(t.created_at)}</td>
        </tr>`;
}
