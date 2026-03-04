import {
  Controller,
  Delete,
  Get,
  Header,
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
import type { Agent } from './types.js';
import { xapiVersionMiddleware } from './xapi-version.middleware.js';
import * as Q from './pg-xapi.queries.js';

@Route('xapi/activities')
@Tags('xAPI State')
@Middlewares(xapiVersionMiddleware)
@Security('jwt')
@Security('xapi_basic')
export class StateController extends Controller {
  constructor(private readonly ctx: RequestContext) {
    super();
  }

  @Get('/state')
  public async getState(
    @Query() activityId: string,
    @Query() agent: string,
    @Query() stateId?: string,
    @Query() registration?: string,
    @Query() since?: string,
    @Request() req?: ExpressRequest,
  ): Promise<readonly string[] | void> {
    const parsedAgent = this.parseAgent(agent);
    this.validateRegistration(registration);

    return this.ctx.asUser(async (client) => {
      if (stateId) {
        const doc = await Q.getStateDocument(client, activityId, parsedAgent, stateId, registration);
        if (!doc) throw new HttpError(404, 'NOT_FOUND', 'State document not found');
        const res = req?.res;
        if (res) {
          res.setHeader('ETag', doc.etag);
          res.setHeader('Last-Modified', doc.updatedAt.toUTCString());
          res.setHeader('Content-Type', doc.contentType);
          res.status(200).send(doc.content);
        }
        return;
      }

      return Q.getStateIds(client, activityId, parsedAgent, registration, since ? new Date(since) : undefined);
    });
  }

  @Put('/state')
  @SuccessResponse(204, 'No Content')
  public async putState(
    @Query() activityId: string,
    @Query() agent: string,
    @Query() stateId: string,
    @Query() registration?: string,
    @Header('If-Match') ifMatch?: string,
    @Header('If-None-Match') ifNoneMatch?: string,
    @Request() req?: ExpressRequest,
  ): Promise<void> {
    const parsedAgent = this.parseAgent(agent);
    this.validateRegistration(registration);

    const etag = await this.ctx.asUser(async (client) => {
      if (ifMatch || ifNoneMatch) {
        const existing = await Q.getStateDocument(client, activityId, parsedAgent, stateId, registration);
        this.checkConcurrency(existing?.etag, ifMatch, ifNoneMatch);
      }

      const content = (req?.body as Buffer | undefined) ?? Buffer.alloc(0);
      const contentType = req?.headers['content-type'] ?? 'application/octet-stream';
      return Q.setStateDocument(client, activityId, parsedAgent, stateId, content, contentType, registration);
    });
    this.setHeader('ETag', etag);
    this.setStatus(204);
  }

  @Post('/state')
  @SuccessResponse(204, 'No Content')
  public async postState(
    @Query() activityId: string,
    @Query() agent: string,
    @Query() stateId: string,
    @Query() registration?: string,
    @Header('If-Match') ifMatch?: string,
    @Header('If-None-Match') ifNoneMatch?: string,
    @Request() req?: ExpressRequest,
  ): Promise<void> {
    const parsedAgent = this.parseAgent(agent);
    this.validateRegistration(registration);

    const etag = await this.ctx.asUser(async (client) => {
      if (ifMatch || ifNoneMatch) {
        const existing = await Q.getStateDocument(client, activityId, parsedAgent, stateId, registration);
        this.checkConcurrency(existing?.etag, ifMatch, ifNoneMatch);
      }

      const content = (req?.body as Buffer | undefined) ?? Buffer.alloc(0);
      const contentType = req?.headers['content-type'] ?? 'application/octet-stream';
      return Q.mergeStateDocument(client, activityId, parsedAgent, stateId, content, contentType, registration);
    });
    this.setHeader('ETag', etag);
    this.setStatus(204);
  }

  @Delete('/state')
  @SuccessResponse(204, 'No Content')
  public async deleteState(
    @Query() activityId: string,
    @Query() agent: string,
    @Query() stateId?: string,
    @Query() registration?: string,
    @Header('If-Match') ifMatch?: string,
  ): Promise<void> {
    const parsedAgent = this.parseAgent(agent);
    this.validateRegistration(registration);

    await this.ctx.asUser(async (client) => {
      if (stateId) {
        if (ifMatch) {
          const existing = await Q.getStateDocument(client, activityId, parsedAgent, stateId, registration);
          this.checkConcurrency(existing?.etag, ifMatch, undefined);
        }
        await Q.deleteStateDocument(client, activityId, parsedAgent, stateId, registration);
      } else {
        await Q.deleteStateDocuments(client, activityId, parsedAgent, registration);
      }
    });
    this.setStatus(204);
  }

  private static readonly UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private validateRegistration(registration: string | undefined): void {
    if (registration !== undefined && !StateController.UUID_RE.test(registration)) {
      throw new HttpError(400, 'BAD_REQUEST', 'registration must be a valid UUID');
    }
  }

  private parseAgent(agentJson: string): Agent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(agentJson);
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON in agent query parameter');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new HttpError(400, 'BAD_REQUEST', 'Agent must be a JSON object');
    }
    return parsed as Agent;
  }

  private checkConcurrency(currentEtag: string | undefined, ifMatch?: string, ifNoneMatch?: string): void {
    if (ifMatch && currentEtag !== ifMatch) {
      throw new HttpError(412, 'PRECONDITION_FAILED', 'ETag does not match');
    }
    if (ifNoneMatch === '*' && currentEtag) {
      throw new HttpError(412, 'PRECONDITION_FAILED', 'Document already exists');
    }
  }
}
