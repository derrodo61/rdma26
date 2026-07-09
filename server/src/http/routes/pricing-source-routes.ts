import type {
  CreatePricingSourceRequest,
  PricingSourceListRequest,
  UpdatePricingSourceRequest,
} from '../../../../shared/agent-contracts';
import { getErrorMessage } from '../errors';
import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';
import {
  createPricingSourceRequestSchema,
  pricingSourceListQuerySchema,
  pricingSourceParamsSchema,
  updatePricingSourceRequestSchema,
} from '../schemas';

export const registerPricingSourceRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/pricing-sources',
    routeDocs({
      tags: ['pricing-sources'],
      summary: 'List configured provider pricing source pages.',
      querystring: pricingSourceListQuerySchema,
    }),
    async (request, reply) => {
      const query = pricingSourceListQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({
          message: 'A valid pricing-source query is required.',
        });
      }

      return await runtime.listPricingSources(query.data satisfies PricingSourceListRequest);
    },
  );

  server.post(
    '/api/pricing-sources',
    routeDocs({
      tags: ['pricing-sources'],
      summary: 'Create a provider pricing source page.',
      body: createPricingSourceRequestSchema,
    }),
    async (request, reply) => {
      const body = createPricingSourceRequestSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          message: 'A valid pricing-source create request is required.',
        });
      }

      try {
        return await runtime.createPricingSource(body.data satisfies CreatePricingSourceRequest);
      } catch (error) {
        return reply.code(400).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.patch(
    '/api/pricing-sources/:sourceId',
    routeDocs({
      tags: ['pricing-sources'],
      summary: 'Update a provider pricing source page.',
      params: pricingSourceParamsSchema,
      body: updatePricingSourceRequestSchema,
    }),
    async (request, reply) => {
      const params = pricingSourceParamsSchema.safeParse(request.params);
      const body = updatePricingSourceRequestSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          message: 'A valid pricing-source id and update request are required.',
        });
      }

      try {
        return await runtime.updatePricingSource(
          params.data.sourceId,
          body.data satisfies UpdatePricingSourceRequest,
        );
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.delete(
    '/api/pricing-sources/:sourceId',
    routeDocs({
      tags: ['pricing-sources'],
      summary: 'Delete a provider pricing source page.',
      params: pricingSourceParamsSchema,
    }),
    async (request, reply) => {
      const params = pricingSourceParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid pricing-source id is required.',
        });
      }

      try {
        return await runtime.deletePricingSource(params.data.sourceId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );

  server.post(
    '/api/pricing-sources/:sourceId/check',
    routeDocs({
      tags: ['pricing-sources'],
      summary: 'Check whether a provider pricing source page is reachable.',
      params: pricingSourceParamsSchema,
    }),
    async (request, reply) => {
      const params = pricingSourceParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          message: 'A valid pricing-source id is required.',
        });
      }

      try {
        return await runtime.checkPricingSource(params.data.sourceId);
      } catch (error) {
        return reply.code(404).send({
          message: getErrorMessage(error),
        });
      }
    },
  );
};
