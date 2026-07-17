import type { FastifyInstance } from 'fastify';

import type { RegisterRoutesOptions } from './route-context';
import { registerAgentRoutes } from './routes/agent-routes';
import { registerAuthRoutes } from './routes/auth-routes';
import { registerMemoryRoutes } from './routes/memory-routes';
import { registerModelPricingRoutes } from './routes/model-pricing-routes';
import { registerModelProviderRoutes } from './routes/model-provider-routes';
import { registerObservabilityRoutes } from './routes/observability-routes';
import { registerProfileRoutes } from './routes/profile-routes';
import { registerPricingSourceRoutes } from './routes/pricing-source-routes';
import { registerRunRoutes } from './routes/run-routes';
import { registerSystemRoutes } from './routes/system-routes';
import { registerThreadRoutes } from './routes/thread-routes';

export function registerApiRoutes(server: FastifyInstance, options: RegisterRoutesOptions): void {
  registerAuthRoutes(server, options);
  registerProfileRoutes(server, options);
  registerSystemRoutes(server, options);
  registerMemoryRoutes(server, options);
  registerModelPricingRoutes(server, options);
  registerModelProviderRoutes(server, options);
  registerPricingSourceRoutes(server, options);
  registerObservabilityRoutes(server, options);
  registerAgentRoutes(server, options);
  registerThreadRoutes(server, options);
  registerRunRoutes(server, options);
}
