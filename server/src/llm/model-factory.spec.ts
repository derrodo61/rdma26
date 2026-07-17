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
  it('reports missing ChatGPT login before capability compatibility errors', async () => {
    const factory = new OpenAiModelFactory({
      validTokens: async () => null,
    } as OpenAiChatGptAuthService);

    await expect(
      factory.createChatModel('chatgpt:gpt-5.4', {
        includeWebSearchSources: true,
      }),
    ).rejects.toBeInstanceOf(ModelProviderNotConfiguredError);
  });
});

describe('createCodexFetch', () => {
  it('maps system input roles to developer roles at the request boundary', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const codexFetch = createCodexFetch(fetchImplementation);

    await codexFetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: JSON.stringify({
        input: [
          { role: 'system', content: 'System instructions' },
          { role: 'user', content: 'Hello' },
        ],
      }),
    });

    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      input: [
        { role: 'developer', content: 'System instructions' },
        { role: 'user', content: 'Hello' },
      ],
    });
  });
});
