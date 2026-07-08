import type { UpdateUserProfileRequest } from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import { updateUserProfileRequestSchema } from '../schemas';

export const registerProfileRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/profile',
    routeDocs({
      tags: ['profile'],
      summary: 'Read the synced user profile.',
    }),
    async () => await runtime.readUserProfile(),
  );

  server.patch(
    '/api/profile',
    routeDocs({
      tags: ['profile'],
      summary: 'Update the synced user profile.',
      body: updateUserProfileRequestSchema,
    }),
    async (request, reply) => {
      const parsed = updateUserProfileRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'A valid user profile update is required.',
        });
      }

      try {
        return await runtime.updateUserProfile(parsed.data satisfies UpdateUserProfileRequest);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
};
