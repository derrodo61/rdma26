import type {
  ApplySkillUpdateRequest,
  InstallSkillRequest,
  InspectSkillUpdateRequest,
  RollbackSkillRequest,
  SetSkillPinnedRequest,
  UpdateAgentSkillsRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  agentParamsSchema,
  agentSkillParamsSchema,
  applySkillUpdateRequestSchema,
  inspectSkillUpdateRequestSchema,
  installSkillRequestSchema,
  rollbackSkillRequestSchema,
  rejectSkillProposalRequestSchema,
  setSkillPinnedRequestSchema,
  skillCatalogParamsSchema,
  skillCatalogSearchQuerySchema,
  skillParamsSchema,
  skillProposalParamsSchema,
  updateAgentSkillsRequestSchema,
} from '../schemas';

export const registerSkillRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/skill-proposals',
    routeDocs({ tags: ['skills'], summary: 'List reviewable skill proposals.' }),
    async () => await runtime.listSkillProposals(),
  );

  server.get(
    '/api/skill-proposals/:proposalId',
    routeDocs({
      tags: ['skills'],
      summary: 'Inspect one skill proposal.',
      params: skillProposalParamsSchema,
    }),
    async (request, reply) => {
      const params = skillProposalParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ message: 'A valid proposal id is required.' });
      }
      try {
        return await runtime.readSkillProposal(params.data.proposalId);
      } catch (error) {
        return reply.code(404).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.post(
    '/api/skill-proposals/:proposalId/apply',
    routeDocs({
      tags: ['skills'],
      summary: 'Explicitly apply a pending skill proposal.',
      params: skillProposalParamsSchema,
    }),
    async (request, reply) => {
      const params = skillProposalParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ message: 'A valid proposal id is required.' });
      }
      try {
        return await runtime.applySkillProposal(params.data.proposalId);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.post(
    '/api/skill-proposals/:proposalId/reject',
    routeDocs({
      tags: ['skills'],
      summary: 'Reject a skill proposal without changing the library.',
      params: skillProposalParamsSchema,
      body: rejectSkillProposalRequestSchema,
    }),
    async (request, reply) => {
      const params = skillProposalParamsSchema.safeParse(request.params);
      const body = rejectSkillProposalRequestSchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return reply.code(400).send({ message: 'A valid proposal id and reason are required.' });
      }
      try {
        return await runtime.rejectSkillProposal(params.data.proposalId, body.data.reason);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.get(
    '/api/skill-installations',
    routeDocs({ tags: ['skills'], summary: 'List external skill installations.' }),
    async () => ({ installations: await runtime.listSkillInstallations() }),
  );

  server.post(
    '/api/skill-installations',
    routeDocs({
      tags: ['skills'],
      summary: 'Install a skill package from a supported source.',
      body: installSkillRequestSchema,
    }),
    async (request, reply) => {
      const body = installSkillRequestSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({ message: 'A valid skill installation source is required.' });
      }

      try {
        return await runtime.installSkill(body.data satisfies InstallSkillRequest);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.post(
    '/api/skill-installations/:skillId/update-inspection',
    routeDocs({
      tags: ['skills'],
      summary: 'Inspect an external skill update without applying it.',
      params: skillParamsSchema,
      body: inspectSkillUpdateRequestSchema,
    }),
    async (request, reply) => {
      const params = skillParamsSchema.safeParse(request.params);
      const body = inspectSkillUpdateRequestSchema.safeParse(request.body ?? {});

      if (!params.success || !body.success) {
        return reply.code(400).send({ message: 'A valid skill id and request are required.' });
      }

      try {
        const input = body.data satisfies InspectSkillUpdateRequest;
        return await runtime.inspectSkillUpdate(params.data.skillId, input.enabledCapabilities);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.post(
    '/api/skill-installations/:skillId/update',
    routeDocs({
      tags: ['skills'],
      summary: 'Apply a previously inspected external skill update.',
      params: skillParamsSchema,
      body: applySkillUpdateRequestSchema,
    }),
    async (request, reply) => {
      const params = skillParamsSchema.safeParse(request.params);
      const body = applySkillUpdateRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply
          .code(400)
          .send({ message: 'A valid skill id and inspected content hash are required.' });
      }

      try {
        const input = body.data satisfies ApplySkillUpdateRequest;
        return await runtime.applySkillUpdate(
          params.data.skillId,
          input.expectedContentHash,
          input.enabledCapabilities,
        );
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.patch(
    '/api/skill-installations/:skillId/pin',
    routeDocs({
      tags: ['skills'],
      summary: 'Pin or unpin an external skill version.',
      params: skillParamsSchema,
      body: setSkillPinnedRequestSchema,
    }),
    async (request, reply) => {
      const params = skillParamsSchema.safeParse(request.params);
      const body = setSkillPinnedRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({ message: 'A valid skill id and pinned value are required.' });
      }

      try {
        const input = body.data satisfies SetSkillPinnedRequest;
        return await runtime.setSkillPinned(params.data.skillId, input.pinned);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.post(
    '/api/skill-installations/:skillId/rollback',
    routeDocs({
      tags: ['skills'],
      summary: 'Restore a retained external skill version.',
      params: skillParamsSchema,
      body: rollbackSkillRequestSchema,
    }),
    async (request, reply) => {
      const params = skillParamsSchema.safeParse(request.params);
      const body = rollbackSkillRequestSchema.safeParse(request.body ?? {});

      if (!params.success || !body.success) {
        return reply
          .code(400)
          .send({ message: 'A valid skill id and optional content hash are required.' });
      }

      try {
        const input = body.data satisfies RollbackSkillRequest;
        return await runtime.rollbackSkill(params.data.skillId, input.contentHash);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

  server.get(
    '/api/skill-catalogs/:catalogId/search',
    routeDocs({
      tags: ['skills'],
      summary: 'Search a configured skill catalog.',
      params: skillCatalogParamsSchema,
      querystring: skillCatalogSearchQuerySchema,
    }),
    async (request, reply) => {
      const params = skillCatalogParamsSchema.safeParse(request.params);
      const query = skillCatalogSearchQuerySchema.safeParse(request.query);

      if (!params.success || !query.success) {
        return reply.code(400).send({ message: 'A catalog id and search query are required.' });
      }

      try {
        return await runtime.searchSkillCatalog(
          params.data.catalogId,
          query.data.query,
          query.data.limit,
        );
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    },
  );

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
