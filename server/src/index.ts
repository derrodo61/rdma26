import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from 'dotenv';
import Fastify from 'fastify';
import { z, type ZodType } from 'zod';

import type {
  AgentRunEvent,
  AgentRunRequest,
  CreateAgentRequest,
  CreateThreadRequest,
  LoginRequest,
  UpdateAgentRequest,
  UpdateAgentSoulRequest,
  UpdateAgentToolsRequest,
  UpdateUserProfileRequest,
} from '../../shared/agent-contracts';
import { isAuthExemptPath, login, logout, readAuthConfig, sessionForRequest } from './auth';
import { AssistantRuntime } from './runtime';

config({ quiet: true });

const createAgentRequestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
});
const createThreadRequestSchema = z.object({
  title: z.string().trim().min(1).optional(),
});
const updateAgentRequestSchema = z.object({
  name: z.string().trim().min(1),
});
const updateAgentSoulRequestSchema = z.object({
  content: z.string(),
});
const updateAgentToolsRequestSchema = z.object({
  enabledTools: z.array(z.string().trim().min(1)),
});
const agentParamsSchema = z.object({
  agentId: z.string().trim().min(1),
});
const agentToolParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  toolId: z.string().trim().min(1),
});
const threadParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
});
const legacyThreadParamsSchema = z.object({
  threadId: z.string().uuid(),
});
const agentRunRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1),
});
const loginRequestSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});
const agentSettingsSchema = z.object({
  model: z.string().trim().min(1).optional(),
});
const updateUserProfileRequestSchema = z.object({
  name: z.string().trim().optional(),
  timeZone: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
  locale: z.string().trim().min(1).optional(),
  dateStyle: z.enum(['short', 'medium', 'long', 'full']).optional(),
  timeStyle: z.enum(['short', 'medium']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  agentSettings: z.record(z.string(), agentSettingsSchema).optional(),
});

const server = Fastify({
  logger: true,
});
const runtime = new AssistantRuntime();
const authConfig = readAuthConfig();

async function startServer(): Promise<void> {
  await runtime.ensureReady();

  await server.register(cors, {
    origin: process.env['CLIENT_ORIGIN'] ?? 'http://localhost:4200',
  });

  await server.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'rdma26 API',
        version: '0.0.0',
        description: 'Local-first multi-agent assistant backend API.',
      },
      tags: [
        { name: 'auth', description: 'Single-user session authentication.' },
        { name: 'profile', description: 'Synced user profile and preferences.' },
        { name: 'health', description: 'Backend status.' },
        { name: 'models', description: 'Model selection.' },
        { name: 'tools', description: 'Tool registry and per-agent grants.' },
        { name: 'agents', description: 'Agent profiles.' },
        { name: 'threads', description: 'Agent-specific conversation threads.' },
        { name: 'runs', description: 'Agent runs and streaming responses.' },
        { name: 'legacy', description: 'Default-agent compatibility routes.' },
      ],
    },
  });

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
      summary: 'Create a thread for one agent.',
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
    '/api/threads',
    routeDocs({
      tags: ['legacy'],
      summary: 'List threads for the default agent.',
    }),
    async () => await runtime.listThreads(runtime.getDefaultAgentId()),
  );

  server.post(
    '/api/threads',
    routeDocs({
      tags: ['legacy'],
      summary: 'Create a thread for the default agent.',
      body: createThreadRequestSchema,
    }),
    async (request, reply) => {
      const parsed = createThreadRequestSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Thread title must be text when provided.',
        });
      }

      return await runtime.createThread(runtime.getDefaultAgentId(), parsed.data);
    },
  );

  server.get(
    '/api/threads/:threadId',
    routeDocs({
      tags: ['legacy'],
      summary: 'Read one default-agent thread.',
      params: legacyThreadParamsSchema,
    }),
    async (request, reply) => {
      const params = legacyThreadParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid thread id is required.',
        });
      }

      try {
        return await runtime.readThread(runtime.getDefaultAgentId(), params.data.threadId);
      } catch (error) {
        return reply.code(404).send({
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
        const result = await runtime.runAgent(runRequest);

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
    '/api/openapi.json',
    {
      schema: {
        hide: true,
      },
    },
    async () => (server as FastifySwaggerServer).swagger(),
  );

  await server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '127.0.0.1';

  await server.listen({
    host,
    port,
  });
}

function writeServerSentEvent(stream: NodeJS.WritableStream, event: AgentRunEvent): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`);
}

interface RouteDocsOptions {
  readonly tags: readonly string[];
  readonly summary: string;
  readonly params?: ZodType;
  readonly body?: ZodType;
}

interface FastifySwaggerServer {
  swagger(): unknown;
}

function routeDocs(options: RouteDocsOptions) {
  const schema: Record<string, unknown> = {
    tags: [...options.tags],
    summary: options.summary,
  };

  if (options.params) {
    schema['params'] = zodJsonSchema(options.params);
  }

  if (options.body) {
    schema['body'] = zodJsonSchema(options.body);
  }

  return {
    schema,
  };
}

function zodJsonSchema(schema: ZodType): unknown {
  return removeJsonSchemaDialect(z.toJSONSchema(schema));
}

function removeJsonSchemaDialect(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => removeJsonSchemaDialect(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$schema')
      .map(([key, item]) => [key, removeJsonSchemaDialect(item)]),
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Request failed.';
}

void startServer();
