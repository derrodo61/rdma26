import type { FastifyInstance } from 'fastify';

import type {
  AgentRunRequest,
  CreateAgentRequest,
  CreateMemoryRequest,
  CreateThreadRequest,
  LoginRequest,
  MemoryMaintenanceRequest,
  MemoryListRequest,
  ThreadSummariesRequest,
  ThreadSummaryRequest,
  UpdateAgentRequest,
  UpdateAgentSoulRequest,
  UpdateAgentToolsRequest,
  UpdateMemoryMaintenanceSettingsRequest,
  UpdateMemoryRequest,
  UpdateUserProfileRequest,
} from '../../../shared/agent-contracts';
import { isAuthExemptPath, login, logout, type AuthConfig, sessionForRequest } from '../auth';
import type { MemoryMaintenanceScheduler } from '../memory-maintenance-scheduler';
import type { AssistantRuntime } from '../runtime';
import { routeDocs } from './route-docs';
import {
  agentParamsSchema,
  agentRunRequestSchema,
  agentToolParamsSchema,
  createAgentRequestSchema,
  createMemoryRequestSchema,
  createThreadRequestSchema,
  loginRequestSchema,
  memoryListQuerySchema,
  memoryMaintenanceRequestSchema,
  memoryParamsSchema,
  runParamsSchema,
  threadParamsSchema,
  threadSummariesRequestSchema,
  threadSummaryRequestSchema,
  updateAgentRequestSchema,
  updateAgentSoulRequestSchema,
  updateAgentToolsRequestSchema,
  updateMemoryMaintenanceSettingsRequestSchema,
  updateMemoryRequestSchema,
  updateUserProfileRequestSchema,
} from './schemas';
import { writeServerSentEvent } from './sse';

interface RegisterApiRoutesOptions {
  readonly authConfig: AuthConfig;
  readonly memoryMaintenanceScheduler: MemoryMaintenanceScheduler;
  readonly runtime: AssistantRuntime;
}

export function registerApiRoutes(
  server: FastifyInstance,
  { authConfig, memoryMaintenanceScheduler, runtime }: RegisterApiRoutesOptions,
): void {
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

  server.post(
    '/api/agent-runs',
    routeDocs({
      tags: ['runs'],
      summary: 'Run an agent and stream Server-Sent Events.',
      body: agentRunRequestSchema,
    }),
    async (request, reply) => {
      const parsed = agentRunRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Agent id, thread id, prompt, and model are required.',
        });
      }

      const runRequest = parsed.data satisfies AgentRunRequest;
      const runId = crypto.randomUUID();

      reply.raw.writeHead(200, {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
      });

      writeServerSentEvent(reply.raw, {
        type: 'run-started',
        runId,
        threadId: runRequest.threadId,
      });

      try {
        const result = await runtime.runAgent(runRequest, {
          runId,
          onActivity: (activity) => {
            writeServerSentEvent(reply.raw, {
              type: 'run-activity',
              label: activity.label,
              detail: activity.detail,
            });
          },
        });

        writeServerSentEvent(reply.raw, {
          type: 'message',
          content: result.agentResponse.content,
        });
        writeServerSentEvent(reply.raw, {
          type: 'thread-updated',
          thread: result.thread,
        });
        writeServerSentEvent(reply.raw, {
          type: 'run-finished',
          runId,
          threadId: runRequest.threadId,
        });
      } catch (error) {
        server.log.error({ error }, 'Agent run failed');
        writeServerSentEvent(reply.raw, {
          type: 'error',
          message: getErrorMessage(error),
        });
      } finally {
        reply.raw.end();
      }
    },
  );

  server.get(
    '/api/runs/:runId/context',
    routeDocs({
      tags: ['run-context'],
      summary: 'Read context details for one run.',
      params: runParamsSchema,
    }),
    async (request, reply) => {
      const params = runParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid run id is required.',
        });
      }

      try {
        return await runtime.readRunContext(params.data.runId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Request failed.';
}
