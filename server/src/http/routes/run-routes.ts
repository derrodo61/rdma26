import type { AgentRunRequest } from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import { agentRunRequestSchema, runParamsSchema } from '../schemas';
import { writeServerSentEvent } from '../sse';

export const registerRunRoutes: RouteRegistrar = (server, { runtime }) => {
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
      const abortController = new AbortController();
      let responseEnded = false;

      reply.raw.writeHead(200, {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
      });

      reply.raw.on('close', () => {
        if (!responseEnded) {
          abortController.abort();
        }
      });

      writeServerSentEvent(reply.raw, {
        type: 'run-started',
        runId,
        threadId: runRequest.threadId,
      });

      try {
        const result = await runtime.runAgent(runRequest, {
          runId,
          signal: abortController.signal,
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
        responseEnded = true;
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
};
