/**
 * xAPI About Resource
 * GET /xapi/about — unauthenticated
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { HonoEnv } from '../hono-env.ts';
import { SUPPORTED_VERSIONS } from '../xapi/versions.ts';

const aboutRoute = createRoute({
  method: 'get',
  path: '/about',
  operationId: 'GetAbout',
  tags: ['xAPI'],
  security: [],
  responses: {
    200: {
      description: 'Ok',
      content: {
        'application/json': {
          schema: z.object({ version: z.array(z.string()) }),
        },
      },
    },
  },
});

export function createAboutApp() {
  const app = new OpenAPIHono<HonoEnv>();

  app.openapi(aboutRoute, (c) => {
    return c.json({ version: [...SUPPORTED_VERSIONS] }, 200);
  });

  return app;
}
