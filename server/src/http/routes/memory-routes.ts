import type {
  CreateMemoryRequest,
  MemoryListRequest,
  UpdateMemoryRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  createMemoryRequestSchema,
  memoryBudgetQuerySchema,
  memoryListQuerySchema,
  memoryParamsSchema,
  updateMemoryRequestSchema,
} from '../schemas';

export const registerMemoryRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/memories/pinned-budgets',
    routeDocs({
      tags: ['memories'],
      summary: 'Read pinned startup-memory budgets for one agent.',
      querystring: memoryBudgetQuerySchema,
    }),
    async (request, reply) => {
      const query = memoryBudgetQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({ message: 'A valid agent id is required.' });
      }

      try {
        return await runtime.readMemoryPinnedBudgets(query.data.agentId);
      } catch (error) {
        return reply.code(404).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.get(
    '/api/memories',
    routeDocs({
      tags: ['memories'],
      summary: 'List and search memories.',
      querystring: memoryListQuerySchema,
    }),
    async (request, reply) => {
      const query = memoryListQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({
          message: 'A valid memory query is required.',
        });
      }

      try {
        return await runtime.listMemories({
          ...query.data,
          pinned: parseBooleanQueryValue(query.data.pinned),
        } satisfies MemoryListRequest);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.post(
    '/api/memories',
    routeDocs({
      tags: ['memories'],
      summary: 'Create a memory.',
      body: createMemoryRequestSchema,
    }),
    async (request, reply) => {
      const body = createMemoryRequestSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          message: 'A valid memory create request is required.',
        });
      }

      try {
        return await runtime.createMemory(body.data satisfies CreateMemoryRequest);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/memories/:memoryId',
    routeDocs({
      tags: ['memories'],
      summary: 'Read one memory.',
      params: memoryParamsSchema,
    }),
    async (request, reply) => {
      const params = memoryParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid memory id is required.',
        });
      }

      try {
        return await runtime.readMemory(params.data.memoryId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.patch(
    '/api/memories/:memoryId',
    routeDocs({
      tags: ['memories'],
      summary: 'Update one memory.',
      params: memoryParamsSchema,
      body: updateMemoryRequestSchema,
    }),
    async (request, reply) => {
      const params = memoryParamsSchema.safeParse(request.params);
      const body = updateMemoryRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid memory id and update request are required.',
        });
      }

      try {
        return await runtime.updateMemory(
          params.data.memoryId,
          body.data satisfies UpdateMemoryRequest,
        );
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.delete(
    '/api/memories/:memoryId',
    routeDocs({
      tags: ['memories'],
      summary: 'Delete one memory.',
      params: memoryParamsSchema,
    }),
    async (request, reply) => {
      const params = memoryParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid memory id is required.',
        });
      }

      try {
        return await runtime.deleteMemory(params.data.memoryId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
};

function parseBooleanQueryValue(
  value: boolean | 'true' | 'false' | undefined,
): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return value;
  }

  return value === 'true';
}
