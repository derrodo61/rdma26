import { CompositeBackend, createDeepAgent, FilesystemBackend } from 'deepagents';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { ToolCallStream } from '@langchain/langgraph';
import type { StructuredToolInterface } from '@langchain/core/tools';

import type {
  ChatMessage,
  AgentModelSettings,
  RunContextTokenUsage,
  RunContextToolCall,
  UserProfile,
} from '../../../shared/agent-contracts';
import type { AssistantStorage } from '../storage/assistant-storage';
import {
  emitActivity,
  observeAgentRunActivity,
  waitForActivityObserver,
  type AgentActivityCallback,
} from './agent-activity';
import { createBootloaderPromptForTest } from './agent-prompt';
import { extractText } from './agent-result';
import { createEnabledSubagents } from './agent-subagents';
import { createEnabledAgentMiddleware } from './agent-middleware';
import { LlmAccountingCallbackHandler } from '../llm/llm-accounting-callback';
import type { LlmCallStore } from '../llm/llm-call-store';
import { createOpenAiChatModel } from '../llm/model-factory';
import type { AgentMemoryDirectories } from '../memory/file-memory-store';

interface PersonalAgentRequest {
  readonly runId: string;
  readonly threadId: string;
  readonly model: string;
  readonly agentModels: AgentModelSettings;
  readonly tools: readonly StructuredToolInterface[];
  readonly enabledToolIds: readonly string[];
  readonly isOperatorAgent: boolean;
  readonly userProfile: UserProfile;
  readonly soulContent: string;
  readonly memoryPaths: readonly string[];
  readonly memoryDirectories: AgentMemoryDirectories;
  readonly memoryReadsEnabled: boolean;
  readonly memoryWritesEnabled: boolean;
  readonly messages: readonly ChatMessage[];
  readonly prompt: string;
  readonly llmCallStore: LlmCallStore;
  readonly onActivity?: AgentActivityCallback;
}

export interface PersonalAgentResponse {
  readonly content: string;
  readonly usedFallback: boolean;
  readonly toolCalls: readonly RunContextToolCall[];
  readonly tokenUsage?: RunContextTokenUsage;
}

export class PersonalAgent {
  constructor(
    private readonly storage: AssistantStorage,
    private readonly checkpointer: BaseCheckpointSaver,
  ) {}

  async run(request: PersonalAgentRequest): Promise<PersonalAgentResponse> {
    if (!process.env['OPENAI_API_KEY']) {
      return {
        content: [
          'OpenAI is not configured yet, so this is the local backend fallback.',
          '',
          `I stored your message in thread ${request.threadId}.`,
          `The ${this.storage.agent.name} identity file is ready at ${this.storage.soulPath}.`,
          '',
          'Set OPENAI_API_KEY in .env and restart the backend to use Deep Agents with OpenAI.',
        ].join('\n'),
        usedFallback: true,
        toolCalls: [],
      };
    }

    const llmAccounting = new LlmAccountingCallbackHandler(request.llmCallStore, {
      runId: request.runId,
      provider: 'openai',
      model: request.model,
      purpose: request.isOperatorAgent ? 'operator' : 'chat',
      agentId: this.storage.agent.id,
      threadId: request.threadId,
    });
    const defaultBackend = new FilesystemBackend({
      rootDir: this.storage.deepAgentRootDir,
      virtualMode: true,
    });
    const agent = createDeepAgent({
      model: createOpenAiChatModel(request.model),
      backend: new CompositeBackend(defaultBackend, {
        '/memory/global/': new FilesystemBackend({
          rootDir: request.memoryDirectories.global,
          virtualMode: true,
        }),
        '/memory/agent-user/': new FilesystemBackend({
          rootDir: request.memoryDirectories.agentUser,
          virtualMode: true,
        }),
        '/memory/agent/': new FilesystemBackend({
          rootDir: request.memoryDirectories.agent,
          virtualMode: true,
        }),
      }),
      memory: [...request.memoryPaths],
      permissions: createMemoryFilesystemPermissions(request.memoryReadsEnabled),
      skills: ['/skills/'],
      tools: request.tools,
      middleware: await createEnabledAgentMiddleware(request.enabledToolIds),
      subagents: createEnabledSubagents(
        request.enabledToolIds,
        request.userProfile,
        request.agentModels,
      ),
      checkpointer: this.checkpointer,
      systemPrompt: createBootloaderPromptForTest(
        this.storage.agent,
        request.userProfile,
        request.isOperatorAgent,
        request.soulContent,
        request.memoryWritesEnabled,
        request.enabledToolIds,
      ),
    });

    emitActivity(request.onActivity, {
      label: `${this.storage.agent.name} is preparing the run`,
    });
    const run = await agent.streamEvents(
      {
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      },
      {
        version: 'v3',
        callbacks: [llmAccounting],
        configurable: {
          thread_id: request.threadId,
        },
      },
    );
    const activityObserver = observeAgentRunActivity(run, request.onActivity);
    const toolCallsPromise = collectCurrentToolCalls(run.toolCalls);
    const result: unknown = await run.output;
    const toolCalls = await toolCallsPromise;
    await waitForActivityObserver(activityObserver);

    emitActivity(request.onActivity, {
      label: `${this.storage.agent.name} is writing the answer`,
    });

    return {
      content: extractText(result),
      usedFallback: false,
      toolCalls,
    };
  }
}

export function createMemoryFilesystemPermissions(memoryReadsEnabled: boolean) {
  return [
    {
      operations: ['write'] as const,
      paths: ['/memory', '/memory/**'],
      mode: 'deny' as const,
    },
    ...(memoryReadsEnabled
      ? []
      : [
          {
            operations: ['read'] as const,
            paths: ['/memory', '/memory/**'],
            mode: 'deny' as const,
          },
        ]),
  ];
}

async function collectCurrentToolCalls(
  toolCalls: AsyncIterable<ToolCallStream> | undefined,
): Promise<RunContextToolCall[]> {
  if (!toolCalls) return [];
  const collected: RunContextToolCall[] = [];

  for await (const call of toolCalls) {
    let result: string;
    try {
      result = stringifyToolOutput(await call.output);
    } catch (error) {
      result = error instanceof Error ? error.message : String(error);
    }
    collected.push({
      id: call.callId,
      name: call.name,
      args: call.input,
      result,
    });
  }

  return collected;
}

function stringifyToolOutput(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output);
}
