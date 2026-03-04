import { describe, expect, it } from 'vitest';
import { basicAuth, xapiHeaders, VALID_STATEMENT, startScopedServer } from './xapi-scopes-test-helpers.js';

describe('scope: statements/write only', () => {
  const SCOPES = ['statements/write'];

  it('allows POST /xapi/statements', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_STATEMENT),
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows PUT /xapi/statements', async () => {
    const stmtId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements?statementId=${stmtId}`, {
        method: 'PUT',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VALID_STATEMENT, id: stmtId }),
      });
      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('rejects GET /xapi/statements with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('rejects GET /xapi/activities/state with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}`,
        { headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });
});

describe('scope: statements/read only', () => {
  const SCOPES = ['statements/read'];

  it('allows GET /xapi/statements', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('rejects POST /xapi/statements with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_STATEMENT),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('rejects PUT /xapi/activities/profile with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json', 'If-None-Match': '*' },
          body: '{}',
        },
      );
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });
});

describe('scope: state only', () => {
  const SCOPES = ['state'];

  it('allows PUT /xapi/activities/state', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
          body: '{"key":"value"}',
        },
      );
      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('allows GET /xapi/activities/state (list)', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}`,
        { headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows DELETE /xapi/activities/state', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}`,
        { method: 'DELETE', headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('rejects GET /xapi/statements with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('rejects PUT /xapi/agents/profile with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/agents/profile?agent=${agent}&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json', 'If-None-Match': '*' },
          body: '{}',
        },
      );
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });
});

describe('scope: define only', () => {
  const SCOPES = ['define'];

  it('allows GET /xapi/activities', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities?activityId=${encodeURIComponent('http://example.com/a')}`,
        { headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows PUT /xapi/activities/profile', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json', 'If-None-Match': '*' },
          body: '{}',
        },
      );
      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('rejects POST /xapi/statements with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_STATEMENT),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('rejects GET /xapi/agents with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(`${baseUrl}/xapi/agents?agent=${agent}`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });
});

describe('scope: profile only', () => {
  const SCOPES = ['profile'];

  it('allows GET /xapi/agents', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(`${baseUrl}/xapi/agents?agent=${agent}`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows PUT /xapi/agents/profile', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/agents/profile?agent=${agent}&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json', 'If-None-Match': '*' },
          body: '{}',
        },
      );
      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('rejects GET /xapi/activities with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities?activityId=${encodeURIComponent('http://example.com/a')}`,
        { headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('rejects POST /xapi/statements with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_STATEMENT),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });
});
