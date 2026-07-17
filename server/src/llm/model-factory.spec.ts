import { describe, expect, it, vi } from 'vitest';

import type { OpenAiChatGptAuthService } from './openai-chatgpt-auth';
import {
  createCodexFetch,
  ModelProviderNotConfiguredError,
  OpenAiModelFactory,
  resolveModelSelection,
} from './model-factory';

describe('resolveModelSelection', () => {
  it('keeps existing model ids on the OpenAI API provider', () => {
    expect(resolveModelSelection('gpt-5.4')).toEqual({
      selectionId: 'gpt-5.4',
      model: 'gpt-5.4',
      provider: 'openai-api',
    });
  });

  it('resolves provider-qualified ChatGPT model ids', () => {
    expect(resolveModelSelection('chatgpt:gpt-5.4')).toEqual({
      selectionId: 'chatgpt:gpt-5.4',
      model: 'gpt-5.4',
      provider: 'openai-chatgpt',
    });
  });
});

describe('OpenAiModelFactory', () => {
  it('reports missing ChatGPT login when hosted web search is requested', async () => {
    const factory = new OpenAiModelFactory({
      validTokens: async () => null,
    } as OpenAiChatGptAuthService);

    await expect(
      factory.createChatModel('chatgpt:gpt-5.4', {
        includeWebSearchSources: true,
      }),
    ).rejects.toBeInstanceOf(ModelProviderNotConfiguredError);
  });

  it('creates a logged-in ChatGPT model with hosted web-search source collection', async () => {
    const factory = new OpenAiModelFactory({
      validTokens: async () => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'account-id',
        expiresAt: Date.now() + 60_000,
      }),
    } as OpenAiChatGptAuthService);

    const configured = await factory.createChatModel('chatgpt:gpt-5.4', {
      includeWebSearchSources: true,
    });

    expect(configured.provider).toBe('openai-chatgpt');
    expect(configured.model).toBe('gpt-5.4');
    expect(configured.instance.modelKwargs).toEqual({
      include: ['web_search_call.action.sources'],
    });
  });
});

describe('createCodexFetch', () => {
  it('maps system input roles to developer roles at the request boundary', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const codexFetch = createCodexFetch(fetchImplementation);

    await codexFetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: JSON.stringify({
        include: ['web_search_call.action.sources'],
        input: [
          { role: 'system', content: 'System instructions' },
          { role: 'user', content: 'Hello' },
        ],
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
      }),
    });

    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      include: ['web_search_call.action.sources'],
      input: [
        { role: 'developer', content: 'System instructions' },
        { role: 'user', content: 'Hello' },
      ],
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
    });
  });
});
