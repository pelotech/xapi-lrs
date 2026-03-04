export function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>xAPI LRS Admin</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    nav ul { list-style: none; display: flex; gap: 1rem; padding: 0; margin: 0; }
    nav a { text-decoration: none; }
    nav a[aria-current="page"] { font-weight: bold; text-decoration: underline; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat-card { padding: 1rem; border-radius: 8px; background: var(--pico-card-background-color); border: 1px solid var(--pico-muted-border-color); }
    .stat-card h3 { margin: 0; font-size: 2rem; }
    .stat-card p { margin: 0; color: var(--pico-muted-color); }
    table { font-size: 0.9rem; }
    .json-detail { max-height: 400px; overflow: auto; }
    .json-detail pre { white-space: pre-wrap; word-break: break-all; }
    .filter-form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end; margin-bottom: 1rem; }
    .filter-form label { margin-bottom: 0; }
    .filter-form input, .filter-form select { margin-bottom: 0; padding: 0.4rem 0.6rem; }
  </style>
</head>
<body>
  <nav class="container" hx-boost="true">
    <ul>
      <li><strong>xAPI LRS</strong></li>
    </ul>
    <ul>
      <li><a href="/admin">Dashboard</a></li>
      <li><a href="/admin/tenants">Tenants</a></li>
      <li><a href="/admin/tokens">Tokens</a></li>
      <li><a href="/admin/statements">Statements</a></li>
      <li><a href="/admin/logout">Logout</a></li>
    </ul>
  </nav>
  <main class="container">
    ${content}
  </main>
</body>
</html>`;
}
