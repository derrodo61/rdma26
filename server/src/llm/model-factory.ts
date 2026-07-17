import { ChatOpenAI } from '@langchain/openai';

import type { ModelProviderId } from '../../../shared/agent-contracts';
import { codexResponsesBaseUrl, type OpenAiChatGptAuthService } from './openai-chatgpt-auth';

const chatGptModelPrefix = 'chatgpt:';

export interface ResolvedModelSelection {
  readonly selectionId: string;
  readonly model: string;
  readonly provider: ModelProviderId;
}

export interface CreatedChatModel extends ResolvedModelSelection {
  readonly instance: ChatOpenAI;
  readonly accountingProvider: string;
}

export class OpenAiModelFactory {
  constructor(private readonly chatGptAuth: OpenAiChatGptAuthService) {}

  async createChatModel(
    selectionId: string,
    options: OpenAiChatModelOptions = {},
  ): Promise<CreatedChatModel> {
    const selection = resolveModelSelection(selectionId);

    if (selection.provider === 'openai-api') {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) throw new ModelProviderNotConfiguredError('openai-api');

      return {
        ...selection,
        accountingProvider: 'openai',
        instance: new ChatOpenAI({
          apiKey,
          model: selection.model,
          temperature: options.temperature,
          ...(options.includeWebSearchSources
            ? {
                modelKwargs: {
                  include: ['web_search_call.action.sources'],
                },
              }
            : {}),
        }),
      };
    }

    const tokens = await this.chatGptAuth.validTokens();
    if (!tokens) throw new ModelProviderNotConfiguredError('openai-chatgpt');

    return {
      ...selection,
      accountingProvider: 'openai-chatgpt',
      instance: new ChatOpenAI({
        apiKey: tokens.accessToken,
        model: selection.model,
        temperature: options.temperature,
        useResponsesApi: true,
        zdrEnabled: true,
        streaming: true,
        ...(options.includeWebSearchSources
          ? {
              modelKwargs: {
                include: ['web_search_call.action.sources'],
              },
            }
          : {}),
        configuration: {
          baseURL: codexResponsesBaseUrl,
          defaultHeaders: {
            'chatgpt-account-id': tokens.accountId,
            originator: 'rdma26',
            'OpenAI-Beta': 'responses=experimental',
          },
          fetch: createCodexFetch(),
        },
      }),
    };
  }
}

export class ModelProviderNotConfiguredError extends Error {
  constructor(readonly provider: ModelProviderId) {
    super(
      provider === 'openai-api'
        ? 'OPENAI_API_KEY is required to use OpenAI API models.'
        : 'ChatGPT login is required to use OpenAI ChatGPT/Codex models.',
    );
  }
}

export function resolveModelSelection(selectionId: string): ResolvedModelSelection {
  const normalized = selectionId.trim();

  if (normalized.startsWith(chatGptModelPrefix)) {
    const model = normalized.slice(chatGptModelPrefix.length).trim();
    if (!model) throw new Error('A model name is required after the chatgpt: prefix.');

    return {
      selectionId: `${chatGptModelPrefix}${model}`,
      model,
      provider: 'openai-chatgpt',
    };
  }

  if (!normalized) throw new Error('A model selection is required.');

  return {
    selectionId: normalized,
    model: normalized,
    provider: 'openai-api',
  };
}

export function createCodexFetch(
  fetchImplementation: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== 'string') return await fetchImplementation(input, init);

    try {
      const payload: unknown = JSON.parse(init.body);
      if (!isRecord(payload) || !Array.isArray(payload['input'])) {
        return await fetchImplementation(input, init);
      }

      let changed = false;
      for (const item of payload['input']) {
        if (isRecord(item) && item['role'] === 'system') {
          item['role'] = 'developer';
          changed = true;
        }
      }

      return await fetchImplementation(
        input,
        changed ? { ...init, body: JSON.stringify(payload) } : init,
      );
    } catch {
      return await fetchImplementation(input, init);
    }
  };
}

interface OpenAiChatModelOptions {
  readonly temperature?: number;
  readonly includeWebSearchSources?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
