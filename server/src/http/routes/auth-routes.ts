import type { LoginRequest } from '../../../../shared/agent-contracts';
import { isAuthExemptPath, login, logout, sessionForRequest } from '../../auth';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import { loginRequestSchema } from '../schemas';

export const registerAuthRoutes: RouteRegistrar = (server, { authConfig }) => {
  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || isAuthExemptPath(request.url.split('?')[0])) {
      return;
    }

    const session = sessionForRequest(request, authConfig);

    if (!session.authenticated) {
      return reply.code(401).send({
        message: 'Authentication required.',
      });
    }
  });

  server.get(
    '/api/auth/session',
    routeDocs({
      tags: ['auth'],
      summary: 'Read the current auth session.',
    }),
    async (request) => sessionForRequest(request, authConfig),
  );

  server.post(
    '/api/auth/login',
    routeDocs({
      tags: ['auth'],
      summary: 'Create a signed session cookie.',
      body: loginRequestSchema,
    }),
    async (request, reply) => {
      const parsed = loginRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Username and password are required.',
        });
      }

      try {
        return login(reply, authConfig, parsed.data satisfies LoginRequest);
      } catch (error) {
        return reply.code(401).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.post(
    '/api/auth/logout',
    routeDocs({
      tags: ['auth'],
      summary: 'Clear the session cookie.',
    }),
    async (_request, reply) => logout(reply, authConfig),
  );
};
