/**
 * xAPI Statements Resource
 * POST/PUT/GET /xapi/statements
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { HonoEnv } from '../hono-env.ts';
import type { LrsDeps } from '../deps.ts';
import type { AuthInfo } from '../auth/types.ts';
import { HttpError, withClient } from '../db.ts';
import {
  insertStatement,
  insertStatements,
  getStatementById,
  queryStatements,
  voidStatement,
  getConsistentThrough,
} from '../repositories/statements.ts';
import { insertAttachment, getAttachmentsByStatement } from '../repositories/attachments.ts';
import { canonicalAgentIfi, validateSince, validateRegistration } from '../helpers/agent.ts';
import { enrichStatement, formatStatement, buildAuthority } from '../helpers/enrichment.ts';
import { validateStatement, statementsMatch } from '../xapi/statement-validator.ts';
import { buildMultipartResponse } from '../xapi/multipart.ts';
import type { MultipartAttachmentPart, ResponseAttachmentPart } from '../xapi/multipart.ts';
import { validateSignedStatements } from '../xapi/signature.ts';

const VOIDED_VERB_ID = 'http://adlnet.gov/expapi/verbs/voided';

// ============================================================================
// OpenAPI route definitions (for doc generation)
// ============================================================================

const postStatementsRoute = createRoute({
  method: 'post',
  path: '/statements',
  operationId: 'PostStatements',
  tags: ['xAPI Statements'],
  security: [{ basic: [] }, { jwt: [] }],
  responses: {
    200: {
      description: 'Ok',
      content: { 'application/json': { schema: z.array(z.string()) } },
    },
  },
});

const putStatementRoute = createRoute({
  method: 'put',
  path: '/statements',
  operationId: 'PutStatement',
  tags: ['xAPI Statements'],
  security: [{ basic: [] }, { jwt: [] }],
  request: { query: z.object({ statementId: z.string() }) },
  responses: { 204: { description: 'No content' } },
});

const getStatementsRoute = createRoute({
  method: 'get',
  path: '/statements',
  operationId: 'GetStatements',
  tags: ['xAPI Statements'],
  security: [{ basic: [] }, { jwt: [] }],
  request: {
    query: z.object({
      statementId: z.string().optional(),
      voidedStatementId: z.string().optional(),
      agent: z.string().optional(),
      verb: z.string().optional(),
      activity: z.string().optional(),
      registration: z.string().optional(),
      related_activities: z.coerce.boolean().optional(),
      related_agents: z.coerce.boolean().optional(),
      format: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.coerce.number().optional(),
      ascending: z.coerce.boolean().optional(),
      attachments: z.coerce.boolean().optional(),
    }),
  },
  responses: { 204: { description: 'No content' } },
});

// ============================================================================
// Route app
// ============================================================================

export function createStatementsApp() {
  const app = new OpenAPIHono<HonoEnv>();

  // POST /xapi/statements
  app.openapi(postStatementsRoute, async (c) => {
    const deps = c.var.deps;
    const auth = c.var.auth;
    const { pool, metrics } = deps;

    const rawBody = c.var.parsedBody as unknown;
    const rawArray = Array.isArray(rawBody) ? rawBody : [rawBody];
    const attachmentParts = c.var.attachmentParts;

    // Validate ALL statements first (batch atomicity)
    const validated: Record<string, unknown>[] = [];
    for (const raw of rawArray) {
      const result = validateStatement(raw);
      if (!result.valid) {
        throw new HttpError(400, result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      }
      validated.push(result.statement as unknown as Record<string, unknown>);
    }

    // Validate multipart attachment data
    if (attachmentParts) {
      await validateAttachmentParts(validated, attachmentParts, deps);
    }

    const authority = authorityFromAuth(auth);

    const ids = await withClient(pool, metrics, async (client) => {
      for (const stmt of validated) {
        const verbId = (stmt.verb as Record<string, unknown>)?.id as string | undefined;
        if (verbId === VOIDED_VERB_ID) {
          await handleVoiding(client, stmt);
        }
      }

      metrics.statementsReceived.add(validated.length, { method: 'POST' });
      const results = await insertStatements(client, validated, authority);

      for (let i = 0; i < results.length; i++) {
        if (!results[i].inserted) {
          const existing = await getStatementById(client, validated[i].id as string);
          if (existing && !statementsMatch(existing.payload, validated[i])) {
            throw new HttpError(409, 'Statement already exists with different content');
          }
        }
      }

      if (attachmentParts) {
        for (const stmt of validated) {
          const stmtId = stmt.id as string;
          const atts = stmt.attachments as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(atts)) continue;
          for (const att of atts) {
            const sha2 = att.sha2 as string;
            const part = attachmentParts.get(sha2);
            if (part) {
              await insertAttachment(client, { statementId: stmtId, sha2, contentType: part.contentType, data: part.data });
            }
          }
        }
      }

      return validated.map((s) => s.id as string);
    });

    return c.json(ids, 200);
  });

  // PUT /xapi/statements
  app.openapi(putStatementRoute, async (c) => {
    const deps = c.var.deps;
    const auth = c.var.auth;
    const { pool, metrics } = deps;
    const statementId = c.req.query('statementId')!;
    const attachmentParts = c.var.attachmentParts;

    const raw = (c.var.parsedBody ?? {}) as Record<string, unknown>;
    if (!raw.id) raw.id = statementId;

    const validationResult = validateStatement(raw);
    if (!validationResult.valid) {
      throw new HttpError(400, validationResult.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    }
    const stmt = validationResult.statement as unknown as Record<string, unknown>;

    if (attachmentParts) {
      await validateAttachmentParts([stmt], attachmentParts, deps);
    }

    if (stmt.id !== statementId) {
      throw new HttpError(409, 'Statement id does not match statementId parameter');
    }

    const verbId = (stmt.verb as Record<string, unknown>)?.id as string | undefined;
    const authority = authorityFromAuth(auth);

    await withClient(pool, metrics, async (client) => {
      metrics.statementsReceived.add(1, { method: 'PUT' });

      const existing = await getStatementById(client, statementId);
      if (existing) {
        if (!statementsMatch(existing.payload, stmt)) {
          throw new HttpError(409, 'Statement already exists with different content');
        }
        return;
      }

      if (verbId === VOIDED_VERB_ID) {
        await handleVoiding(client, stmt);
      }

      await insertStatement(client, stmt, authority);

      if (attachmentParts) {
        const atts = stmt.attachments as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(atts)) {
          for (const att of atts) {
            const sha2 = att.sha2 as string;
            const part = attachmentParts.get(sha2);
            if (part) {
              await insertAttachment(client, { statementId, sha2, contentType: part.contentType, data: part.data });
            }
          }
        }
      }
    });

    return c.body(null, 204);
  });

  // Middleware: set X-Experience-API-Consistent-Through on ALL GET /statements responses
  // (including errors). Must run before the route handler so it applies to error responses.
  app.use('/statements', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    const { pool, metrics } = c.var.deps;
    const consistentThrough = await withClient(pool, metrics, (client) => getConsistentThrough(client));
    await next();
    c.res.headers.set('X-Experience-API-Consistent-Through', consistentThrough);
  });

  // GET /xapi/statements
  app.openapi(getStatementsRoute, async (c) => {
    const deps = c.var.deps;
    const { pool, metrics } = deps;

    const statementId = c.req.query('statementId');
    const voidedStatementId = c.req.query('voidedStatementId');
    const agent = c.req.query('agent');
    const verb = c.req.query('verb');
    const activity = c.req.query('activity');
    const registration = c.req.query('registration');
    const related_activities = c.req.query('related_activities') === 'true';
    const related_agents = c.req.query('related_agents') === 'true';
    const format = c.req.query('format');
    const since = c.req.query('since');
    const until = c.req.query('until');
    const limitStr = c.req.query('limit');
    const limit = limitStr ? Number(limitStr) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      throw new HttpError(400, 'limit must be a positive integer');
    }
    const ascending = c.req.query('ascending') === 'true';
    const attachments = c.req.query('attachments') === 'true';

    // Reject unknown query params
    const url = new URL(c.req.url);
    for (const key of url.searchParams.keys()) {
      if (!STATEMENTS_KNOWN_PARAMS.has(key)) {
        throw new HttpError(400, `Unknown query parameter: ${key}`);
      }
    }

    validateSince(since);
    validateSince(until);
    validateRegistration(registration);
    if (agent) canonicalAgentIfi(agent);

    if (statementId && voidedStatementId) {
      throw new HttpError(400, 'Cannot use both statementId and voidedStatementId');
    }

    const effectiveFormat = format ?? 'exact';
    if (effectiveFormat !== 'exact' && effectiveFormat !== 'ids' && effectiveFormat !== 'canonical') {
      throw new HttpError(400, 'format must be one of: ids, exact, canonical');
    }

    if (statementId || voidedStatementId) {
      if (
        agent !== undefined ||
        verb !== undefined ||
        activity !== undefined ||
        registration !== undefined ||
        c.req.query('related_activities') !== undefined ||
        c.req.query('related_agents') !== undefined ||
        since !== undefined ||
        until !== undefined ||
        limitStr !== undefined ||
        c.req.query('ascending') !== undefined
      ) {
        throw new HttpError(400, 'Cannot combine statementId or voidedStatementId with other filter parameters');
      }
    }

    const acceptLanguage = c.req.header('accept-language');

    return withClient(pool, metrics, async (client) => {
      if (statementId) {
        const row = await getStatementById(client, statementId);
        if (!row || row.is_voided) {
          throw new HttpError(404, 'Statement not found');
        }
        const stmt = formatStatement(enrichStatement(row), effectiveFormat, acceptLanguage);
        if (attachments) {
          const parts = await collectAttachmentParts(client, stmt);
          return buildMultipartResponse(stmt, parts);
        }
        return c.json(stmt, 200);
      }

      if (voidedStatementId) {
        const row = await getStatementById(client, voidedStatementId);
        if (!row || !row.is_voided) {
          throw new HttpError(404, 'Voided statement not found');
        }
        const stmt = formatStatement(enrichStatement(row), effectiveFormat, acceptLanguage);
        if (attachments) {
          const parts = await collectAttachmentParts(client, stmt);
          return buildMultipartResponse(stmt, parts);
        }
        return c.json(stmt, 200);
      }

      const { rows, hasMore } = await queryStatements(client, {
        agent,
        verb,
        activity,
        registration,
        related_activities,
        related_agents,
        since,
        until,
        limit,
        ascending,
      });

      const statements = rows.map((row) => formatStatement(enrichStatement(row), effectiveFormat, acceptLanguage));
      const result: { statements: unknown[]; more: string } = { statements, more: '' };

      if (hasMore) {
        const lastRow = rows.at(-1)!;
        const moreParams = new URLSearchParams();
        if (agent) moreParams.set('agent', agent);
        if (verb) moreParams.set('verb', verb);
        if (activity) moreParams.set('activity', activity);
        if (registration) moreParams.set('registration', registration);
        if (related_activities) moreParams.set('related_activities', 'true');
        if (related_agents) moreParams.set('related_agents', 'true');
        if (limit) moreParams.set('limit', limit.toString());
        if (effectiveFormat !== 'exact') moreParams.set('format', effectiveFormat);

        const lastStored = lastRow.payload.stored as string;
        if (ascending) {
          moreParams.set('ascending', 'true');
          moreParams.set('since', lastStored);
          if (until) moreParams.set('until', until);
        } else {
          moreParams.set('until', lastStored);
          if (since) moreParams.set('since', since);
        }

        result.more = `/xapi/statements?${moreParams.toString()}`;
      }

      if (attachments) {
        const parts = await collectAttachmentPartsFromList(client, statements);
        return buildMultipartResponse(result, parts);
      }

      return c.json(result, 200);
    });
  });

  return app;
}

// ============================================================================
// Helpers
// ============================================================================

const STATEMENTS_KNOWN_PARAMS = new Set([
  'statementId',
  'voidedStatementId',
  'agent',
  'verb',
  'activity',
  'registration',
  'related_activities',
  'related_agents',
  'format',
  'since',
  'until',
  'limit',
  'ascending',
  'attachments',
]);

async function handleVoiding(client: import('pg').PoolClient, stmt: Record<string, unknown>): Promise<void> {
  const obj = stmt.object as Record<string, unknown> | undefined;
  const targetId = obj?.id as string | undefined;
  const objectType = obj?.objectType as string | undefined;

  if (objectType !== 'StatementRef' || !targetId) {
    throw new HttpError(400, 'Voiding statement must reference a StatementRef');
  }

  const target = await getStatementById(client, targetId);
  if (target) {
    const targetVerb = (target.payload as Record<string, unknown>).verb as Record<string, unknown>;
    if (targetVerb?.id === VOIDED_VERB_ID) {
      throw new HttpError(400, 'Cannot void a voiding statement');
    }
  }

  await voidStatement(client, targetId);
}

async function validateAttachmentParts(
  statements: Record<string, unknown>[],
  parts: Map<string, MultipartAttachmentPart>,
  deps: LrsDeps,
): Promise<void> {
  const allHashes = new Set<string>();
  const requiredHashes = new Set<string>();
  for (const stmt of statements) {
    const atts = stmt.attachments as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(atts)) continue;
    for (const att of atts) {
      if (att.sha2) {
        allHashes.add(att.sha2 as string);
        if (!att.fileUrl) {
          requiredHashes.add(att.sha2 as string);
        }
      }
    }
  }

  for (const sha2 of parts.keys()) {
    if (!allHashes.has(sha2)) {
      throw new HttpError(400, `Excess multipart section with hash ${sha2} does not match any statement attachment`);
    }
  }

  for (const sha2 of requiredHashes) {
    if (!parts.has(sha2)) {
      throw new HttpError(400, `Missing binary data for attachment with sha2 ${sha2}`);
    }
  }

  for (const [sha2, part] of parts) {
    const actualHash = createHash('sha256').update(part.data).digest('hex');
    if (actualHash !== sha2) {
      throw new HttpError(400, `Attachment hash mismatch: expected ${sha2}, got ${actualHash}`);
    }
  }

  await validateSignedStatements(statements, parts, {
    verifySignatures: deps.xapiVerifySignatures,
    logger: deps.logger,
  });
}

function authorityFromAuth(auth: AuthInfo): Record<string, unknown> {
  if (auth.type === 'basic') {
    return buildAuthority(auth.payload.accountName);
  }
  return {
    objectType: 'Agent',
    account: { homePage: auth.payload.iss, name: auth.payload.sub },
  };
}

async function collectAttachmentParts(
  client: import('pg').PoolClient,
  stmt: unknown,
): Promise<ResponseAttachmentPart[]> {
  const parts: ResponseAttachmentPart[] = [];
  const stmtObj = stmt as Record<string, unknown>;
  const stmtId = stmtObj.id as string | undefined;
  if (!stmtId) return parts;

  const rows = await getAttachmentsByStatement(client, stmtId);
  for (const row of rows) {
    parts.push({
      sha2: row.attachment_sha,
      contentType: row.content_type,
      stream: Readable.from(row.contents),
    });
  }
  return parts;
}

async function collectAttachmentPartsFromList(
  client: import('pg').PoolClient,
  statements: unknown[],
): Promise<ResponseAttachmentPart[]> {
  const parts: ResponseAttachmentPart[] = [];
  const seen = new Set<string>();
  for (const stmt of statements) {
    for (const part of await collectAttachmentParts(client, stmt)) {
      if (!seen.has(part.sha2)) {
        seen.add(part.sha2);
        parts.push(part);
      }
    }
  }
  return parts;
}
