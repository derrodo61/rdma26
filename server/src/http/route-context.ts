import type { FastifyInstance } from 'fastify';

import type { AuthConfig } from '../auth';
import type { AssistantRuntime } from '../runtime';

export interface RegisterRoutesOptions {
  readonly authConfig: AuthConfig;
  readonly runtime: AssistantRuntime;
}

export type RouteRegistrar = (server: FastifyInstance, options: RegisterRoutesOptions) => void;
