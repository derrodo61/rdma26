import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import type { StructuredToolInterface } from '@langchain/core/tools';

import type { ChatMessage } from '../../shared/agent-contracts';
import type { AssistantStorage } from './storage';

export interface PersonalAgentRequest {
  readonly threadId: string;
  readonly model: string;
  readonly tools: readonly StructuredToolInterface[];
  readonly messages: readonly ChatMessage[];
  readonly prompt: string;
}

export interface PersonalAgentResponse {
  readonly content: string;
  readonly usedFallback: boolean;
}

export class PersonalAgent {
  private readonly checkpointer = new MemorySaver();

  constructor(private readonly storage: AssistantStorage) {}

  async run(request: PersonalAgentRequest): Promise<PersonalAgentResponse> {
    if (!process.env['OPENAI_API_KEY']) {
      return {
        content: [
          'OpenAI is not configured yet, so this is the local backend fallback.',
          '',
          `I stored your message in thread ${request.threadId}.`,
          `The ${this.storage.agent.name} memory file is ready at ${this.storage.soulPath}.`,
          '',
          'Set OPENAI_API_KEY in .env and restart the backend to use Deep Agents with OpenAI.',
        ].join('\n'),
        usedFallback: true,
      };
    }

    const agent = createDeepAgent({
      model: new ChatOpenAI({
        apiKey: process.env['OPENAI_API_KEY'],
        model: request.model,
      }),
      backend: new FilesystemBackend({
        rootDir: this.storage.deepAgentRootDir,
        virtualMode: true,
      }),
      tools: request.tools,
      memory: [this.storage.agent.soulVirtualPath],
      checkpointer: this.checkpointer,
      systemPrompt: createBootloaderPrompt(this.storage.agent),
    });

    const result: unknown = await agent.invoke(
      {
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      },
      {
        configurable: {
          thread_id: request.threadId,
        },
      },
    );

    return {
      content: extractText(result),
      usedFallback: false,
    };
  }
}

function createBootloaderPrompt(agent: { name: string; soulVirtualPath: string }): string {
  return `You are the configured local agent named "${agent.name}".

Your editable identity, role, preferences, and long-term working agreements live in ${agent.soulVirtualPath}.

Read ${agent.soulVirtualPath} before answering when it can help. Treat that file as the source of truth for who this agent is. Update it when Rolf explicitly asks you to remember something or when a durable preference is clear.

Use enabled tools when they are useful. Do not claim to have tools that are not available in the current run.

If the file does not contain a specific instruction for a situation, be practical, conversational, and clear about uncertainty.`;
}

function extractText(result: unknown): string {
  const messages = readProperty<unknown[]>(result, 'messages');
  const lastMessage = messages?.at(-1);
  const content = readProperty<unknown>(lastMessage, 'content');

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => readProperty<unknown>(part, 'text'))
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
      .trim();

    if (text) {
      return text;
    }
  }

  return 'The agent completed the run, but no assistant text was returned.';
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}
