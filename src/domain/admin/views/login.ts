export function loginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Login - xAPI LRS</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    article { width: 100%; max-width: 400px; }
  </style>
</head>
<body>
  <article>
    <h2>Admin Login</h2>
    ${error ? `<p style="color:var(--pico-del-color)">${error}</p>` : ''}
    <form method="POST" action="/admin/login">
      <label for="secret">Admin Secret</label>
      <input type="password" id="secret" name="secret" required autofocus>
      <button type="submit">Sign In</button>
    </form>
  </article>
</body>
</html>`;
}
