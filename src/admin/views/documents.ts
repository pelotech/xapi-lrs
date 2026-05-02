/**
 * Admin document browser — tabbed view for state, activity profile, agent profile.
 */

import type {
  StateDocumentListRow,
  ActivityProfileListRow,
  AgentProfileListRow,
  DocumentDetail,
} from '../repositories/index.ts';
import { html, raw } from './html.ts';
import type { RawHtml } from './html.ts';

type DocType = 'state' | 'activity-profile' | 'agent-profile';

function fmtTime(d: Date): string {
  return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
}

// ============================================================================
// Document browser (full page)
// ============================================================================

export function documentsPage(activeTab: DocType = 'state'): RawHtml {
  return html`
    <h2>Document Browser</h2>

    <div
      class="tabs"
      role="tablist"
      hx-on::after-request="this.querySelectorAll('[role=tab]').forEach(function(t){t.setAttribute('aria-selected',t===event.target?'true':'false')})"
    >
      <button
        type="button"
        role="tab"
        ${activeTab === 'state' ? raw('aria-selected="true"') : raw('aria-selected="false"')}
        hx-get="/admin/documents/list?type=state"
        hx-target="#doc-table"
        hx-swap="innerHTML"
      >
        State Documents
      </button>
      <button
        type="button"
        role="tab"
        ${activeTab === 'activity-profile' ? raw('aria-selected="true"') : raw('aria-selected="false"')}
        hx-get="/admin/documents/list?type=activity-profile"
        hx-target="#doc-table"
        hx-swap="innerHTML"
      >
        Activity Profiles
      </button>
      <button
        type="button"
        role="tab"
        ${activeTab === 'agent-profile' ? raw('aria-selected="true"') : raw('aria-selected="false"')}
        hx-get="/admin/documents/list?type=agent-profile"
        hx-target="#doc-table"
        hx-swap="innerHTML"
      >
        Agent Profiles
      </button>
    </div>

    <div id="doc-table" hx-get="/admin/documents/list?type=${activeTab}" hx-trigger="load" hx-swap="innerHTML">
      <p class="text-muted">Loading documents...</p>
    </div>

    <hr />
    <details>
      <summary role="button" class="outline secondary">Bulk Delete State Documents</summary>
      <form
        hx-delete="/admin/documents/state/bulk"
        hx-target="#bulk-result"
        hx-swap="innerHTML"
        hx-confirm="Delete all matching state documents?"
      >
        <div class="grid">
          <label>
            Activity IRI
            <input type="text" name="activity_iri" required placeholder="http://..." />
          </label>
          <label>
            Agent IFI
            <input type="text" name="agent_ifi" required placeholder="mailto:..." />
          </label>
          <div style="display:flex;align-items:end">
            <button type="submit" class="secondary">Delete All</button>
          </div>
        </div>
      </form>
      <div id="bulk-result"></div>
    </details>
  `;
}

// ============================================================================
// State document list partial
// ============================================================================

export function stateDocumentTable(
  rows: StateDocumentListRow[],
  total: number,
  page: number,
  pageSize: number,
): RawHtml {
  return html`
    <p class="text-muted">${String(total)} state document${total !== 1 ? 's' : ''}</p>
    ${rows.length === 0
      ? html`
          <p class="text-muted">No state documents.</p>
        `
      : html`
          <figure>
            <table>
              <thead>
                <tr>
                  <th>State ID</th>
                  <th>Activity</th>
                  <th>Agent</th>
                  <th>Registration</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (d) => html`
                    <tr>
                      <td class="mono" style="font-size:0.8em">${d.state_id}</td>
                      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${d.activity_iri}</td>
                      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${d.agent_ifi}</td>
                      <td class="mono" style="font-size:0.75em">${d.registration ?? '\u2014'}</td>
                      <td>${d.content_type}</td>
                      <td>${String(d.content_length)}B</td>
                      <td class="text-muted">${fmtTime(d.last_modified)}</td>
                      <td>
                        <a href="/admin/documents/state/${d.id}">View</a>
                        <button
                          class="outline secondary"
                          style="padding:0.15em 0.4em;margin:0;font-size:0.8em"
                          hx-delete="/admin/documents/state/${d.id}"
                          hx-confirm="Delete this state document?"
                          hx-target="closest tr"
                          hx-swap="outerHTML"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </figure>
        `}
    ${pagination('state', page, pageSize, total)}
  `;
}

// ============================================================================
// Activity profile list partial
// ============================================================================

export function activityProfileTable(
  rows: ActivityProfileListRow[],
  total: number,
  page: number,
  pageSize: number,
): RawHtml {
  return html`
    <p class="text-muted">${String(total)} activity profile${total !== 1 ? 's' : ''}</p>
    ${rows.length === 0
      ? html`
          <p class="text-muted">No activity profiles.</p>
        `
      : html`
          <figure>
            <table>
              <thead>
                <tr>
                  <th>Profile ID</th>
                  <th>Activity</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (d) => html`
                    <tr>
                      <td class="mono" style="font-size:0.8em">${d.profile_id}</td>
                      <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${d.activity_iri}</td>
                      <td>${d.content_type}</td>
                      <td>${String(d.content_length)}B</td>
                      <td class="text-muted">${fmtTime(d.last_modified)}</td>
                      <td>
                        <a href="/admin/documents/activity-profile/${d.id}">View</a>
                        <button
                          class="outline secondary"
                          style="padding:0.15em 0.4em;margin:0;font-size:0.8em"
                          hx-delete="/admin/documents/activity-profile/${d.id}"
                          hx-confirm="Delete this activity profile?"
                          hx-target="closest tr"
                          hx-swap="outerHTML"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </figure>
        `}
    ${pagination('activity-profile', page, pageSize, total)}
  `;
}

