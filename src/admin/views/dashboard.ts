/**
 * Admin dashboard — statement counts, recent statements, server info.
 */

import { html } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { DashboardCounts, RecentStatement } from "../repositories/index.ts";

function formatActor(actor: Record<string, unknown>): string {
  if (actor.name) return String(actor.name);
  if (actor.mbox) return String(actor.mbox).replace("mailto:", "");
  if (actor.account && typeof actor.account === "object") {
    const acct = actor.account as Record<string, unknown>;
    return `${acct.name ?? ""}@${acct.homePage ?? ""}`;
  }
  return JSON.stringify(actor).slice(0, 60);
}

function formatVerb(iri: string): string {
  const parts = iri.split("/");
  return parts[parts.length - 1] || iri;
}

function formatObject(obj: Record<string, unknown>): string {
  if (obj.definition && typeof obj.definition === "object") {
    const def = obj.definition as Record<string, unknown>;
    if (def.name && typeof def.name === "object") {
      const names = def.name as Record<string, string>;
      return names["en-US"] || names.en || Object.values(names)[0] || String(obj.id ?? "");
    }
  }
  return String(obj.id ?? JSON.stringify(obj).slice(0, 60));
}

function fmtTime(d: Date): string {
  return new Date(d).toISOString().slice(0, 19).replace("T", " ");
}

export function dashboardPage(
  counts: DashboardCounts,
  recent: RecentStatement[],
  uptime: string,
): RawHtml {
  return html`
    <h2>Dashboard</h2>
    <div class="grid">
      <article class="stat-card">
        <h3>${counts.totalStatements.toLocaleString()}</h3>
        <p>Total Statements</p>
      </article>
      <article class="stat-card">
        <h3>${counts.statements24h.toLocaleString()}</h3>
        <p>Last 24 Hours</p>
      </article>
      <article class="stat-card">
        <h3>${counts.statements7d.toLocaleString()}</h3>
        <p>Last 7 Days</p>
      </article>
    </div>
    <div class="grid">
      <article class="stat-card">
        <h3>${counts.accountCount}</h3>
        <p>Admin Accounts</p>
      </article>
      <article class="stat-card">
        <h3>${counts.credentialCount}</h3>
        <p>API Credentials</p>
      </article>
      <article class="stat-card">
        <h3>${uptime}</h3>
        <p>Uptime</p>
      </article>
    </div>

    <h3>Recent Statements</h3>
    ${
      recent.length === 0
        ? html`
            <p class="text-muted">No statements yet.</p>
          `
        : html`<figure>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Verb</th>
                <th>Actor</th>
                <th>Object</th>
              </tr>
            </thead>
            <tbody>
              ${recent.map(
                (s) =>
                  html` <tr>
                    <td class="text-muted">${fmtTime(s.stored)}</td>
                    <td>
                      <a href="/admin/statements/${s.statement_id}"
                        >${formatVerb(s.verb_iri)}</a
                      >
                    </td>
                    <td>${formatActor(s.actor)}</td>
                    <td>${formatObject(s.object)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </figure>`
    }

    <h3>Server Info</h3>
    <figure>
      <table>
        <tbody>
          <tr>
            <td>xAPI Version</td>
            <td>1.0.3</td>
          </tr>
          <tr>
            <td>Service</td>
            <td>xapi-lrs</td>
          </tr>
        </tbody>
      </table>
    </figure>
  `;
}
