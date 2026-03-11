/**
 * Integration Tests: xAPI Agent Profile Resource
 * PUT, POST (merge), GET (single + list), DELETE
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const agentJson = JSON.stringify({
  objectType: 'Agent',
  account: { homePage: 'https://example.com', name: `test-user-${randomUUID().slice(0, 8)}` },
});

function profileParams(opts: { profileId?: string; since?: string } = {}): string {
  const params = new URLSearchParams({ agent: agentJson });
  if (opts.profileId) {
    params.set('profileId', opts.profileId);
  }
  if (opts.since) {
    params.set('since', opts.since);
  }
  return params.toString();
}

describe('xAPI Agent Profile Resource', () => {
  describe('PUT /xapi/agents/profile', () => {
    test('should store a profile and return 204', async ({ server, authToken }) => {
      const response = await fetch(
        `${server.apiUrl}/xapi/agents/profile?${profileParams({ profileId: 'agent-prof-1' })}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
            'X-Experience-API-Version': '1.0.3',
            'If-None-Match': '*',
          },
          body: JSON.stringify({ preference: 'dark-mode' }),
        },
      );

      expect(response.status).toBe(204);
    });

    test('should overwrite existing profile with If-Match', async ({ server, authToken }) => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '1.0.3',
      };
      const qs = profileParams({ profileId: 'agent-overwrite' });

      await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: { ...headers, 'If-None-Match': '*' },
        body: JSON.stringify({ v: 1 }),
      });

      const getResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      const etag = getResp.headers.get('ETag')!;

      const resp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: { ...headers, 'If-Match': etag },
        body: JSON.stringify({ v: 2 }),
      });
      expect(resp.status).toBe(204);

      const verifyResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      expect(await verifyResp.json()).toEqual({ v: 2 });
    });
  });

  describe('POST /xapi/agents/profile (merge)', () => {
    test('should merge top-level keys', async ({ server, authToken }) => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '1.0.3',
      };
      const qs = profileParams({ profileId: 'agent-merge' });

      await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: { ...headers, 'If-None-Match': '*' },
        body: JSON.stringify({ a: 1, b: 2 }),
      });

      // Get ETag
      const getEtagResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      const etag = getEtagResp.headers.get('ETag')!;

      // POST merge with If-Match
      const resp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'POST',
        headers: { ...headers, 'If-Match': etag },
        body: JSON.stringify({ b: 'updated', c: 3 }),
      });
      expect(resp.status).toBe(204);

      const getResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      expect(await getResp.json()).toEqual({ a: 1, b: 'updated', c: 3 });
    });
  });

  describe('GET /xapi/agents/profile', () => {
    test('should return single profile with ETag and Last-Modified', async ({ server, authToken }) => {
      const qs = profileParams({ profileId: 'agent-get' });
      await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'X-Experience-API-Version': '1.0.3',
          'If-None-Match': '*',
        },
        body: JSON.stringify({ name: 'Test Agent' }),
      });

      const resp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });

      expect(resp.status).toBe(200);
      expect(await resp.json()).toEqual({ name: 'Test Agent' });
      expect(resp.headers.get('ETag')).toBeDefined();
      expect(resp.headers.get('Last-Modified')).toBeDefined();
    });

    test('should return 404 for non-existent profile', async ({ server, authToken }) => {
      const resp = await fetch(`${server.apiUrl}/xapi/agents/profile?${profileParams({ profileId: 'nonexistent' })}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      expect(resp.status).toBe(404);
    });

    test('should return list of profileIds when profileId is omitted', async ({ server, authToken }) => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '1.0.3',
        'If-None-Match': '*',
      };

      await fetch(`${server.apiUrl}/xapi/agents/profile?${profileParams({ profileId: 'p1' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ a: 1 }),
      });
      await fetch(`${server.apiUrl}/xapi/agents/profile?${profileParams({ profileId: 'p2' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ b: 2 }),
      });

      const resp = await fetch(`${server.apiUrl}/xapi/agents/profile?${profileParams()}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });

      expect(resp.status).toBe(200);
      const data: string[] = await resp.json();
      expect(data).toContain('p1');
      expect(data).toContain('p2');
    });
  });

  describe('DELETE /xapi/agents/profile', () => {
    test('should delete a profile', async ({ server, authToken }) => {
      const qs = profileParams({ profileId: 'agent-del' });
      await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'X-Experience-API-Version': '1.0.3',
          'If-None-Match': '*',
        },
        body: JSON.stringify({ data: 1 }),
      });

      const getResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      const etag = getResp.headers.get('ETag')!;

      const resp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3', 'If-Match': etag },
      });
      expect(resp.status).toBe(204);

      const verifyResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      expect(verifyResp.status).toBe(404);
    });
  });

  describe('Non-JSON document content', () => {
    test('should store and retrieve non-JSON content via PUT/GET', async ({ server, authToken }) => {
      const qs = profileParams({ profileId: 'binary-agent-prof' });
      const binaryContent = 'abcdefg';

      const putResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${authToken}`,
          'X-Experience-API-Version': '1.0.3',
          'If-None-Match': '*',
        },
        body: binaryContent,
      });
      expect(putResp.status).toBe(204);

      const getResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      expect(getResp.status).toBe(200);
      expect(getResp.headers.get('Content-Type')).toContain('application/octet-stream');
      const body = await getResp.text();
      expect(body).toBe(binaryContent);
    });

    test('should reject POST merge when existing document is non-JSON', async ({ server, authToken }) => {
      const qs = profileParams({ profileId: 'non-json-merge-agent' });

      // PUT non-JSON content
      await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${authToken}`,
          'X-Experience-API-Version': '1.0.3',
          'If-None-Match': '*',
        },
        body: 'abcdefg',
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      const etag = getResp.headers.get('ETag')!;

      // POST JSON merge should fail with 400
      const postResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'X-Experience-API-Version': '1.0.3',
          'If-Match': etag,
        },
        body: JSON.stringify({ key: 'value' }),
      });
      expect(postResp.status).toBe(400);
    });

    test('should return correct Content-Type for JSON documents', async ({ server, authToken }) => {
      const qs = profileParams({ profileId: 'json-ct-agent' });

      await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'X-Experience-API-Version': '1.0.3',
          'If-None-Match': '*',
        },
        body: JSON.stringify({ hello: 'world' }),
      });

      const getResp = await fetch(`${server.apiUrl}/xapi/agents/profile?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Experience-API-Version': '1.0.3' },
      });
      expect(getResp.status).toBe(200);
      expect(getResp.headers.get('Content-Type')).toContain('application/json');
      expect(await getResp.json()).toEqual({ hello: 'world' });
    });
  });
});
