import type {
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateAgentSoulRequest,
  UpdateAgentToolsRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  agentParamsSchema,
  agentToolParamsSchema,
  createAgentRequestSchema,
  updateAgentRequestSchema,
  updateAgentSoulRequestSchema,
  updateAgentToolsRequestSchema,
} from '../schemas';

export const registerAgentRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/agents',
    routeDocs({
      tags: ['agents'],
      summary: 'List configured agents.',
    }),
    async () => await runtime.agentsResponse(),
  );

  server.post(
    '/api/agents',
    routeDocs({
      tags: ['agents'],
      summary: 'Create an agent.',
      body: createAgentRequestSchema,
    }),
    async (request, reply) => {
      const parsed = createAgentRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Agent name is required. Agent id is optional.',
        });
      }

      try {
        return await runtime.createAgent(parsed.data satisfies CreateAgentRequest);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/agents/:agentId/tools',
    routeDocs({
      tags: ['tools'],
      summary: 'List enabled and available tools for one agent.',
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
        return await runtime.agentToolsResponse(params.data.agentId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.put(
    '/api/agents/:agentId/tools',
    routeDocs({
      tags: ['tools'],
      summary: "Replace an agent's enabled tools.",
      params: agentParamsSchema,
      body: updateAgentToolsRequestSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);
      const body = updateAgentToolsRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid agent id and enabledTools array are required.',
        });
      }

      try {
        return await runtime.updateAgentTools(
          params.data.agentId,
          body.data satisfies UpdateAgentToolsRequest,
        );
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.post(
    '/api/agents/:agentId/tools/:toolId',
    routeDocs({
      tags: ['tools'],
      summary: 'Grant a tool to an agent.',
      params: agentToolParamsSchema,
    }),
    async (request, reply) => {
      const params = agentToolParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid agent id and tool id are required.',
        });
      }

      try {
        return await runtime.grantAgentTool(params.data.agentId, params.data.toolId);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.delete(
    '/api/agents/:agentId/tools/:toolId',
    routeDocs({
      tags: ['tools'],
      summary: 'Revoke a tool from an agent.',
      params: agentToolParamsSchema,
    }),
    async (request, reply) => {
      const params = agentToolParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid agent id and tool id are required.',
        });
      }

      try {
        return await runtime.revokeAgentTool(params.data.agentId, params.data.toolId);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/agents/:agentId/soul',
    routeDocs({
      tags: ['agents'],
      summary: "Read an agent's soul.md content.",
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
        return await runtime.readAgentSoul(params.data.agentId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.put(
    '/api/agents/:agentId/soul',
    routeDocs({
      tags: ['agents'],
      summary: "Replace an agent's soul.md content.",
      params: agentParamsSchema,
      body: updateAgentSoulRequestSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);
      const body = updateAgentSoulRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid agent id and soul.md content are required.',
        });
      }

      try {
        return await runtime.updateAgentSoul(
          params.data.agentId,
          body.data satisfies UpdateAgentSoulRequest,
        );
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/agents/:agentId',
    routeDocs({
      tags: ['agents'],
      summary: 'Read one agent profile.',
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
        return await runtime.readAgent(params.data.agentId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.patch(
    '/api/agents/:agentId',
    routeDocs({
      tags: ['agents'],
      summary: 'Update an agent display name.',
      params: agentParamsSchema,
      body: updateAgentRequestSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);
      const body = updateAgentRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid agent id and display name are required.',
        });
      }

      try {
        return await runtime.updateAgent(
          params.data.agentId,
          body.data satisfies UpdateAgentRequest,
        );
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.delete(
    '/api/agents/:agentId',
    routeDocs({
      tags: ['agents'],
      summary: 'Delete one agent and its related data.',
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
        return await runtime.deleteAgent(params.data.agentId);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
};
