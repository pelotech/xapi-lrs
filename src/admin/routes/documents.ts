/**
 * Admin document routes — state, activity-profile, agent-profile browser.
 */

import type { Hono, Context } from 'hono';
import {
  listStateDocuments,
  listActivityProfiles,
  listAgentProfiles,
  getStateDocumentById,
  getActivityProfileById,
  getAgentProfileById,
  deleteStateDocumentById,
  deleteActivityProfileById,
  deleteAgentProfileById,
  bulkDeleteStateDocuments,
} from '../repositories/index.ts';
import type { AdminEnv, AdminDeps } from '../types.ts';
import {
  documentsPage,
  stateDocumentTable,
  activityProfileTable,
  agentProfileTable,
  documentDetailView,
  bulkDeleteResult,
  deletedDocRow,
} from '../views/documents.ts';
import type { RawHtml } from '../views/html.ts';

export function registerDocumentRoutes(
  app: Hono<AdminEnv>,
  deps: AdminDeps,
  renderPage: (c: Context<AdminEnv>, content: RawHtml) => Response,
): void {
  app.get('/documents', (c) => {
    return renderPage(c, documentsPage());
  });

  app.get('/documents/list', async (c) => {
    const type = c.req.query('type') ?? 'state';
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
    const pageSize = 25;
    const offset = (page - 1) * pageSize;

    if (type === 'state') {
      const { rows, total } = await listStateDocuments(deps.pool, deps.metrics, pageSize, offset);
      return c.html(stateDocumentTable(rows, total, page, pageSize).value);
    } else if (type === 'activity-profile') {
      const { rows, total } = await listActivityProfiles(deps.pool, deps.metrics, pageSize, offset);
      return c.html(activityProfileTable(rows, total, page, pageSize).value);
    } else {
      const { rows, total } = await listAgentProfiles(deps.pool, deps.metrics, pageSize, offset);
      return c.html(agentProfileTable(rows, total, page, pageSize).value);
    }
  });

  app.get('/documents/state/:id', async (c) => {
    const doc = await getStateDocumentById(deps.pool, deps.metrics, c.req.param('id'));
    if (!doc) return c.text('Not found', 404);
    return renderPage(c, documentDetailView(doc));
  });

  app.get('/documents/activity-profile/:id', async (c) => {
    const doc = await getActivityProfileById(deps.pool, deps.metrics, c.req.param('id'));
    if (!doc) return c.text('Not found', 404);
    return renderPage(c, documentDetailView(doc));
  });

  app.get('/documents/agent-profile/:id', async (c) => {
    const doc = await getAgentProfileById(deps.pool, deps.metrics, c.req.param('id'));
    if (!doc) return c.text('Not found', 404);
    return renderPage(c, documentDetailView(doc));
  });

  app.delete('/documents/state/:id', async (c) => {
    const session = c.get('adminSession');
    await deleteStateDocumentById(deps.pool, deps.metrics, c.req.param('id'));
    c.var.logger.info(
      {
        admin: session.username,
        action: 'document.delete',
        target: c.req.param('id'),
        type: 'state',
      },
      'State document deleted',
    );
    return c.html(deletedDocRow().value);
  });

  app.delete('/documents/activity-profile/:id', async (c) => {
    const session = c.get('adminSession');
    await deleteActivityProfileById(deps.pool, deps.metrics, c.req.param('id'));
    c.var.logger.info(
      {
        admin: session.username,
        action: 'document.delete',
        target: c.req.param('id'),
        type: 'activity-profile',
      },
      'Activity profile deleted',
    );
    return c.html(deletedDocRow().value);
  });

  app.delete('/documents/agent-profile/:id', async (c) => {
    const session = c.get('adminSession');
    await deleteAgentProfileById(deps.pool, deps.metrics, c.req.param('id'));
    c.var.logger.info(
      {
        admin: session.username,
        action: 'document.delete',
        target: c.req.param('id'),
        type: 'agent-profile',
      },
      'Agent profile deleted',
    );
    return c.html(deletedDocRow().value);
  });

  app.delete('/documents/state/bulk', async (c) => {
    const body = await c.req.parseBody();
    const activityIri = String(body.activity_iri ?? '');
    const agentIfi = String(body.agent_ifi ?? '');
    const session = c.get('adminSession');

    if (!activityIri || !agentIfi) {
      return c.text('Activity IRI and Agent IFI are required', 400);
    }

    const count = await bulkDeleteStateDocuments(deps.pool, deps.metrics, activityIri, agentIfi);
    c.var.logger.info(
      { admin: session.username, action: 'document.bulkDelete', activityIri, agentIfi, count },
      'Bulk delete state documents',
    );
    return c.html(bulkDeleteResult(count).value);
  });
}
