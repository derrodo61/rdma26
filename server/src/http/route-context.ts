import type { FastifyInstance } from 'fastify';

import type { AuthConfig } from '../auth';
import type { MemoryMaintenanceScheduler } from '../memory-maintenance-scheduler';
import type { AssistantRuntime } from '../runtime';

export interface RegisterRoutesOptions {
  readonly authConfig: AuthConfig;
  readonly memoryMaintenanceScheduler: MemoryMaintenanceScheduler;
  readonly runtime: AssistantRuntime;
}

export type RouteRegistrar = (server: FastifyInstance, options: RegisterRoutesOptions) => void;
