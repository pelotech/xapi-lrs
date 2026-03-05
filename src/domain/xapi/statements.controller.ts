import {
  Controller,
  Get,
  Middlewares,
  Post,
  Put,
  Query,
  Request,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from '@tsoa/runtime';
import type { Request as ExpressRequest } from 'express';
import type { RequestContext } from '../../core/context.js';
import { HttpError } from '../../core/errors.js';
import type { Agent, Attachment, Statement, StatementFormat, StatementResult } from './types.js';
import { validateStatement, validateStatementBatch } from './statement.schema.js';
import { xapiVersionMiddleware } from './xapi-version.middleware.js';
import { decodeCursor } from './pg-xapi.queries.js';
import * as Q from './pg-xapi.queries.js';
import { collectActivityIds, formatStatement, formatStatements } from './statement-format.js';
import { extractBoundary, parseMultipartRequest, buildMultipartResponse } from './multipart.js';
import type { AttachmentBlob } from './multipart.js';
import { hasDefineScope } from './xapi-scopes.js';
import { actorToIfi } from './agent-ifi.js';
import { compactVerify, importX509 } from 'jose';

@Route('xapi')
@Tags('xAPI Statements')
@Middlewares(xapiVersionMiddleware)
@Security('jwt')
@Security('xapi_basic')
export class StatementsController extends Controller {
  constructor(private readonly ctx: RequestContext) {
    super();
  }

  /**
   * GET /xapi/statements
   *
   * Fetch a single Statement by id, a single voided Statement, or a filtered
   * set of Statements. When fetching by id, returns a single Statement.
   * Otherwise returns a StatementResult with pagination.
   */
  @Get('/statements')
  public async getStatements(
    @Query() statementId?: string,
    @Query() voidedStatementId?: string,
    @Query() agent?: string,
    @Query() verb?: string,
    @Query() activity?: string,
    @Query() registration?: string,
    @Query() related_activities?: boolean,
    @Query() related_agents?: boolean,
    @Query() since?: string,
    @Query() until?: string,
    @Query() limit?: number,
    @Query() format?: StatementFormat,
    @Query() attachments?: boolean,
    @Query() ascending?: boolean,
    @Query() cursor?: string,
    @Request() req?: ExpressRequest,
  ): Promise<StatementResult | Statement> {
    if (statementId && voidedStatementId) {
      throw new HttpError(
        400,
        'BAD_REQUEST',
        'Cannot specify both statementId and voidedStatementId',
      );
    }

    if (statementId ?? voidedStatementId) {
      // xAPI §2.1.3: when fetching by id, only 'attachments' and 'format' are allowed
      if (
        agent !== undefined || verb !== undefined || activity !== undefined ||
        registration !== undefined || related_activities !== undefined ||
        related_agents !== undefined || since !== undefined || until !== undefined ||
        ascending !== undefined || limit !== undefined || cursor !== undefined
      ) {
        throw new HttpError(
          400,
          'BAD_REQUEST',
          'Cannot combine statementId/voidedStatementId with other filter parameters',
        );
      }
    }

    // Validate cursor early so a bad value surfaces as 400, not 500
    if (cursor) {
      try {
        decodeCursor(cursor);
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid cursor');
      }
    }

    // Parse agent JSON with proper error handling
    let parsedAgent: Agent | undefined;
    if (agent) {
      let raw: unknown;
      try {
        raw = JSON.parse(agent);
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON in agent query parameter');
      }
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new HttpError(400, 'BAD_REQUEST', 'Agent must be a JSON object');
      }
      parsedAgent = raw as Agent;
    }

    const effectiveFormat = format ?? 'exact';
    const acceptLanguage = req?.get('Accept-Language');

    return this.ctx.asUser(async (client) => {
      // xAPI 1.0.3 §2.1.3: MUST include on all Statements Resource responses
      const consistentThrough = await Q.getConsistentThrough(client);
      this.setHeader('X-Experience-API-Consistent-Through', consistentThrough);

      // Single statement by id
      if (statementId) {
        const stmt = await Q.getStatement(client, statementId);
        if (!stmt) throw new HttpError(404, 'NOT_FOUND', 'Statement not found');
        // statements/read/mine: reject if statement authority doesn't match credential
        if (this.ctx.xapiReadMineOnly && this.ctx.xapiCredentialIfi) {
          const stmtAuthority = stmt.authority;
          const authorityIfi = stmtAuthority ? actorToIfi(stmtAuthority as import('./types.js').Actor) : null;
          if (authorityIfi !== this.ctx.xapiCredentialIfi) {
            throw new HttpError(403, 'AUTH_ERROR', 'Insufficient scope: statement not issued by this credential');
          }
        }
        if (stmt.stored) {
          req?.res?.setHeader('Last-Modified', new Date(stmt.stored).toUTCString());
        }
        const canonicalDefs = effectiveFormat === 'canonical'
          ? await Q.getActivitiesBatch(client, collectActivityIds(stmt))
          : undefined;
        const formatted = formatStatement(stmt, effectiveFormat, acceptLanguage, canonicalDefs);

        if (attachments) {
          await this.sendMultipartResponse(formatted, [formatted], req, client);
          return formatted; // return value won't be used — response already sent
        }

        return formatted;
      }

      // Voided statement by id
      if (voidedStatementId) {
        const stmt = await Q.getVoidedStatement(client, voidedStatementId);
        if (!stmt) throw new HttpError(404, 'NOT_FOUND', 'Voided statement not found');
        if (stmt.stored) {
          req?.res?.setHeader('Last-Modified', new Date(stmt.stored).toUTCString());
        }
        const canonicalDefs = effectiveFormat === 'canonical'
          ? await Q.getActivitiesBatch(client, collectActivityIds(stmt))
          : undefined;
        return formatStatement(stmt, effectiveFormat, acceptLanguage, canonicalDefs);
      }

      const queryOptions = this.ctx.xapiReadMineOnly && this.ctx.xapiCredentialIfi
        ? { authorityIfi: this.ctx.xapiCredentialIfi }
        : undefined;

      const result = await Q.queryStatements(client, {
        agent: parsedAgent,
        verb,
        activity,
        registration,
        related_activities,
        related_agents,
        since,
        until,
        limit,
        format,
        attachments,
        ascending,
        cursor,
      }, queryOptions);

      const canonicalDefs = effectiveFormat === 'canonical'
        ? await Q.getActivitiesBatch(client, result.statements.flatMap(collectActivityIds))
        : undefined;

      const formatted = {
        ...result,
        statements: formatStatements(result.statements, effectiveFormat, acceptLanguage, canonicalDefs),
      };

      // Make more URL absolute (§2.1.3: more MUST be an IRL)
      let finalResult = formatted;
      if (formatted.more && req) {
        const host = req.get('host') ?? 'localhost';
        const proto = req.protocol;
        finalResult = { ...formatted, more: `${proto}://${host}${formatted.more}` };
      }

      // §4.1.11: When attachments=true, respond with multipart/mixed
      if (attachments) {
        await this.sendMultipartResponse(finalResult, finalResult.statements as Statement[], req, client);
        return finalResult; // return value won't be used — response already sent
      }

      return finalResult;
    });
  }

  /**
   * Send a multipart/mixed response containing statements + attachment blobs.
   * The `jsonPayload` is either a single Statement (by id) or a StatementResult.
   */
  private async sendMultipartResponse(
    jsonPayload: unknown,
    statements: readonly Statement[],
    req: ExpressRequest | undefined,
    client: Q.Queryable,
  ): Promise<void> {
    // Collect all unique sha2 hashes from statement attachments.
    // Include fileUrl attachments too — if the client sent raw data during POST,
    // we stored it and should return it when attachments=true is requested.
    const sha2Set = new Set<string>();
    for (const stmt of statements) {
      if (stmt.attachments) {
        for (const att of stmt.attachments) {
          sha2Set.add(att.sha2);
        }
      }
    }

    // Fetch attachment blobs via AssetStore
    const blobs: AttachmentBlob[] = [];
    if (sha2Set.size > 0) {
      const metaRows = await Q.getAttachmentMetaBatch(client, [...sha2Set]);
      for (const row of metaRows) {
        const stream = await this.ctx.assetStore.getStream(`xapi/attachments/${row.sha2}`);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        blobs.push({ sha2: row.sha2, contentType: row.content_type, content: Buffer.concat(chunks) });
      }
    }

    const jsonBuf = Buffer.from(JSON.stringify(jsonPayload));
    const { body, boundary } = buildMultipartResponse(jsonBuf, blobs);

    const res = req?.res;
    if (res) {
      // Copy headers already set via this.setHeader() (CT, version, etc.)
      const tsoaHeaders = this.getHeaders();
      for (const [key, value] of Object.entries(tsoaHeaders)) {
        if (value !== undefined) res.setHeader(key, value as string);
      }
      res.setHeader('Content-Type', `multipart/mixed; boundary=${boundary}`);
      res.status(200).send(body);
    }
  }

  /**
   * PUT /xapi/statements?statementId={id}
   *
   * Store a single Statement with the given id. The id in the query string
   * must match the Statement's id property (if present).
   *
   * Uses @Request() instead of @Body() to bypass TSOA's type coercion —
   * xAPI requires strict type validation (e.g. reject "100" where number expected).
   */
  @Put('/statements')
  @SuccessResponse(204, 'No Content')
  public async putStatement(
    @Query() statementId: string,
    @Request() req: ExpressRequest,
  ): Promise<void> {
    const validated = validateStatement(req.body);

    if (validated.id && validated.id !== statementId) {
      throw new HttpError(
        400,
        'BAD_REQUEST',
        'Statement id in body does not match statementId query parameter',
      );
    }

    const stmtWithId = validated.id ? validated : { ...validated, id: statementId };
    const skipDefine = !hasDefineScope(this.ctx.xapiGrantedScopes ?? []);
    await this.ctx.asUser(async (client) => {
      await Q.storeStatements(client, [stmtWithId], this.ctx.xapiAuthority, { skipDefine });
    });
    this.setHeader('X-Experience-API-Consistent-Through', new Date().toISOString());
    this.setStatus(204);
  }

  /**
   * POST /xapi/statements
   *
   * Store a single Statement or an array of Statements.
   * Returns an array of Statement UUIDs in the same order as submitted.
   * Supports both application/json and multipart/mixed (for attachments).
   *
   * Uses @Request() instead of @Body() to bypass TSOA's type coercion —
   * xAPI requires strict type validation (e.g. reject "100" where number expected).
   */
  @Post('/statements')
  @SuccessResponse(200, 'OK')
  public async postStatements(
    @Request() req: ExpressRequest,
  ): Promise<readonly string[]> {
    const contentType = req.headers['content-type'] ?? '';

    // Handle multipart/mixed (xAPI attachments)
    if (contentType.startsWith('multipart/mixed')) {
      return this.handleMultipartPost(req);
    }

    const batch = validateStatementBatch(req.body);

    const ids = batch.map((s) => s.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'BAD_REQUEST', 'Batch contains duplicate statement ids');
    }

    const skipDefine = !hasDefineScope(this.ctx.xapiGrantedScopes ?? []);
    const result = await this.ctx.asUser(async (client) => {
      return Q.storeStatements(client, batch, this.ctx.xapiAuthority, { skipDefine });
    });
    this.setHeader('X-Experience-API-Consistent-Through', new Date().toISOString());
    return result;
  }

  /**
   * Handle a multipart/mixed POST with attachment blobs.
   * Validates per xAPI §1.5.2 / §2.4.11:
   *  - First part must be application/json
   *  - Attachment parts must have Content-Transfer-Encoding: binary
   *  - Attachment parts must have X-Experience-API-Hash matching a statement sha2
   *  - No excess parts (parts not matching any declared attachment)
   *  - No missing attachments (sha2 declared but no matching part, unless fileUrl)
   */
  private async handleMultipartPost(req: ExpressRequest): Promise<readonly string[]> {
    const contentType = req.headers['content-type'] ?? '';
    const boundary = extractBoundary(contentType);
    if (!boundary) {
      throw new HttpError(400, 'BAD_REQUEST', 'Missing boundary in multipart/mixed Content-Type');
    }

    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      throw new HttpError(400, 'BAD_REQUEST', 'Expected raw body for multipart/mixed request');
    }

    const parsed = parseMultipartRequest(rawBody, boundary);

    // Validate first part Content-Type is application/json
    if (!parsed.jsonContentType.startsWith('application/json')) {
      throw new HttpError(400, 'BAD_REQUEST', 'First part of multipart/mixed must have Content-Type application/json');
    }

    // Validate attachment parts have required headers
    for (const att of parsed.attachments) {
      if (att.transferEncoding !== 'binary') {
        throw new HttpError(400, 'BAD_REQUEST', 'Attachment parts must have Content-Transfer-Encoding: binary');
      }
      if (!att.sha2) {
        throw new HttpError(400, 'BAD_REQUEST', 'Attachment parts must have X-Experience-API-Hash header');
      }
    }

    // Parse the JSON part (first part)
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(parsed.json.toString('utf8'));
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON in multipart statement part');
    }

    const batch = validateStatementBatch(jsonBody);

    // Collect declared sha2 hashes: all sha2s and those requiring raw data (no fileUrl)
    const allDeclaredSha2s = new Set<string>();
    const requiredSha2s = new Set<string>();
    for (const stmt of batch) {
      if (stmt.attachments) {
        for (const att of stmt.attachments as Attachment[]) {
          allDeclaredSha2s.add(att.sha2);
          if (!att.fileUrl) requiredSha2s.add(att.sha2);
        }
      }
    }

    // Validate attachment hashes match declared sha2s (no excess)
    // Note: parts matching fileUrl attachments are allowed — clients may include raw data
    for (const att of parsed.attachments) {
      if (!allDeclaredSha2s.has(att.sha2)) {
        throw new HttpError(400, 'BAD_REQUEST', `Attachment part hash "${att.sha2}" does not match any declared attachment sha2`);
      }
    }

    // Validate no missing raw attachments (sha2 declared without fileUrl but no matching part)
    const partSha2s = new Set(parsed.attachments.map((a) => a.sha2));
    for (const sha2 of requiredSha2s) {
      if (!partSha2s.has(sha2)) {
        throw new HttpError(400, 'BAD_REQUEST', `Missing attachment data for sha2 "${sha2}"`);
      }
    }

    // Validate JWS signed statement attachments (§2.6)
    await this.validateSignedStatements(batch, parsed.attachments);

    const ids = batch.map((s) => s.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'BAD_REQUEST', 'Batch contains duplicate statement ids');
    }

    // Store attachment binary data via AssetStore (outside the DB transaction)
    for (const att of parsed.attachments) {
      if (att.sha2) {
        await this.ctx.assetStore.put(`xapi/attachments/${att.sha2}`, att.content);
      }
    }

    const skipDefine = !hasDefineScope(this.ctx.xapiGrantedScopes ?? []);
    const result = await this.ctx.asUser(async (client) => {
      // Store attachment metadata in DB
      for (const att of parsed.attachments) {
        if (att.sha2) {
          await Q.storeAttachmentMeta(client, att.sha2, att.contentType);
        }
      }

      return Q.storeStatements(client, batch, this.ctx.xapiAuthority, { skipDefine });
    });
    this.setHeader('X-Experience-API-Consistent-Through', new Date().toISOString());
    return result;
  }

  /**
   * Validate JWS signed statement requirements per xAPI §2.6.
   * Performs full cryptographic signature verification using the x5c certificate chain.
   */
  private async validateSignedStatements(
    batch: readonly Statement[],
    attachmentParts: ReadonlyArray<{ sha2: string; contentType: string; content: Buffer }>,
  ): Promise<void> {
    const SIGNATURE_USAGE_TYPE = 'http://adlnet.gov/expapi/attachments/signature';
    const VALID_JWS_ALGORITHMS = new Set(['RS256', 'RS384', 'RS512']);

    // Build a map from sha2 → part for quick lookup
    const partBySha2 = new Map<string, { contentType: string; content: Buffer }>();
    for (const part of attachmentParts) {
      partBySha2.set(part.sha2, part);
    }

    for (const stmt of batch) {
      if (!stmt.attachments) continue;
      for (const att of stmt.attachments as Attachment[]) {
        if (att.usageType !== SIGNATURE_USAGE_TYPE) continue;

        // §2.6.s4.b1: Signature attachment must have contentType application/octet-stream
        if (att.contentType !== 'application/octet-stream') {
          throw new HttpError(400, 'BAD_REQUEST', 'Signed statement signature attachment must have contentType "application/octet-stream"');
        }

        const part = partBySha2.get(att.sha2);
        if (!part) continue; // missing part is caught by earlier validation

        // Parse JWS (compact serialization: header.payload.signature)
        const jwsStr = part.content.toString('utf8');
        const jwsParts = jwsStr.split('.');
        if (jwsParts.length !== 3) {
          throw new HttpError(400, 'BAD_REQUEST', 'Invalid JWS: expected three dot-separated parts');
        }

        // Decode and validate header
        let header: Record<string, unknown>;
        try {
          header = JSON.parse(Buffer.from(jwsParts[0]!, 'base64url').toString('utf8'));
        } catch {
          throw new HttpError(400, 'BAD_REQUEST', 'Invalid JWS: cannot decode header');
        }

        // §2.6.s4.b4: Algorithm must be RS256, RS384, or RS512
        const alg = header.alg;
        if (typeof alg !== 'string' || !VALID_JWS_ALGORITHMS.has(alg)) {
          throw new HttpError(400, 'BAD_REQUEST', `Invalid JWS: algorithm "${String(alg)}" not allowed; must be RS256, RS384, or RS512`);
        }

        // §2.6.s4.b2: x5c header must be present with at least one certificate
        const x5c = header.x5c;
        if (!Array.isArray(x5c) || x5c.length === 0) {
          throw new HttpError(400, 'BAD_REQUEST', 'Invalid JWS: x5c header must contain at least one certificate');
        }

        // Import the signing certificate (first entry in x5c chain) and verify the signature
        const certDer = x5c[0] as string;
        const pem = `-----BEGIN CERTIFICATE-----\n${certDer}\n-----END CERTIFICATE-----`;
        let publicKey: CryptoKey;
        try {
          publicKey = await importX509(pem, alg);
        } catch {
          throw new HttpError(400, 'BAD_REQUEST', 'Invalid JWS: cannot import x5c certificate');
        }

        try {
          await compactVerify(jwsStr, publicKey, { algorithms: ['RS256', 'RS384', 'RS512'] });
        } catch {
          throw new HttpError(400, 'BAD_REQUEST', 'Invalid JWS: signature verification failed');
        }
      }
    }
  }
}
