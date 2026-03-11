/**
 * Integration Tests: xAPI Activity State Resource
 * Tests PUT, POST (merge), GET (single + list), DELETE (single + all)
 * Verifies DB state after each operation
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';
import type pg from 'pg';

const uid = randomUUID().slice(0, 8);
const agentJson = JSON.stringify({
  objectType: 'Agent',
  account: { homePage: 'https://example.com', name: `test-user-${uid}` },
});
const activityId = `https://example.com/activities/test-activity-${uid}`;
const V = { 'X-Experience-API-Version': '1.0.3' } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build query string for state requests */
function stateParams(
  opts: {
    stateId?: string;
    registration?: string;
    since?: string;
  } = {},
): string {
  const params = new URLSearchParams({
    activityId,
    agent: agentJson,
  });
  if (opts.stateId) params.set('stateId', opts.stateId);
  if (opts.registration) params.set('registration', opts.registration);
  if (opts.since) params.set('since', opts.since);
  return params.toString();
}

const agentIfi = `account::test-user-${uid}@https://example.com`;

/** Query state_document directly — parses bytea contents to JSON for assertions */
async function queryStates(
  pool: pg.Pool,
  filterStateId?: string,
): Promise<{ state_id: string; state_data: unknown; content_type: string; last_modified: Date }[]> {
  const conditions = ['activity_iri = $1', 'agent_ifi = $2'];
  const values: unknown[] = [activityId, agentIfi];
  if (filterStateId) {
    conditions.push(`state_id = $${values.length + 1}`);
    values.push(filterStateId);
  }
  const result = await pool.query(
    `SELECT state_id, contents, content_type, last_modified FROM state_document WHERE ${conditions.join(' AND ')}`,
    values,
  );
  return result.rows.map((r: { state_id: string; contents: Buffer; content_type: string; last_modified: Date }) => ({
    state_id: r.state_id,
    state_data: r.content_type.includes('application/json') ? JSON.parse(r.contents.toString('utf8')) : r.contents,
    content_type: r.content_type,
    last_modified: r.last_modified,
  }));
}

// ==========================================================================
// Test suite
// ==========================================================================

