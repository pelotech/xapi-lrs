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

@Route('xapi/agents')
@Tags('xAPI Agent Profile')
@Middlewares(xapiVersionMiddleware)
@Security('jwt')
@Security('xapi_basic')
export class AgentProfileController extends Controller {
  constructor(private readonly ctx: RequestContext) {
    super();
  }

  @Get('/profile')
  public async getAgentProfile(
    @Query() agent: string,
    @Query() profileId?: string,
    @Query() since?: string,
    @Request() req?: ExpressRequest,
  ): Promise<readonly string[] | void> {
    const parsedAgent = this.parseAgent(agent);

    return this.ctx.asUser(async (client) => {
      if (profileId) {
        const doc = await Q.getAgentProfileDocument(client, parsedAgent, profileId);
        if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Agent profile document not found');
        const res = req?.res;
        if (res) {
          res.setHeader('ETag', doc.etag);
          res.setHeader('Last-Modified', doc.updatedAt.toUTCString());
          res.setHeader('Content-Type', doc.contentType);
          res.status(200).send(doc.content);
        }
        return;
      }

      return Q.getAgentProfileIds(client, parsedAgent, since ? new Date(since) : undefined);
    });
  }

  @Put('/profile')
  @SuccessResponse(204, 'No Content')
  public async putAgentProfile(
    @Query() agent: string,
    @Query() profileId: string,
    @Header('If-Match') ifMatch?: string,
    @Header('If-None-Match') ifNoneMatch?: string,
    @Request() req?: ExpressRequest,
  ): Promise<void> {
    const parsedAgent = this.parseAgent(agent);

    const etag = await this.ctx.asUser(async (client) => {
      const existing = await Q.getAgentProfileDocument(client, parsedAgent, profileId);
      // xAPI spec: PUT always requires concurrency headers
      if (!ifMatch && !ifNoneMatch) {
        throw new HttpError(
          existing ? 409 : 400,
          existing ? 'CONFLICT' : 'BAD_REQUEST',
          'Agent Profile PUT requires If-Match or If-None-Match header for concurrency control',
        );
      }
      this.checkConcurrency(existing?.etag, ifMatch, ifNoneMatch);

      const content = (req?.body as Buffer | undefined) ?? Buffer.alloc(0);
      const contentType = req?.headers['content-type'] ?? 'application/octet-stream';
      return Q.setAgentProfileDocument(client, parsedAgent, profileId, content, contentType);
    });
    this.setHeader('ETag', etag);
    this.setStatus(204);
  }

  @Post('/profile')
  @SuccessResponse(204, 'No Content')
  public async postAgentProfile(
    @Query() agent: string,
    @Query() profileId: string,
    @Header('If-Match') ifMatch?: string,
    @Header('If-None-Match') ifNoneMatch?: string,
    @Request() req?: ExpressRequest,
  ): Promise<void> {
    const parsedAgent = this.parseAgent(agent);

    const etag = await this.ctx.asUser(async (client) => {
      if (ifMatch || ifNoneMatch) {
        const existing = await Q.getAgentProfileDocument(client, parsedAgent, profileId);
        this.checkConcurrency(existing?.etag, ifMatch, ifNoneMatch);
      }

      const content = (req?.body as Buffer | undefined) ?? Buffer.alloc(0);
      const contentType = req?.headers['content-type'] ?? 'application/octet-stream';
      return Q.mergeAgentProfileDocument(client, parsedAgent, profileId, content, contentType);
    });
    this.setHeader('ETag', etag);
    this.setStatus(204);
  }

  @Delete('/profile')
  @SuccessResponse(204, 'No Content')
  public async deleteAgentProfile(
    @Query() agent: string,
    @Query() profileId: string,
    @Header('If-Match') ifMatch?: string,
  ): Promise<void> {
    const parsedAgent = this.parseAgent(agent);

    await this.ctx.asUser(async (client) => {
      if (ifMatch) {
        const existing = await Q.getAgentProfileDocument(client, parsedAgent, profileId);
        this.checkConcurrency(existing?.etag, ifMatch, undefined);
      }

      await Q.deleteAgentProfileDocument(client, parsedAgent, profileId);
    });
    this.setStatus(204);
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
