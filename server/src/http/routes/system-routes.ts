import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';

export const registerSystemRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/health',
    routeDocs({
      tags: ['health'],
      summary: 'Read backend status.',
    }),
    async () => await runtime.health(),
  );

  server.get(
    '/api/models',
    routeDocs({
      tags: ['models'],
      summary: 'List configured model options.',
    }),
    async () => runtime.modelsResponse(),
  );

  server.get(
    '/api/tools',
    routeDocs({
      tags: ['tools'],
      summary: 'List registered tools.',
    }),
    async () => runtime.toolsResponse(),
  );
};
