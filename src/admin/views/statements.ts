/**
 * Admin statement browser — paginated list, detail view, void action.
 */

import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { XapiStatementRow } from "../../repositories/statements.ts";
import type { AttachmentListRow } from "../repositories/index.ts";

function formatActor(payload: Record<string, unknown>): string {
  const actor = payload.actor as Record<string, unknown> | undefined;
  if (!actor) return "\u2014";
  if (actor.name) return String(actor.name);
  if (actor.mbox) return String(actor.mbox).replace("mailto:", "");
  if (actor.account && typeof actor.account === "object") {
    const acct = actor.account as Record<string, unknown>;
    return `${acct.name ?? ""}@${acct.homePage ?? ""}`;
  }
  return "(anonymous)";
}

function formatVerb(iri: string): string {
  const parts = iri.split("/");
  return parts[parts.length - 1] || iri;
}

function formatObject(payload: Record<string, unknown>): string {
  const obj = payload.object as Record<string, unknown> | undefined;
  if (!obj) return "\u2014";
  if (obj.definition && typeof obj.definition === "object") {
    const def = obj.definition as Record<string, unknown>;
    if (def.name && typeof def.name === "object") {
      const names = def.name as Record<string, string>;
      return names["en-US"] || names.en || Object.values(names)[0] || String(obj.id ?? "");
    }
  }
  return String(obj.id ?? obj.objectType ?? "\u2014");
}

function fmtTime(d: Date): string {
  return new Date(d).toISOString().slice(0, 19).replace("T", " ");
}

// ============================================================================
// Statement list (full page)
// ============================================================================

export function statementsPage(opts: {
  verb?: string;
  agent?: string;
  activity?: string;
  since?: string;
  until?: string;
}): RawHtml {
  return html`
    <h2>Statement Browser</h2>

    <details>
      <summary>Filters</summary>
      <form
        hx-get="/admin/statements/list"
        hx-target="#statement-table"
        hx-swap="innerHTML"
        hx-push-url="false"
      >
        <div class="grid">
          <label>
            Verb IRI
            <input type="text" name="verb" value="${opts.verb ?? ""}" placeholder="http://adlnet.gov/expapi/verbs/..." />
          </label>
          <label>
            Agent IFI
            <input type="text" name="agent" value="${opts.agent ?? ""}" placeholder='{"mbox":"mailto:..."}' />
          </label>
        </div>
        <div class="grid">
          <label>
            Activity IRI
            <input type="text" name="activity" value="${opts.activity ?? ""}" placeholder="http://example.com/activity/..." />
          </label>
          <label>
            Since
            <input type="datetime-local" name="since" value="${opts.since ?? ""}" />
          </label>
          <label>
            Until
            <input type="datetime-local" name="until" value="${opts.until ?? ""}" />
          </label>
        </div>
        <button type="submit">Search</button>
      </form>
    </details>

    <div id="statement-table"
      hx-get="/admin/statements/list"
      hx-trigger="load"
      hx-swap="innerHTML"
    >
      <p class="text-muted">Loading statements...</p>
    </div>
  `;
}

// ============================================================================
// Statement table partial (htmx)
// ============================================================================

export function statementTable(opts: {
  rows: XapiStatementRow[];
  hasMore: boolean;
  cursor?: string;
  filters: string;
}): RawHtml {
  const { rows, hasMore, cursor, filters } = opts;

  if (rows.length === 0) {
    return html`
      <p class="text-muted">No statements found.</p>
    `;
  }

  return html`
    <figure>
      <table>
        <thead>
          <tr>
            <th>Stored</th>
            <th>Verb</th>
            <th>Actor</th>
            <th>Object</th>
            <th>ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows.map(
          (s) => html`
          <tr${s.is_voided ? raw(' class="voided"') : false}>
            <td class="text-muted">${fmtTime(s.stored)}</td>
            <td>${formatVerb(((s.payload.verb as Record<string, unknown>)?.id as string) ?? "")}</td>
            <td>${formatActor(s.payload)}</td>
            <td>${formatObject(s.payload)}</td>
            <td>
              <a href="/admin/statements/${s.statement_id}" class="mono" style="font-size:0.75em">
                ${s.statement_id.slice(0, 8)}...
              </a>
            </td>
            <td>
              ${
                s.is_voided
                  ? html`
                      <span class="badge badge-voided">voided</span>
                    `
                  : false
              }
            </td>
          </tr>`,
        )}</tbody>
      </table>
    </figure>

    ${
      hasMore && cursor
        ? html`
      <button
        class="outline"
        hx-get="/admin/statements/list?cursor=${cursor}&${filters}"
        hx-target="#statement-table"
        hx-swap="innerHTML"
      >
        Load More
      </button>
    `
        : false
    }
  `;
}

// ============================================================================
// Statement detail
// ============================================================================

export function statementDetail(row: XapiStatementRow, attachments: AttachmentListRow[]): RawHtml {
  return html`
    <h2>
      Statement Detail
      ${
        row.is_voided
          ? html`
              <span class="badge badge-voided" style="margin-left: 0.5em">voided</span>
            `
          : false
      }
    </h2>

    <figure>
      <table>
        <tbody>
          <tr><td><strong>Statement ID</strong></td><td class="mono">${row.statement_id}</td></tr>
          <tr><td><strong>Stored</strong></td><td>${new Date(row.stored).toISOString()}</td></tr>
          <tr><td><strong>Voided</strong></td><td>${row.is_voided ? "Yes" : "No"}</td></tr>
        </tbody>
      </table>
    </figure>

    ${
      !row.is_voided
        ? html`
      <div id="void-action">
        <button
          class="outline secondary"
          hx-post="/admin/statements/${row.statement_id}/void"
          hx-confirm="Void this statement? This cannot be undone."
          hx-target="#void-action"
          hx-swap="innerHTML"
        >
          Void Statement
        </button>
      </div>
    `
        : false
    }

    <h3>Payload</h3>
    <pre class="json">${JSON.stringify(row.payload, null, 2)}</pre>

    ${
      attachments.length > 0
        ? html`
      <h3>Attachments</h3>
      <figure>
        <table>
          <thead>
            <tr>
              <th>SHA-256</th>
              <th>Content-Type</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${attachments.map(
            (a) => html`
            <tr>
              <td class="mono" style="font-size:0.75em">${a.attachment_sha.slice(0, 16)}...</td>
              <td>${a.content_type}</td>
              <td>${String(a.content_length)} bytes</td>
              <td>
                <a href="/admin/statements/${row.statement_id}/attachments/${a.attachment_sha}">
                  Download
                </a>
              </td>
            </tr>`,
          )}</tbody>
        </table>
      </figure>
    `
        : false
    }

    <p><a href="/admin/statements">&larr; Back to browser</a></p>
  `;
}

export function voidedConfirmation(): RawHtml {
  return html`
    <p><span class="badge badge-voided">Statement voided</span></p>
  `;
}
