/**
 * Admin credentials page — list, create, delete, rotate secret, edit scopes.
 */

import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { CredentialRow, AccountRow } from "../repositories.ts";

const ALL_SCOPES = [
  "statements/write",
  "statements/read",
  "statements/read/mine",
  "all/read",
  "all",
  "define",
  "profile",
  "state",
  "state/read",
] as const;

export function credentialsPage(
  credentials: CredentialRow[],
  accounts: AccountRow[],
  csrfToken: string,
  newCredential?: { apiKey: string; secretKey: string },
): RawHtml {
  return html`
    <h2>API Credentials</h2>

    ${
      newCredential
        ? html`
      <article style="border:2px solid var(--pico-primary);margin-bottom:1em">
        <header><strong>New Credential Created — copy the secret now!</strong></header>
        <p>
          <strong>API Key:</strong>
          <code class="mono">${newCredential.apiKey}</code>
        </p>
        <p>
          <strong>Secret Key:</strong>
          <code class="secret-display">${newCredential.secretKey}</code>
        </p>
        <p class="text-muted">The secret will not be shown again.</p>
      </article>
    `
        : false
    }

    <details>
      <summary role="button" class="outline">Create Credential</summary>
      <form method="post" action="/admin/credentials">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <label>
          Account
          <select name="account_id" required>
            <option value="">Select account...</option>
            ${accounts.map((a) => html`<option value="${a.id}">${a.username}</option>`)}
          </select>
        </label>
        <fieldset>
          <legend>Scopes</legend>
          ${ALL_SCOPES.map(
            (scope) => html`
            <label>
              <input type="checkbox" name="scopes" value="${scope}" />
              ${scope}
            </label>`,
          )}
        </fieldset>
        <button type="submit">Create</button>
      </form>
    </details>

    <div id="credential-list">
      ${credentialList(credentials)}
    </div>
  `;
}

export function credentialList(credentials: CredentialRow[]): RawHtml {
  return html`<figure>
    <table>
      <thead>
        <tr>
          <th>API Key</th>
          <th>Account</th>
          <th>Scopes</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${credentials.map(
        (cred) => html`
        <tr id="cred-${cred.id}">
          <td class="mono">${cred.api_key.slice(0, 12)}...</td>
          <td>${cred.account_name}</td>
          <td>
            ${scopeEditor(cred.id, cred.scopes)}
          </td>
          <td>
            <div id="secret-display-${cred.id}"></div>
            <button
              class="outline secondary"
              style="padding:0.25em 0.5em;margin:0.1em;font-size:0.85em"
              hx-post="/admin/credentials/${cred.id}/rotate"
              hx-target="#secret-display-${cred.id}"
              hx-swap="innerHTML"
              hx-confirm="Rotate secret key? The old secret will stop working immediately."
            >
              Rotate Secret
            </button>
            <button
              class="outline secondary"
              style="padding:0.25em 0.5em;margin:0.1em;font-size:0.85em"
              hx-delete="/admin/credentials/${cred.id}"
              hx-confirm="Delete this credential? This cannot be undone."
              hx-target="#cred-${cred.id}"
              hx-swap="outerHTML"
            >
              Delete
            </button>
          </td>
        </tr>`,
      )}</tbody>
    </table>
  </figure>`;
}

function scopeEditor(credentialId: string, scopes: string[]): RawHtml {
  return html`
    <form
      hx-put="/admin/credentials/${credentialId}/scopes"
      hx-trigger="change"
      hx-target="#scope-status-${credentialId}"
      hx-swap="innerHTML"
      style="margin:0"
    >
      ${ALL_SCOPES.map(
        (scope) => html`
        <label style="display:inline-block;margin-right:0.5em;font-size:0.8em">
          <input
            type="checkbox"
            name="scopes"
            value="${scope}"
            ${scopes.includes(scope) ? raw("checked") : false}
            style="margin-right:0.2em"
          />
          ${scope}
        </label>`,
      )}
      <span id="scope-status-${credentialId}" class="text-muted" style="font-size:0.8em"></span>
    </form>
  `;
}

export function rotatedSecret(secretKey: string): RawHtml {
  return html`
    <article style="border:2px solid var(--pico-primary);padding:0.5em;margin:0.25em 0">
      <strong>New Secret:</strong>
      <code class="secret-display">${secretKey}</code>
      <br />
      <small class="text-muted">Copy now — will not be shown again.</small>
    </article>
  `;
}

export function scopeUpdated(): RawHtml {
  return html`
    <small style="color: var(--pico-primary)">Saved</small>
  `;
}

export function deletedRow(): RawHtml {
  return raw("");
}
