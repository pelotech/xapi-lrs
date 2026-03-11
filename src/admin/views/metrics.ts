/**
 * Admin metrics page — human-readable Prometheus metrics display.
 */

import { html } from './html.ts';
import type { RawHtml } from './html.ts';

interface MetricEntry {
  name: string;
  help: string;
  type: string;
  values: Array<{ labels: string; value: string }>;
}

function parsePrometheus(text: string): MetricEntry[] {
  const entries: MetricEntry[] = [];
  let current: MetricEntry | null = null;

  for (const line of text.split('\n')) {
    if (line.startsWith('# HELP ')) {
      const rest = line.slice(7);
      const space = rest.indexOf(' ');
      current = { name: rest.slice(0, space), help: rest.slice(space + 1), type: '', values: [] };
      entries.push(current);
    } else if (line.startsWith('# TYPE ') && current) {
      const rest = line.slice(7);
      current.type = rest.slice(rest.indexOf(' ') + 1);
    } else if (line && !line.startsWith('#') && current) {
      const braceOpen = line.indexOf('{');
      if (braceOpen !== -1) {
        const braceClose = line.indexOf('}');
        current.values.push({ labels: line.slice(braceOpen + 1, braceClose), value: line.slice(braceClose + 2) });
      } else {
        const space = line.lastIndexOf(' ');
        if (space !== -1) current.values.push({ labels: '', value: line.slice(space + 1) });
      }
    }
  }
  return entries;
}

const GROUPS: Record<string, string[]> = {
  'HTTP Requests': ['lrs_http_request_duration_seconds'],
  'xAPI Operations': ['lrs_xapi_statements_received_total', 'lrs_xapi_statements_stored_total', 'lrs_xapi_statement_validation_errors_total', 'lrs_xapi_document_operations_total'],
  'Database': ['lrs_db_query_duration_seconds'],
  'SSE Streaming': ['lrs_sse_clients_connected', 'lrs_sse_events_emitted_total'],
  'Authentication': ['lrs_auth_failures_total'],
};

function groupMetrics(entries: MetricEntry[]): Array<{ group: string; metrics: MetricEntry[] }> {
  const result: Array<{ group: string; metrics: MetricEntry[] }> = [];
  const used = new Set<string>();
  for (const [group, names] of Object.entries(GROUPS)) {
    const matched = entries.filter((e) => names.some((n) => e.name.startsWith(n)));
    if (matched.length > 0) {
      result.push({ group, metrics: matched });
      matched.forEach((m) => used.add(m.name));
    }
  }
  const other = entries.filter((e) => !used.has(e.name));
  if (other.length > 0) result.push({ group: 'Other', metrics: other });
  return result;
}

export function metricsPage(rawMetrics: string): RawHtml {
  const groups = groupMetrics(parsePrometheus(rawMetrics));

  return html`
    <hgroup>
      <h2>Metrics</h2>
      <p><a href="/admin/metrics/raw">Raw Prometheus text</a></p>
    </hgroup>
    ${groups.map(({ group, metrics }) => html`
      <div class="metric-group">
        <h4>${group}</h4>
        ${metrics.map((m) => html`
          <details>
            <summary>
              <strong>${m.name}</strong> <small class="text-muted">(${m.type})</small>
              — <span class="text-muted">${m.help}</span>
            </summary>
            ${m.values.length > 0
              ? html`<figure><table>
                  <thead><tr><th>Labels</th><th>Value</th></tr></thead>
                  <tbody>${m.values.map((v) => html`
                    <tr><td class="mono">${v.labels || '(none)'}</td><td class="mono">${v.value}</td></tr>`)}
                  </tbody>
                </table></figure>`
              : html`<p class="text-muted">No values recorded.</p>`}
          </details>`)}
      </div>`)}
  `;
}
