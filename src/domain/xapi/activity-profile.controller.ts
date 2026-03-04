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
import { xapiVersionMiddleware } from './xapi-version.middleware.js';
import * as Q from './pg-xapi.queries.js';

@Route('xapi/activities')
@Tags('xAPI Activity Profile')
@Middlewares(xapiVersionMiddleware)
@Security('jwt')
@Security('xapi_basic')
export class ActivityProfileController extends Controller {
  constructor(private readonly ctx: RequestContext) {
    super();
  }

  @Get('/profile')
  public async getActivityProfile(
    @Query() activityId: string,
    @Query() profileId?: string,
    @Query() since?: string,
    @Request() req?: ExpressRequest,
  ): Promise<readonly string[] | void> {
    return this.ctx.asUser(async (client) => {
      if (profileId) {
        const doc = await Q.getActivityProfileDocument(client, activityId, profileId);
        if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Activity profile document not found');
        const res = req?.res;
        if (res) {
          res.setHeader('ETag', doc.etag);
          res.setHeader('Last-Modified', doc.updatedAt.toUTCString());
          res.setHeader('Content-Type', doc.contentType);
          res.status(200).send(doc.content);
        }
        return;
      }

      return Q.getActivityProfileIds(client, activityId, since ? new Date(since) : undefined);
    });
  }

  @Put('/profile')
  @SuccessResponse(204, 'No Content')
  public async putActivityProfile(
    @Query() activityId: string,
    @Query() profileId: string,
    @Header('If-Match') ifMatch?: string,
    @Header('If-None-Match') ifNoneMatch?: string,
    @Request() req?: ExpressRequest,
  ): Promise<void> {
    const etag = await this.ctx.asUser(async (client) => {
      const existing = await Q.getActivityProfileDocument(client, activityId, profileId);
      // xAPI spec: PUT always requires concurrency headers
      if (!ifMatch && !ifNoneMatch) {
        throw new HttpError(
          existing ? 409 : 400,
          existing ? 'CONFLICT' : 'BAD_REQUEST',
          'Activity Profile PUT requires If-Match or If-None-Match header for concurrency control',
        );
      }
      this.checkConcurrency(existing?.etag, ifMatch, ifNoneMatch);

      const content = (req?.body as Buffer | undefined) ?? Buffer.alloc(0);
      const contentType = req?.headers['content-type'] ?? 'application/octet-stream';
      return Q.setActivityProfileDocument(client, activityId, profileId, content, contentType);
    });
    this.setHeader('ETag', etag);
    this.setStatus(204);
  }

  @Post('/profile')
  @SuccessResponse(204, 'No Content')
  public async postActivityProfile(
    @Query() activityId: string,
    @Query() profileId: string,
    @Header('If-Match') ifMatch?: string,
    @Header('If-None-Match') ifNoneMatch?: string,
    @Request() req?: ExpressRequest,
  ): Promise<void> {
    const etag = await this.ctx.asUser(async (client) => {
      if (ifMatch || ifNoneMatch) {
        const existing = await Q.getActivityProfileDocument(client, activityId, profileId);
        this.checkConcurrency(existing?.etag, ifMatch, ifNoneMatch);
      }

      const content = (req?.body as Buffer | undefined) ?? Buffer.alloc(0);
      const contentType = req?.headers['content-type'] ?? 'application/octet-stream';
      return Q.mergeActivityProfileDocument(client, activityId, profileId, content, contentType);
    });
    this.setHeader('ETag', etag);
    this.setStatus(204);
  }

  @Delete('/profile')
  @SuccessResponse(204, 'No Content')
  public async deleteActivityProfile(
    @Query() activityId: string,
    @Query() profileId: string,
    @Header('If-Match') ifMatch?: string,
  ): Promise<void> {
    await this.ctx.asUser(async (client) => {
      if (ifMatch) {
        const existing = await Q.getActivityProfileDocument(client, activityId, profileId);
        this.checkConcurrency(existing?.etag, ifMatch, undefined);
      }

      await Q.deleteActivityProfileDocument(client, activityId, profileId);
    });
    this.setStatus(204);
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
