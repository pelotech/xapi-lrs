import { Controller, Get, NoSecurity, Route, Tags } from '@tsoa/runtime';
import type { RequestContext } from '../../core/context.js';

interface HealthcheckResponse {
  status: string;
  version: string;
  uptime: number;
}

@Route('v1')
@Tags('System')
export class SystemController extends Controller {
  constructor(private readonly ctx: RequestContext) {
    super();
  }

  @Get('/healthcheck')
  @NoSecurity()
  public async healthcheck(): Promise<HealthcheckResponse> {
    return {
      status: 'ok',
      version: this.ctx.config.APP_VERSION,
      uptime: process.uptime(),
    };
  }
}
