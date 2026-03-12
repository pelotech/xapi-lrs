/**
 * Admin accounts page — list, create, delete, change password.
 */

import { html } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { AccountRow } from "../repositories.ts";

export function accountsPage(accounts: AccountRow[], csrfToken: string): RawHtml {
  return html`
    <h2>Admin Accounts</h2>

    <details>
      <summary role="button" class="outline">Create Account</summary>
      <form
        hx-post="/admin/accounts"
        hx-target="#account-list"
        hx-swap="innerHTML"
      >
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <div class="grid">
          <label>
            Username
            <input type="text" name="username" required />
          </label>
          <label>
            Password
            <input type="password" name="password" required minlength="4" />
          </label>
          <div style="display:flex;align-items:end">
            <button type="submit">Create</button>
          </div>
        </div>
      </form>
    </details>

    <div id="account-list">
      ${accountList(accounts)}
    </div>
  `;
}

export function accountList(accounts: AccountRow[]): RawHtml {
  return html`<figure>
    <table>
      <thead>
        <tr>
          <th>Username</th>
          <th>Credentials</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${accounts.map(
        (a) => html`
        <tr id="account-${a.id}">
          <td>${a.username}</td>
          <td>${String(a.credential_count ?? 0)}</td>
          <td>
            <details>
              <summary role="button" class="outline secondary" style="padding:0.25em 0.5em;margin:0;font-size:0.85em">
                Change Password
              </summary>
              <form
                hx-put="/admin/accounts/${a.id}/password"
                hx-target="#account-${a.id}"
                hx-swap="outerHTML"
              >
                <div class="grid">
                  <input type="password" name="password" placeholder="New password" required minlength="4" />
                  <button type="submit" style="padding:0.25em 0.5em">Set</button>
                </div>
              </form>
            </details>
            <button
              class="outline secondary"
              style="padding:0.25em 0.5em;margin:0;font-size:0.85em"
              hx-delete="/admin/accounts/${a.id}"
              hx-confirm="Delete account &quot;${a.username}&quot;? This will cascade-delete all its credentials."
              hx-target="#account-list"
              hx-swap="innerHTML"
            >
              Delete
            </button>
          </td>
        </tr>`,
      )}</tbody>
    </table>
  </figure>`;
}
