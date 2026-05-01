/**
 * xAPI Activities + State + Activity Profile Resource
 * GET /xapi/activities, /xapi/activities/state CRUD, /xapi/activities/profile CRUD
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoEnv } from '../hono-env.ts';
import { HttpError, withClient, parseMergeBody } from '../db.ts';
import { computeEtag, checkConcurrencyHeaders } from '../helpers/etag.ts';
import { canonicalAgentIfi, validateSince, validateRegistration } from '../helpers/agent.ts';
import {
  upsertStateDocument,
  getStateDocument,
  listStateIds,
  deleteStateDocument,
  deleteAllStateDocuments,
} from '../repositories/activity-state.ts';
import {
  upsertActivityProfile,
  getActivityProfile,
  listActivityProfileIds,
  deleteActivityProfile,
} from '../repositories/activity-profile.ts';
import { getActivityDefinition } from '../repositories/statements.ts';
import {
  getActivityRoute,
  putStateRoute,
  postStateRoute,
  getStateRoute,
  deleteStateRoute,
  putProfileRoute,
  postProfileRoute,
  getProfileRoute,
  deleteProfileRoute,
  concurrencyHeaders,
  documentResponse,
} from './activity-helpers.ts';

// ============================================================================
// Route app
// ============================================================================

export function createActivitiesApp() {
  const app = new OpenAPIHono<HonoEnv>();

  // GET /xapi/activities
  app.openapi(getActivityRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const activityId = c.req.query('activityId')!;

    const result = await withClient(pool, metrics, async (client) => {
      return getActivityDefinition(client, activityId);
    });

    return c.json(result, 200);
  });

  // PUT /xapi/activities/state
  app.openapi(putStateRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const stateId = c.req.query('stateId')!;
    const activityId = c.req.query('activityId')!;
    const agent = c.req.query('agent')!;
    const registration = c.req.query('registration');
    validateRegistration(registration);

    const agentIfi = canonicalAgentIfi(agent);
    const body = c.var.rawBody;
    const contentType = c.req.header('content-type') ?? 'application/octet-stream';
    const timestamp = new Date().toISOString();

    await withClient(pool, metrics, async (client) => {
      const existing = await getStateDocument(client, {
        stateId,
        activityIri: activityId,
        agentIfi,
        registration,
      });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(concurrencyHeaders(c), existingEtag);
      await upsertStateDocument(client, {
        stateId,
        activityIri: activityId,
        agentIfi,
        registration,
        contents: body,
        contentType,
        lastModified: timestamp,
      });
    });

    return c.body(null, 204);
  });

  // POST /xapi/activities/state (JSON merge)
  app.openapi(postStateRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const stateId = c.req.query('stateId')!;
    const activityId = c.req.query('activityId')!;
    const agent = c.req.query('agent')!;
    const registration = c.req.query('registration');
    validateRegistration(registration);

    const agentIfi = canonicalAgentIfi(agent);
    const contentType = c.req.header('content-type') ?? '';
    const body = c.var.rawBody;
    const incomingData = parseMergeBody(body, contentType);
    const timestamp = new Date().toISOString();

    await withClient(pool, metrics, async (client) => {
      const existing = await getStateDocument(client, {
        stateId,
        activityIri: activityId,
        agentIfi,
        registration,
      });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(concurrencyHeaders(c), existingEtag);

      if (existing && !existing.content_type.includes('application/json')) {
        throw new HttpError(400, 'Cannot merge into non-JSON document');
      }

      const existingData = existing ? (JSON.parse(existing.contents.toString('utf8')) as Record<string, unknown>) : {};
      const merged = { ...existingData, ...incomingData };
      const mergedBuf = Buffer.from(JSON.stringify(merged), 'utf8');

      await upsertStateDocument(client, {
        stateId,
        activityIri: activityId,
        agentIfi,
        registration,
        contents: mergedBuf,
        contentType: 'application/json',
        lastModified: timestamp,
      });
    });

    return c.body(null, 204);
  });

  // GET /xapi/activities/state
  app.openapi(getStateRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const activityId = c.req.query('activityId')!;
    const agent = c.req.query('agent')!;
    const stateId = c.req.query('stateId');
    const registration = c.req.query('registration');
    const since = c.req.query('since');
    const agentIfi = canonicalAgentIfi(agent);
    validateSince(since);
    validateRegistration(registration);

    if (!stateId) {
      const ids = await withClient(pool, metrics, async (client) =>
        listStateIds(client, { activityIri: activityId, agentIfi, registration, since }),
      );
      return c.json(ids, 200);
    }

    const row = await withClient(pool, metrics, async (client) =>
      getStateDocument(client, { stateId, activityIri: activityId, agentIfi, registration }),
    );

    if (!row) {
      throw new HttpError(404, 'State document not found');
    }

    return documentResponse(c, row);
  });

  // DELETE /xapi/activities/state
  app.openapi(deleteStateRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const activityId = c.req.query('activityId')!;
    const agent = c.req.query('agent')!;
    const stateId = c.req.query('stateId');
    const registration = c.req.query('registration');
    const since = c.req.query('since');
    const agentIfi = canonicalAgentIfi(agent);
    validateSince(since);
    validateRegistration(registration);

    await withClient(pool, metrics, async (client) => {
      if (stateId) {
        const existing = await getStateDocument(client, {
          stateId,
          activityIri: activityId,
          agentIfi,
          registration,
        });
        const existingEtag = existing ? computeEtag(existing.contents) : undefined;
        checkConcurrencyHeaders(concurrencyHeaders(c), existingEtag);
        await deleteStateDocument(client, {
          stateId,
          activityIri: activityId,
          agentIfi,
          registration,
        });
      } else {
        await deleteAllStateDocuments(client, {
          activityIri: activityId,
          agentIfi,
          registration,
          since,
        });
      }
    });

    return c.body(null, 204);
  });

  // PUT /xapi/activities/profile
  app.openapi(putProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const profileId = c.req.query('profileId')!;
    const activityId = c.req.query('activityId')!;

    const body = c.var.rawBody;
    const contentType = c.req.header('content-type') ?? 'application/octet-stream';
    const timestamp = new Date().toISOString();

    await withClient(pool, metrics, async (client) => {
      const existing = await getActivityProfile(client, { profileId, activityIri: activityId });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(concurrencyHeaders(c), existingEtag, true);
      await upsertActivityProfile(client, {
        profileId,
        activityIri: activityId,
        contents: body,
        contentType,
        lastModified: timestamp,
      });
    });

    return c.body(null, 204);
  });

  // POST /xapi/activities/profile (JSON merge)
  app.openapi(postProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const profileId = c.req.query('profileId')!;
    const activityId = c.req.query('activityId')!;

    const contentType = c.req.header('content-type') ?? '';
    const body = c.var.rawBody;
    const incomingData = parseMergeBody(body, contentType);
    const timestamp = new Date().toISOString();

    await withClient(pool, metrics, async (client) => {
      const existing = await getActivityProfile(client, { profileId, activityIri: activityId });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(concurrencyHeaders(c), existingEtag);

      if (existing && !existing.content_type.includes('application/json')) {
        throw new HttpError(400, 'Cannot merge into non-JSON document');
      }

      const existingData = existing ? (JSON.parse(existing.contents.toString('utf8')) as Record<string, unknown>) : {};
      const merged = { ...existingData, ...incomingData };
      const mergedBuf = Buffer.from(JSON.stringify(merged), 'utf8');

      await upsertActivityProfile(client, {
        profileId,
        activityIri: activityId,
        contents: mergedBuf,
        contentType: existing?.content_type ?? 'application/json',
        lastModified: timestamp,
      });
    });

    return c.body(null, 204);
  });

  // GET /xapi/activities/profile
  app.openapi(getProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const activityId = c.req.query('activityId')!;
    const profileId = c.req.query('profileId');
    const since = c.req.query('since');
    validateSince(since);

    if (!profileId) {
      const ids = await withClient(pool, metrics, async (client) =>
        listActivityProfileIds(client, { activityIri: activityId, since }),
      );
      return c.json(ids, 200);
    }

    const row = await withClient(pool, metrics, async (client) => {
      const doc = await getActivityProfile(client, { profileId, activityIri: activityId });
      if (!doc) throw new HttpError(404, 'Activity profile not found');
      return doc;
    });

    return documentResponse(c, row);
  });

  // DELETE /xapi/activities/profile
  app.openapi(deleteProfileRoute, async (c) => {
    const { pool, metrics } = c.var.deps;
    const profileId = c.req.query('profileId')!;
    const activityId = c.req.query('activityId')!;

    await withClient(pool, metrics, async (client) => {
      const existing = await getActivityProfile(client, { profileId, activityIri: activityId });
      const existingEtag = existing ? computeEtag(existing.contents) : undefined;
      checkConcurrencyHeaders(concurrencyHeaders(c), existingEtag);
      await deleteActivityProfile(client, { profileId, activityIri: activityId });
    });

    return c.body(null, 204);
  });

  return app;
}
