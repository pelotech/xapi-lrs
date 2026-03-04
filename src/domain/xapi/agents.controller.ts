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
import { HttpError } from '../../core/errors.js';
import type { Agent, Person } from './types.js';
import { xapiVersionMiddleware } from './xapi-version.middleware.js';
import * as Q from './pg-xapi.queries.js';

@Route('xapi')
@Tags('xAPI Agents')
@Middlewares(xapiVersionMiddleware)
@Security('jwt')
@Security('xapi_basic')
export class AgentsController extends Controller {
  constructor(private readonly ctx: RequestContext) {
    super();
  }

  /**
   * GET /xapi/agents
   *
   * Returns a Person object — the merged identity information for the
   * given agent across all Statements in the LRS.
   */
  @Get('/agents')
  public async getAgent(@Query() agent: string): Promise<Person> {
    const parsedAgent = this.parseAgent(agent);
    return this.ctx.asUser(async (client) => {
      const person = await Q.getAgent(client, parsedAgent);
      // xAPI spec: return a Person object even if agent is not yet known
      return person ?? { objectType: 'Person' as const };
    });
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
    const agent = parsed as Agent;
    // Validate that the agent has at least one IFI
    if (!agent.mbox && !agent.mbox_sha1sum && !agent.openid && !agent.account) {
      throw new HttpError(400, 'BAD_REQUEST', 'Agent must have an inverse functional identifier (mbox, mbox_sha1sum, openid, or account)');
    }
    return agent;
  }
}
