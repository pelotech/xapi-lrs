/**
 * Admin login form.
 */

import { html } from './html.ts';
import type { RawHtml } from './html.ts';
import { layout } from './layout.ts';

export function loginPage(error?: string): RawHtml {
  return layout({ title: 'Login' }, html`
    <article style="max-width:400px;margin:4em auto">
      <header><h2>LRS Admin Login</h2></header>
      ${error ? html`<p style="color:var(--pico-del-color)">${error}</p>` : false}
      <form method="post" action="/admin/login">
        <label>Username <input type="text" name="username" required autofocus></label>
        <label>Password <input type="password" name="password" required></label>
        <button type="submit">Login</button>
      </form>
    </article>
  `);
}
