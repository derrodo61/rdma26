import type {
  CreateMemoryRequest,
  MemoryListRequest,
  MemoryMaintenanceRequest,
  UpdateMemoryMaintenanceSettingsRequest,
  UpdateMemoryRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  createMemoryRequestSchema,
  memoryListQuerySchema,
  memoryMaintenanceRequestSchema,
  memoryParamsSchema,
  updateMemoryMaintenanceSettingsRequestSchema,
  updateMemoryRequestSchema,
} from '../schemas';

export const registerMemoryRoutes: RouteRegistrar = (
  server,
  { memoryMaintenanceScheduler, runtime },
) => {
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
        return await runtime.listMemories(query.data satisfies MemoryListRequest);
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

  server.post(
    '/api/memories/maintenance',
    routeDocs({
      tags: ['memories'],
      summary: 'Run visible memory maintenance across agents or one agent.',
      body: memoryMaintenanceRequestSchema,
    }),
    async (request, reply) => {
      const body = memoryMaintenanceRequestSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return reply.code(400).send({
          message: 'A valid memory maintenance request is required.',
        });
      }

      try {
        return await runtime.runMemoryMaintenance(body.data satisfies MemoryMaintenanceRequest);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/memories/maintenance/settings',
    routeDocs({
      tags: ['memories'],
      summary: 'Read memory maintenance scheduler settings.',
    }),
    async () => await runtime.readMemoryMaintenanceSettings(),
  );

  server.patch(
    '/api/memories/maintenance/settings',
    routeDocs({
      tags: ['memories'],
      summary: 'Update memory maintenance scheduler settings.',
      body: updateMemoryMaintenanceSettingsRequestSchema,
    }),
    async (request, reply) => {
      const body = updateMemoryMaintenanceSettingsRequestSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return reply.code(400).send({
          message: 'A valid memory maintenance settings update is required.',
        });
      }

      try {
        const settings = await runtime.updateMemoryMaintenanceSettings(
          body.data satisfies UpdateMemoryMaintenanceSettingsRequest,
        );
        await memoryMaintenanceScheduler.refresh();

        return settings;
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
