import { escapeHtml } from './helpers.js';

export interface DashboardStats {
  tenantCount: number;
  tokenCount: number;
  statementCount: number;
  documentCount: number;
}

export function dashboardPage(stats: DashboardStats): string {
  return `
    <h1>Dashboard</h1>
    <div class="stats-grid">
      <div class="stat-card">
        <h3>${escapeHtml(String(stats.tenantCount))}</h3>
        <p>Tenants</p>
      </div>
      <div class="stat-card">
        <h3>${escapeHtml(String(stats.tokenCount))}</h3>
        <p>Tokens</p>
      </div>
      <div class="stat-card">
        <h3>${escapeHtml(String(stats.statementCount))}</h3>
        <p>Statements</p>
      </div>
      <div class="stat-card">
        <h3>${escapeHtml(String(stats.documentCount))}</h3>
        <p>Documents</p>
      </div>
    </div>`;
}
