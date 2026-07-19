import type { UpdateAgentSkillsRequest } from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  agentParamsSchema,
  agentSkillParamsSchema,
  skillParamsSchema,
  updateAgentSkillsRequestSchema,
} from '../schemas';

export const registerSkillRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/skills',
    routeDocs({
      tags: ['skills'],
      summary: 'List installed skills.',
    }),
    async () => await runtime.listSkills(),
  );

  server.get(
    '/api/skills/:skillId',
    routeDocs({
      tags: ['skills'],
      summary: 'Inspect one installed skill.',
      params: skillParamsSchema,
    }),
    async (request, reply) => {
      const params = skillParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({ message: 'A valid skill id is required.' });
      }

      try {
        return await runtime.readSkill(params.data.skillId);
      } catch (error) {
        return reply.code(404).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.get(
    '/api/agents/:agentId/skills',
    routeDocs({
      tags: ['skills'],
      summary: "List an agent's attached skills.",
      params: agentParamsSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({ message: 'A valid agent id is required.' });
      }

      try {
        return await runtime.agentSkillsResponse(params.data.agentId);
      } catch (error) {
        return reply.code(404).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.put(
    '/api/agents/:agentId/skills',
    routeDocs({
      tags: ['skills'],
      summary: "Replace an agent's attached skills.",
      params: agentParamsSchema,
      body: updateAgentSkillsRequestSchema,
    }),
    async (request, reply) => {
      const params = agentParamsSchema.safeParse(request.params);
      const body = updateAgentSkillsRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply
          .code(400)
          .send({ message: 'A valid agent id and unique attachedSkillIds array are required.' });
      }

      try {
        return await runtime.updateAgentSkills(
          params.data.agentId,
          body.data satisfies UpdateAgentSkillsRequest,
        );
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.post(
    '/api/agents/:agentId/skills/:skillId',
    routeDocs({
      tags: ['skills'],
      summary: 'Attach an installed skill to an agent.',
      params: agentSkillParamsSchema,
    }),
    async (request, reply) => {
      const params = agentSkillParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({ message: 'Valid agent and skill ids are required.' });
      }

      try {
        return await runtime.attachAgentSkill(params.data.agentId, params.data.skillId);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.delete(
    '/api/agents/:agentId/skills/:skillId',
    routeDocs({
      tags: ['skills'],
      summary: 'Detach a skill from an agent.',
      params: agentSkillParamsSchema,
    }),
    async (request, reply) => {
      const params = agentSkillParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({ message: 'Valid agent and skill ids are required.' });
      }

      try {
        return await runtime.detachAgentSkill(params.data.agentId, params.data.skillId);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );
};
