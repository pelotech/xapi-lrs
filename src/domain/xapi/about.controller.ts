import { Controller, Get, NoSecurity, Route, Tags } from '@tsoa/runtime';
import type { AboutResource } from './types.js';

@Route('xapi')
@Tags('xAPI About')
export class AboutController extends Controller {
  /**
   * Returns metadata about this LRS, including supported xAPI versions.
   * Per §7.7 this endpoint SHOULD allow unauthenticated access and MUST
   * respond even without the X-Experience-API-Version header (version discovery).
   */
  @Get('/about')
  @NoSecurity()
  public async getAbout(): Promise<AboutResource> {
    this.setHeader('X-Experience-API-Version', '1.0.3');
    return {
      version: ['1.0.3', '1.0.2', '1.0.1', '1.0.0'],
    };
  }
}
