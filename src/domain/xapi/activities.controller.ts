import {
  Controller,
  Get,
  Middlewares,
  Query,
  Route,
  Security,
  Tags,
} from '@tsoa/runtime';
import type { RequestContext } from '../../core/context.js';
import type { Activity } from './types.js';
import { xapiVersionMiddleware } from './xapi-version.middleware.js';
import * as Q from './pg-xapi.queries.js';

@Route('xapi')
@Tags('xAPI Activities')
@Middlewares(xapiVersionMiddleware)
@Security('jwt')
@Security('xapi_basic')
export class ActivitiesController extends Controller {
  constructor(private readonly ctx: RequestContext) {
    super();
  }

  /**
   * GET /xapi/activities
   *
   * Returns the canonical Activity object for the given activityId.
   * Per spec, if the LRS has no canonical definition it returns
   * an Activity with just the id.
   */
  @Get('/activities')
  public async getActivity(@Query() activityId: string): Promise<Activity> {
    return this.ctx.asUser(async (client) => {
      const activity = await Q.getActivity(client, activityId);
      return activity ?? { objectType: 'Activity', id: activityId };
    });
  }
}
