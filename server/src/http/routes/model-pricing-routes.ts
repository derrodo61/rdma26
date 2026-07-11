import type {
  CreateModelPricingRequest,
  ModelPricingListRequest,
  UpdateModelPricingRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  createModelPricingRequestSchema,
  modelPricingListQuerySchema,
  modelPricingParamsSchema,
  setModelPricingActiveRequestSchema,
  syncOpenAiModelPricingRequestSchema,
  updateModelPricingRequestSchema,
} from '../schemas';

export const registerModelPricingRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/model-pricing',
    routeDocs({
      tags: ['model-pricing'],
      summary: 'List model pricing records used for estimated LLM costs.',
      querystring: modelPricingListQuerySchema,
    }),
    async (request, reply) => {
      const query = modelPricingListQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({
          message: 'A valid model-pricing query is required.',
        });
      }

      return await runtime.listModelPricing(query.data satisfies ModelPricingListRequest);
    },
  );

  server.post(
    '/api/model-pricing',
    routeDocs({
      tags: ['model-pricing'],
      summary: 'Create a model pricing record.',
      body: createModelPricingRequestSchema,
    }),
    async (request, reply) => {
      const body = createModelPricingRequestSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          message: 'A valid model-pricing create request is required.',
        });
      }

      try {
        return await runtime.createModelPricing(body.data satisfies CreateModelPricingRequest);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.post(
    '/api/model-pricing/openai/sync',
    routeDocs({
      tags: ['model-pricing'],
      summary:
        'Fetch the official OpenAI pricing source and compare saved active OpenAI model prices.',
      body: syncOpenAiModelPricingRequestSchema,
    }),
    async (request, reply) => {
      const body = syncOpenAiModelPricingRequestSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return reply.code(400).send({
          message: 'A valid OpenAI pricing sync request is required.',
        });
      }

      try {
        return await runtime.syncOpenAiModelPricing(body.data.sourceId, body.data.apply ?? false);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.patch(
    '/api/model-pricing/:pricingId',
    routeDocs({
      tags: ['model-pricing'],
      summary: 'Update a model pricing record.',
      params: modelPricingParamsSchema,
      body: updateModelPricingRequestSchema,
    }),
    async (request, reply) => {
      const params = modelPricingParamsSchema.safeParse(request.params);
      const body = updateModelPricingRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid model-pricing id and update request are required.',
        });
      }

      try {
        return await runtime.updateModelPricing(
          params.data.pricingId,
          body.data satisfies UpdateModelPricingRequest,
        );
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.patch(
    '/api/model-pricing/:pricingId/active',
    routeDocs({
      tags: ['model-pricing'],
      summary: 'Activate or deactivate a model pricing record.',
      params: modelPricingParamsSchema,
      body: setModelPricingActiveRequestSchema,
    }),
    async (request, reply) => {
      const params = modelPricingParamsSchema.safeParse(request.params);
      const body = setModelPricingActiveRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid model-pricing id and active state are required.',
        });
      }

      try {
        return await runtime.setModelPricingActive(params.data.pricingId, body.data.active);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.delete(
    '/api/model-pricing/:pricingId',
    routeDocs({
      tags: ['model-pricing'],
      summary: 'Delete a model pricing record.',
      params: modelPricingParamsSchema,
    }),
    async (request, reply) => {
      const params = modelPricingParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid model-pricing id is required.',
        });
      }

      try {
        return await runtime.deleteModelPricing(params.data.pricingId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
};
