import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';

import { readAuthConfig } from '../auth';
import { MemoryMaintenanceScheduler } from '../memory/memory-maintenance-scheduler';
import { AssistantRuntime } from '../runtime';
import { registerApiRoutes } from './api-routes';

interface FastifySwaggerServer {
  swagger(): unknown;
}

export async function startServer(): Promise<void> {
  const server = Fastify({
    logger: true,
  });
  const runtime = new AssistantRuntime();
  const memoryMaintenanceScheduler = new MemoryMaintenanceScheduler(
    runtime,
    (message) => server.log.info({ component: 'memory-maintenance' }, message),
    (message) => server.log.error({ component: 'memory-maintenance' }, message),
  );
  const authConfig = readAuthConfig();

  await runtime.ensureReady();
  await memoryMaintenanceScheduler.start();

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
        { name: 'memories', description: 'Long-term memory records.' },
        { name: 'tools', description: 'Tool registry and per-agent grants.' },
        { name: 'agents', description: 'Agent profiles.' },
        { name: 'threads', description: 'Agent-specific conversation threads.' },
        { name: 'runs', description: 'Agent runs and streaming responses.' },
        { name: 'run-context', description: 'Optional run context transparency details.' },
      ],
    },
  });

  registerApiRoutes(server, {
    authConfig,
    memoryMaintenanceScheduler,
    runtime,
  });

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

  server.addHook('onClose', () => {
    memoryMaintenanceScheduler.stop();
  });

  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '127.0.0.1';

  await server.listen({
    host,
    port,
  });
}
