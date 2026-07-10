import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import type { StructuredToolInterface } from '@langchain/core/tools';

import type {
  ChatMessage,
  AgentModelSettings,
  MemoryRecord,
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
import { extractText, extractTokenUsage, extractToolCalls } from './agent-result';
import { createEnabledSubagents } from './agent-subagents';
import { LlmAccountingCallbackHandler } from '../llm/llm-accounting-callback';
import type { LlmCallStore } from '../llm/llm-call-store';
import { createOpenAiChatModel } from '../llm/model-factory';

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
  readonly memories: readonly MemoryRecord[];
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
  private readonly checkpointer = new MemorySaver();

  constructor(private readonly storage: AssistantStorage) {}

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
    const agent = createDeepAgent({
      model: createOpenAiChatModel(request.model),
      backend: new FilesystemBackend({
        rootDir: this.storage.deepAgentRootDir,
        virtualMode: true,
      }),
      skills: ['/skills/'],
      tools: request.tools,
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
        request.memories,
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
    const result: unknown = await run.output;
    await waitForActivityObserver(activityObserver);

    emitActivity(request.onActivity, {
      label: `${this.storage.agent.name} is writing the answer`,
    });

    return {
      content: extractText(result),
      usedFallback: false,
      toolCalls: extractToolCalls(result),
      tokenUsage: extractTokenUsage(result),
    };
  }
}
