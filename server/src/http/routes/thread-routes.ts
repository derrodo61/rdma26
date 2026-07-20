import type { CreateThreadRequest, UpdateThreadRequest } from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  agentParamsSchema,
  createThreadRequestSchema,
  threadParamsSchema,
  updateThreadRequestSchema,
} from '../schemas';

export const registerThreadRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/agents/:agentId/threads',
    routeDocs({
      tags: ['threads'],
      summary: 'List threads for one agent.',
      params: agentParamsSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid agent id is required.',
        });
      }

      try {
        return await runtime.listThreads(params.data.agentId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.post(
    '/api/agents/:agentId/threads',
    routeDocs({
      tags: ['threads'],
      summary: 'Create a thread.',
      params: agentParamsSchema,
      body: createThreadRequestSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);
      const body = createThreadRequestSchema.safeParse(request.body ?? {});

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid agent id and optional thread title are required.',
        });
      }

      try {
        return await runtime.createThread(
          params.data.agentId,
          body.data satisfies CreateThreadRequest,
        );
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/agents/:agentId/threads/:threadId',
    routeDocs({
      tags: ['threads'],
      summary: 'Read one full thread.',
      params: threadParamsSchema,
    }),
    async (request, reply) => {
      const params = threadParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid agent id and thread id are required.',
        });
      }

      try {
        return await runtime.readThread(params.data.agentId, params.data.threadId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.patch(
    '/api/agents/:agentId/threads/:threadId',
    routeDocs({
      tags: ['threads'],
      summary: 'Update one thread.',
      params: threadParamsSchema,
      body: updateThreadRequestSchema,
    }),
    async (request, reply) => {
      const params = threadParamsSchema.safeParse(request.params);
      const body = updateThreadRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid agent id, thread id, and non-empty title are required.',
        });
      }

      try {
        return await runtime.updateThread(
          params.data.agentId,
          params.data.threadId,
          body.data satisfies UpdateThreadRequest,
        );
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.delete(
    '/api/agents/:agentId/threads/:threadId',
    routeDocs({
      tags: ['threads'],
      summary: 'Delete one thread.',
      params: threadParamsSchema,
    }),
    async (request, reply) => {
      const params = threadParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid agent id and thread id are required.',
        });
      }

      try {
        return await runtime.deleteThread(params.data.agentId, params.data.threadId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/agents/:agentId/threads/:threadId/latest-run-context',
    routeDocs({
      tags: ['run-context'],
      summary: 'Read the latest run context for one thread, if one exists.',
      params: threadParamsSchema,
    }),
    async (request, reply) => {
      const params = threadParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid agent id and thread id are required.',
        });
      }

      try {
        return await runtime.readLatestThreadRunContext(params.data.agentId, params.data.threadId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/agents/:agentId/threads/:threadId/run-contexts',
    routeDocs({
      tags: ['run-context'],
      summary: 'List run contexts for one thread.',
      params: threadParamsSchema,
    }),
    async (request, reply) => {
      const params = threadParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid agent id and thread id are required.',
        });
      }

      try {
        return await runtime.listThreadRunContexts(params.data.agentId, params.data.threadId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
};
