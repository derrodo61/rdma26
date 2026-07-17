import type { RouteRegistrar } from '../route-context';
import { routeDocs } from '../route-docs';

export const registerModelProviderRoutes: RouteRegistrar = (server, { runtime }) => {
  server.get(
    '/api/model-providers',
    routeDocs({
      tags: ['model-providers'],
      summary: 'Read model-provider authentication status.',
    }),
    async () => await runtime.modelProvidersResponse(),
  );

  server.post(
    '/api/model-providers/openai-chatgpt/login',
    routeDocs({
      tags: ['model-providers'],
      summary: 'Start a ChatGPT/Codex OAuth login.',
    }),
    async () => await runtime.startOpenAiChatGptLogin(),
  );

  server.delete(
    '/api/model-providers/openai-chatgpt/session',
    routeDocs({
      tags: ['model-providers'],
      summary: 'Delete the stored ChatGPT/Codex OAuth session.',
    }),
    async () => await runtime.logoutOpenAiChatGpt(),
  );
};
