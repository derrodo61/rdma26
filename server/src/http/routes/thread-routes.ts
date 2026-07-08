import type {
  CreateThreadRequest,
  ThreadSummariesRequest,
  ThreadSummaryRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  agentParamsSchema,
  createThreadRequestSchema,
  threadParamsSchema,
  threadSummariesRequestSchema,
  threadSummaryRequestSchema,
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
      summary: 'Create a thread and summarize the previous thread when possible.',
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

  server.post(
    '/api/agents/:agentId/threads/summaries',
    routeDocs({
      tags: ['threads', 'memories'],
      summary: 'Create missing memory summaries for multiple threads.',
      params: agentParamsSchema,
      body: threadSummariesRequestSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);
      const body = threadSummariesRequestSchema.safeParse(request.body ?? {});

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid agent id and optional summaries request are required.',
        });
      }

      try {
        return await runtime.consolidateAgentThreadSummaries(
          params.data.agentId,
          body.data satisfies ThreadSummariesRequest,
        );
      } catch (error) {
        return reply.code(400).send({
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

  server.post(
    '/api/agents/:agentId/threads/:threadId/summary',
    routeDocs({
      tags: ['threads', 'memories'],
      summary: 'Create the memory summary for one thread if missing.',
      params: threadParamsSchema,
      body: threadSummaryRequestSchema,
    }),
    async (request, reply) => {
      const params = threadParamsSchema.safeParse(request.params);
      const body = threadSummaryRequestSchema.safeParse(request.body ?? {});

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid agent id, thread id, and optional summary request are required.',
        });
      }

      try {
        return await runtime.consolidateThreadSummary(
          params.data.agentId,
          params.data.threadId,
          body.data satisfies ThreadSummaryRequest,
        );
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
};
