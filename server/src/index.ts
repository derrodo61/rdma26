import cors from '@fastify/cors';
import { config } from 'dotenv';
import Fastify from 'fastify';
import { z } from 'zod';

import type {
  AgentRunEvent,
  AgentRunRequest,
  CreateAgentRequest,
  CreateThreadRequest,
  UpdateAgentRequest,
} from '../../shared/agent-contracts';
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
const agentParamsSchema = z.object({
  agentId: z.string().trim().min(1),
});
const threadParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
});
const agentRunRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

const server = Fastify({
  logger: true,
});
const runtime = new AssistantRuntime();

async function startServer(): Promise<void> {
  await runtime.ensureReady();

  await server.register(cors, {
    origin: process.env['CLIENT_ORIGIN'] ?? 'http://localhost:4200',
  });

  server.get('/api/health', async () => await runtime.health());

  server.get('/api/models', async () => runtime.modelsResponse());

  server.get('/api/agents', async () => await runtime.agentsResponse());

  server.post('/api/agents', async (request, reply) => {
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
  });

  server.get('/api/agents/:agentId', async (request, reply) => {
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
  });

  server.patch('/api/agents/:agentId', async (request, reply) => {
    const params = agentParamsSchema.safeParse(request.params);
    const body = updateAgentRequestSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        message: 'A valid agent id and display name are required.',
      });
    }

    try {
      return await runtime.updateAgent(params.data.agentId, body.data satisfies UpdateAgentRequest);
    } catch (error) {
      return reply.code(404).send({
        message: getErrorMessage(error),
      });
    }
  });

  server.get('/api/agents/:agentId/threads', async (request, reply) => {
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
  });

  server.post('/api/agents/:agentId/threads', async (request, reply) => {
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
  });

  server.get('/api/agents/:agentId/threads/:threadId', async (request, reply) => {
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
  });

  server.delete('/api/agents/:agentId/threads/:threadId', async (request, reply) => {
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
  });

  server.get('/api/threads', async () => await runtime.listThreads(runtime.getDefaultAgentId()));

  server.post('/api/threads', async (request, reply) => {
    const parsed = createThreadRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        message: 'Thread title must be text when provided.',
      });
    }

    return await runtime.createThread(runtime.getDefaultAgentId(), parsed.data);
  });

  server.get('/api/threads/:threadId', async (request, reply) => {
    const params = z
      .object({
        threadId: z.string().uuid(),
      })
      .safeParse(request.params);

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
  });

  server.post('/api/agent-runs', async (request, reply) => {
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Request failed.';
}

void startServer();
