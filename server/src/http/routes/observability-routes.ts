import type {
  CostSummaryRequest,
  LlmCallListRequest,
  OptimizerRunRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  costSummaryQuerySchema,
  llmCallListQuerySchema,
  llmCallParamsSchema,
  optimizerRunRequestSchema,
} from '../schemas';

export const registerObservabilityRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/llm-calls',
    routeDocs({
      tags: ['observability'],
      summary: 'List recorded LLM calls.',
      querystring: llmCallListQuerySchema,
    }),
    async (request, reply) => {
      const query = llmCallListQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({
          message: 'A valid LLM call query is required.',
        });
      }

      return await runtime.listLlmCalls(query.data satisfies LlmCallListRequest);
    },
  );

  server.get(
    '/api/llm-calls/:callId',
    routeDocs({
      tags: ['observability'],
      summary: 'Read one recorded LLM call.',
      params: llmCallParamsSchema,
    }),
    async (request, reply) => {
      const params = llmCallParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid LLM call id is required.',
        });
      }

      try {
        return await runtime.readLlmCall(params.data.callId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.get(
    '/api/costs/summary',
    routeDocs({
      tags: ['observability'],
      summary: 'Summarize estimated LLM costs from recorded calls.',
      querystring: costSummaryQuerySchema,
    }),
    async (request, reply) => {
      const query = costSummaryQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({
          message: 'A valid cost summary query is required.',
        });
      }

      return await runtime.summarizeCosts(query.data satisfies CostSummaryRequest);
    },
  );

  server.post(
    '/api/optimizer-runs',
    routeDocs({
      tags: ['observability'],
      summary: 'Ask the internal Cost Analyst agent to inspect LLM usage and cost data.',
      body: optimizerRunRequestSchema,
    }),
    async (request, reply) => {
      const body = optimizerRunRequestSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          message: 'A valid optimizer request is required.',
        });
      }

      return await runtime.runOptimizer(body.data satisfies OptimizerRunRequest);
    },
  );
};