// ============================================================================
// Agent profile list partial
// ============================================================================

export function agentProfileTable(rows: AgentProfileListRow[], total: number, page: number, pageSize: number): RawHtml {
  return html`
    <p class="text-muted">${String(total)} agent profile${total !== 1 ? 's' : ''}</p>
    ${rows.length === 0
      ? html`
          <p class="text-muted">No agent profiles.</p>
        `
      : html`
          <figure>
            <table>
              <thead>
                <tr>
                  <th>Profile ID</th>
                  <th>Agent</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (d) => html`
                    <tr>
                      <td class="mono" style="font-size:0.8em">${d.profile_id}</td>
                      <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${d.agent_ifi}</td>
                      <td>${d.content_type}</td>
                      <td>${String(d.content_length)}B</td>
                      <td class="text-muted">${fmtTime(d.last_modified)}</td>
                      <td>
                        <a href="/admin/documents/agent-profile/${d.id}">View</a>
                        <button
                          class="outline secondary"
                          style="padding:0.15em 0.4em;margin:0;font-size:0.8em"
                          hx-delete="/admin/documents/agent-profile/${d.id}"
                          hx-confirm="Delete this agent profile?"
                          hx-target="closest tr"
                          hx-swap="outerHTML"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </figure>
        `}
    ${pagination('agent-profile', page, pageSize, total)}
  `;
}

// ============================================================================
// Pagination
// ============================================================================

function pagination(type: DocType, page: number, pageSize: number, total: number): RawHtml {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return raw('');

  return html`
    <div style="display:flex;gap:0.5em;align-items:center">
      ${page > 1
        ? html`
            <button
              class="outline"
              style="padding:0.25em 0.5em"
              hx-get="/admin/documents/list?type=${type}&page=${String(page - 1)}"
              hx-target="#doc-table"
              hx-swap="innerHTML"
            >
              Previous
            </button>
          `
        : false}
      <span class="text-muted">Page ${String(page)} of ${String(totalPages)}</span>
      ${page < totalPages
        ? html`
            <button
              class="outline"
              style="padding:0.25em 0.5em"
              hx-get="/admin/documents/list?type=${type}&page=${String(page + 1)}"
              hx-target="#doc-table"
              hx-swap="innerHTML"
            >
              Next
            </button>
          `
        : false}
    </div>
  `;
}

// ============================================================================
// Document detail view
// ============================================================================

export function documentDetailView(doc: DocumentDetail): RawHtml {
  const isJson = doc.content_type.includes('json');
  let displayContent: string;
  try {
    if (isJson) {
      displayContent = JSON.stringify(JSON.parse(doc.contents.toString('utf8')), null, 2);
    } else if (doc.content_type.startsWith('text/')) {
      displayContent = doc.contents.toString('utf8');
    } else {
      displayContent = `[Binary content: ${doc.content_length} bytes, ${doc.content_type}]`;
    }
  } catch {
    displayContent = `[Unable to decode: ${doc.content_length} bytes]`;
  }

  const entries = Object.entries(doc).filter(([k]) => k !== 'contents');

  return html`
    <h2>Document Detail</h2>
    <figure>
      <table>
        <tbody>
          ${entries.map(
            ([k, v]) => html`
              <tr>
                <td><strong>${k}</strong></td>
                <td class="mono">${v instanceof Date ? v.toISOString() : String(v)}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </figure>
    <h3>Contents</h3>
    <pre class="json">${displayContent}</pre>
    <p><a href="/admin/documents">&larr; Back to documents</a></p>
  `;
}

export function bulkDeleteResult(count: number): RawHtml {
  return html`
    <p>Deleted ${String(count)} state document${count !== 1 ? 's' : ''}.</p>
  `;
}

export function deletedDocRow(): RawHtml {
  return raw('');
}