describe('xAPI Activity State Resource', () => {
  // ==========================================================================
  // PUT /xapi/activities/state
  // ==========================================================================

  describe('PUT /xapi/activities/state', () => {
    test('should store a new state document and return 204', async ({ pool, server, basicAuth }) => {
      const stateData = { bookmark: 'page-5', progress: 50 };

      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'bookmark' })}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify(stateData),
      });

      expect(response.status).toBe(204);

      const rows = await queryStates(pool, 'bookmark');
      expect(rows).toHaveLength(1);
      expect(rows[0].state_data).toEqual(stateData);
    });

    test('should overwrite existing state document on second PUT with If-Match', async ({
      pool,
      server,
      basicAuth,
    }) => {
      const qs = stateParams({ stateId: 'bookmark' });
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };

      // First PUT
      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ bookmark: 'page-1' }),
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      const etag = getResp.headers.get('ETag')!;

      // Second PUT (overwrite) with If-Match
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'PUT',
        headers: { ...headers, 'If-Match': etag },
        body: JSON.stringify({ bookmark: 'page-10', newField: true }),
      });

      expect(response.status).toBe(204);

      const rows = await queryStates(pool, 'bookmark');
      expect(rows).toHaveLength(1);
      expect(rows[0].state_data).toEqual({ bookmark: 'page-10', newField: true });
    });

    test('should store multiple state documents with different stateIds', async ({
      pool,
      server,
      basicAuth,
    }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };

      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'state-a' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ a: 1 }),
      });

      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'state-b' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ b: 2 }),
      });

      const rows = await queryStates(pool);
      const stateIds = rows.map((r) => r.state_id);
      expect(stateIds).toContain('state-a');
      expect(stateIds).toContain('state-b');
    });

    test('should store state with registration context', async ({ pool, server, basicAuth }) => {
      const registrationId = randomUUID();
      const response = await fetch(
        `${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'reg-state', registration: registrationId })}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V },
          body: JSON.stringify({ regSpecific: true }),
        },
      );

      expect(response.status).toBe(204);

      const result = await pool.query(`SELECT registration FROM state_document WHERE state_id = $1`, [
        'reg-state',
      ]);
      expect(result.rows[0].registration).toBe(registrationId);
    });
  });

  // ==========================================================================
  // POST /xapi/activities/state (merge semantics)
  // ==========================================================================

  describe('POST /xapi/activities/state (merge)', () => {
    test('should create state document when none exists', async ({ pool, server, basicAuth }) => {
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'merge-test' })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify({ key1: 'value1' }),
      });

      expect(response.status).toBe(204);

      const rows = await queryStates(pool, 'merge-test');
      expect(rows).toHaveLength(1);
      expect(rows[0].state_data).toEqual({ key1: 'value1' });
    });

    test('should merge top-level keys into existing document', async ({ pool, server, basicAuth }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };
      const qs = stateParams({ stateId: 'merge-test' });

      // PUT initial state
      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ key1: 'value1', key2: 'value2' }),
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      const etag = getResp.headers.get('ETag')!;

      // POST merge with If-Match
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'POST',
        headers: { ...headers, 'If-Match': etag },
        body: JSON.stringify({ key2: 'updated', key3: 'new' }),
      });

      expect(response.status).toBe(204);

      const rows = await queryStates(pool, 'merge-test');
      expect(rows).toHaveLength(1);
      expect(rows[0].state_data).toEqual({
        key1: 'value1',
        key2: 'updated',
        key3: 'new',
      });
    });

    test('should not deep-merge nested objects (top-level only)', async ({ pool, server, basicAuth }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };
      const qs = stateParams({ stateId: 'merge-deep' });

      // PUT with nested object
      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ nested: { a: 1, b: 2 }, top: 'keep' }),
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      const etag = getResp.headers.get('ETag')!;

      // POST merge — nested key is replaced entirely
      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'POST',
        headers: { ...headers, 'If-Match': etag },
        body: JSON.stringify({ nested: { c: 3 } }),
      });

      const rows = await queryStates(pool, 'merge-deep');
      expect(rows[0].state_data).toEqual({
        nested: { c: 3 },
        top: 'keep',
      });
    });
  });

  // ==========================================================================
  // GET /xapi/activities/state
  // ==========================================================================

  describe('GET /xapi/activities/state', () => {
    test('should return single state document when stateId is provided', async ({ server, basicAuth }) => {
      // Store a state
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'doc-1' })}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify({ hello: 'world' }),
      });

      // Get it back
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'doc-1' })}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ hello: 'world' });
    });

    test('should return 404 for non-existent stateId', async ({ server, basicAuth }) => {
      const response = await fetch(
        `${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'nonexistent' })}`,
        { headers: { Authorization: `Basic ${basicAuth}`, ...V } },
      );

      expect(response.status).toBe(404);
    });

    test('should return list of stateIds when stateId is omitted', async ({ server, basicAuth }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };

      // Store multiple states
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'alpha' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ a: 1 }),
      });
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'beta' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ b: 2 }),
      });
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'gamma' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ c: 3 }),
      });

      // GET without stateId
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams()}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(response.status).toBe(200);
      const data: string[] = await response.json();
      expect(data).toContain('alpha');
      expect(data).toContain('beta');
      expect(data).toContain('gamma');
    });

    test('should return empty list when no states exist', async ({ server, basicAuth }) => {
      // Use a unique agent+activity combo guaranteed to have no pre-existing state
      const emptyAgent = JSON.stringify({
        objectType: 'Agent',
        account: { homePage: 'https://example.com', name: `empty-${randomUUID().slice(0, 8)}` },
      });
      const emptyActivity = `https://example.com/activities/empty-${randomUUID()}`;
      const qs = new URLSearchParams({ activityId: emptyActivity, agent: emptyAgent }).toString();

      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual([]);
    });

    test('should filter stateId list by since parameter', async ({ server, basicAuth }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };

      // Store first state
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'old-state' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ old: true }),
      });

      // Record timestamp between the two PUTs
      const midpoint = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Store second state
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'new-state' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ new: true }),
      });

      // GET with since filter — should only return new-state
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ since: midpoint })}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual(['new-state']);
    });
  });

  // ==========================================================================
  // DELETE /xapi/activities/state
  // ==========================================================================

  describe('DELETE /xapi/activities/state', () => {
    test('should delete a single state document by stateId', async ({ pool, server, basicAuth }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };

      // Store
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'to-delete' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data: 1 }),
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'to-delete' })}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      const etag = getResp.headers.get('ETag')!;

      // Delete with If-Match
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'to-delete' })}`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${basicAuth}`, ...V, 'If-Match': etag },
      });

      expect(response.status).toBe(204);

      const rows = await queryStates(pool, 'to-delete');
      expect(rows).toHaveLength(0);
    });

    test('should delete all state documents when stateId is omitted', async ({ pool, server, basicAuth }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };

      // Store multiple
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 's1' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ a: 1 }),
      });
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 's2' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ b: 2 }),
      });
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 's3' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ c: 3 }),
      });

      // Delete all (without registration — only deletes states without registration)
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams()}`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(response.status).toBe(204);

      const rows = await queryStates(pool);
      const remainingIds = rows.map((r) => r.state_id);
      expect(remainingIds).not.toContain('s1');
      expect(remainingIds).not.toContain('s2');
      expect(remainingIds).not.toContain('s3');
    });

    test('should respect since parameter when deleting all', async ({ pool, server, basicAuth }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V };

      // Store first state
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'keep-me' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ keep: true }),
      });

      const midpoint = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Store second state
      await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'delete-me' })}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ delete: true }),
      });

      // Delete all since midpoint
      const response = await fetch(`${server.apiUrl}/xapi/activities/state?${stateParams({ since: midpoint })}`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });

      expect(response.status).toBe(204);

      const rows = await queryStates(pool);
      const remainingIds = rows.map((r) => r.state_id);
      expect(remainingIds).toContain('keep-me');
      expect(remainingIds).not.toContain('delete-me');
    });

    test('should return 204 even when nothing to delete', async ({ server, basicAuth }) => {
      const response = await fetch(
        `${server.apiUrl}/xapi/activities/state?${stateParams({ stateId: 'nonexistent' })}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Basic ${basicAuth}`, ...V },
        },
      );

      expect(response.status).toBe(204);
    });
  });

  // ==========================================================================
  // Non-JSON document content
  // ==========================================================================

  describe('Non-JSON document content', () => {
    test('should store and retrieve non-JSON content via PUT/GET', async ({ server, basicAuth }) => {
      const qs = stateParams({ stateId: 'binary-state' });
      const binaryContent = 'abcdefg';

      // PUT with non-JSON content type
      const putResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Basic ${basicAuth}`, ...V },
        body: binaryContent,
      });
      expect(putResp.status).toBe(204);

      // GET should return the content with correct Content-Type
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      expect(getResp.status).toBe(200);
      expect(getResp.headers.get('Content-Type')).toContain('application/octet-stream');
      const body = await getResp.text();
      expect(body).toBe(binaryContent);
    });

    test('should reject POST merge when existing document is non-JSON', async ({ server, basicAuth }) => {
      const qs = stateParams({ stateId: 'non-json-merge' });

      // PUT non-JSON content
      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Basic ${basicAuth}`, ...V },
        body: 'abcdefg',
      });

      // Get ETag
      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      const etag = getResp.headers.get('ETag')!;

      // POST JSON merge should fail with 400
      const postResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basicAuth}`,
          ...V,
          'If-Match': etag,
        },
        body: JSON.stringify({ key: 'value' }),
      });
      expect(postResp.status).toBe(400);
    });

    test('should return correct Content-Type for JSON documents', async ({ server, basicAuth }) => {
      const qs = stateParams({ stateId: 'json-ct' });

      await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}`, ...V },
        body: JSON.stringify({ hello: 'world' }),
      });

      const getResp = await fetch(`${server.apiUrl}/xapi/activities/state?${qs}`, {
        headers: { Authorization: `Basic ${basicAuth}`, ...V },
      });
      expect(getResp.status).toBe(200);
      expect(getResp.headers.get('Content-Type')).toContain('application/json');
      expect(await getResp.json()).toEqual({ hello: 'world' });
    });
  });
});
