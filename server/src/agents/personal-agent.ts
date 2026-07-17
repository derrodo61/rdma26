import { CompositeBackend, createDeepAgent, FilesystemBackend } from 'deepagents';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { ServerTool, StructuredToolInterface } from '@langchain/core/tools';
import { tools as openAiTools } from '@langchain/openai';

import type {
  ChatMessage,
  RunContextTokenUsage,
  RunContextSkillUsage,
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
import { createEnabledAgentMiddleware } from './agent-middleware';
import { LlmAccountingCallbackHandler } from '../llm/llm-accounting-callback';
import type { LlmCallStore } from '../llm/llm-call-store';
import { ModelProviderNotConfiguredError, type OpenAiModelFactory } from '../llm/model-factory';
import { extractOpenAiHostedWebToolCallsFromAgentResult } from '../llm/openai-hosted-web-search';
import type { AgentMemoryDirectories } from '../memory/file-memory-store';
import { ToolCallObserver } from './tool-call-observer';

interface PersonalAgentRequest {
  readonly runId: string;
  readonly threadId: string;
  readonly model: string;
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
  readonly signal?: AbortSignal;
}

export interface PersonalAgentResponse {
  readonly content: string;
  readonly usedFallback: boolean;
  readonly toolCalls: readonly RunContextToolCall[];
  readonly skillsUsed: readonly RunContextSkillUsage[];
  readonly tokenUsage?: RunContextTokenUsage;
}

export class PersonalAgent {
  constructor(
    private readonly storage: AssistantStorage,
    private readonly checkpointer: BaseCheckpointSaver,
    private readonly modelFactory: OpenAiModelFactory,
  ) {}

  async run(request: PersonalAgentRequest): Promise<PersonalAgentResponse> {
    let configuredModel;

    try {
      configuredModel = await this.modelFactory.createChatModel(request.model, {
        includeWebSearchSources: request.enabledToolIds.includes('web_search'),
      });
    } catch (error) {
      if (!(error instanceof ModelProviderNotConfiguredError)) throw error;

      const setup =
        error.provider === 'openai-api'
          ? 'Set OPENAI_API_KEY in .env and restart the backend.'
          : 'Sign in from Model Providers settings or run rdma26 providers:login --provider openai-chatgpt.';
      return {
        content: [
          `${error.message} This is the local backend fallback.`,
          '',
          `I stored your message in thread ${request.threadId}.`,
          `The ${this.storage.agent.name} identity file is ready at ${this.storage.soulPath}.`,
          '',
          setup,
        ].join('\n'),
        usedFallback: true,
        toolCalls: [],
        skillsUsed: [],
      };
    }

    const llmAccounting = new LlmAccountingCallbackHandler(request.llmCallStore, {
      runId: request.runId,
      provider: configuredModel.accountingProvider,
      model: configuredModel.model,
      purpose: request.isOperatorAgent ? 'operator' : 'chat',
      agentId: this.storage.agent.id,
      threadId: request.threadId,
      signal: request.signal,
    });
    const defaultBackend = new FilesystemBackend({
      rootDir: this.storage.deepAgentRootDir,
      virtualMode: true,
    });
    const agent = createDeepAgent({
      model: configuredModel.instance,
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
      tools: createAgentTools(request.tools, request.enabledToolIds),
      middleware: await createEnabledAgentMiddleware(request.enabledToolIds),
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
    const agentInput = {
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };
    const agentConfig = {
      callbacks: [llmAccounting],
      signal: request.signal,
      configurable: {
        thread_id: request.threadId,
      },
    };

    if (request.enabledToolIds.includes('web_search')) {
      const toolCallObserver = new ToolCallObserver();
      emitActivity(request.onActivity, {
        label: `${this.storage.agent.name} is searching the web`,
      });
      const result: unknown = await agent.invoke(agentInput, {
        ...agentConfig,
        callbacks: [...agentConfig.callbacks, toolCallObserver],
      });
      const toolCalls = [
        ...toolCallObserver.collected(),
        ...extractOpenAiHostedWebToolCallsFromAgentResult(result),
      ];
      emitActivity(request.onActivity, {
        label: `${this.storage.agent.name} is writing the answer`,
      });

      return {
        content: extractText(result),
        usedFallback: false,
        toolCalls,
        skillsUsed: extractSkillUsages(toolCalls),
      };
    }

    const run = await agent.streamEvents(agentInput, {
      ...agentConfig,
      version: 'v3',
    });
    const activityObserver = observeAgentRunActivity(run, request.onActivity);
    const toolCallsPromise = collectRunToolCalls(run);
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
      skillsUsed: extractSkillUsages(toolCalls),
    };
  }
}

export function extractSkillUsages(
  toolCalls: readonly RunContextToolCall[],
): readonly RunContextSkillUsage[] {
  const skills = new Map<string, RunContextSkillUsage>();

  for (const toolCall of toolCalls) {
    if (toolCall.name !== 'read_file' || !isRecord(toolCall.args)) continue;
    const path = toolCall.args['file_path'];
    if (typeof path !== 'string') continue;
    const match = path.match(/^\/skills\/([^/]+)\/SKILL\.md$/);
    if (!match?.[1]) continue;
    skills.set(match[1], { name: match[1], path });
  }

  return [...skills.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createAgentTools(
  runnableTools: readonly StructuredToolInterface[],
  enabledToolIds: readonly string[],
): readonly (StructuredToolInterface | ServerTool)[] {
  return enabledToolIds.includes('web_search')
    ? [
        ...runnableTools,
        openAiTools.webSearch({
          search_context_size: 'medium',
        }),
      ]
    : runnableTools;
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

export async function collectRunToolCalls(run: AgentRunToolStreams): Promise<RunContextToolCall[]> {
  const [toolCalls, subagentToolCalls] = await Promise.all([
    collectCurrentToolCalls(run.toolCalls),
    collectSubagentToolCalls(run.subagents),
  ]);

  return [...toolCalls, ...subagentToolCalls];
}

async function collectCurrentToolCalls(
  toolCalls: AsyncIterable<ToolCallStreamLike> | undefined,
  agentName?: string,
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
      agentName,
      args: call.input,
      result,
    });
  }

  return collected;
}

async function collectSubagentToolCalls(
  subagents: AsyncIterable<SubagentToolStreams> | undefined,
): Promise<RunContextToolCall[]> {
  if (!subagents) return [];
  const pending: Promise<RunContextToolCall[]>[] = [];

  for await (const subagent of subagents) {
    pending.push(
      Promise.all([
        collectCurrentToolCalls(subagent.toolCalls, subagent.name),
        collectSubagentToolCalls(subagent.subagents),
      ]).then(([toolCalls, nestedToolCalls]) => [...toolCalls, ...nestedToolCalls]),
    );
  }

  return (await Promise.all(pending)).flat();
}

function stringifyToolOutput(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output);
}

interface AgentRunToolStreams {
  readonly toolCalls?: AsyncIterable<ToolCallStreamLike>;
  readonly subagents?: AsyncIterable<SubagentToolStreams>;
}

interface SubagentToolStreams extends AgentRunToolStreams {
  readonly name: string;
}

interface ToolCallStreamLike {
  readonly callId?: string;
  readonly name: string;
  readonly input: unknown;
  readonly output: Promise<unknown>;
}
