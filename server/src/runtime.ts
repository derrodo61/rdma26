import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { ChatOpenAI } from '@langchain/openai';

import type {
  AgentProfile,
  AgentRunRequest,
  AgentSoulResponse,
  AgentToolsResponse,
  AgentsResponse,
  AgentMemoryMaintenanceResult,
  ChatThread,
  ChatThreadSummary,
  CreateMemoryRequest,
  CreateAgentRequest,
  CreateThreadRequest,
  DeleteAgentResponse,
  DeleteMemoryResponse,
  DeleteThreadResponse,
  HealthResponse,
  MemoryMaintenanceRequest,
  MemoryMaintenanceResponse,
  MemoryMaintenanceSettings,
  MemoryListRequest,
  MemoryListResponse,
  MemoryRecord,
  ModelOption,
  ModelsResponse,
  RunContextDetails,
  RunContextMemory,
  RunContextTool,
  ThreadSummaryRequest,
  ThreadSummaryResponse,
  ThreadSummariesRequest,
  ThreadSummariesResponse,
  ToolsResponse,
  UpdateAgentRequest,
  UpdateAgentSoulRequest,
  UpdateAgentToolsRequest,
  UpdateMemoryMaintenanceSettingsRequest,
  UpdateMemoryRequest,
  UpdateUserProfileRequest,
  UserProfile,
} from '../../shared/agent-contracts';
import { readAuthConfig } from './auth';
import { AgentRegistry, validateAgentId } from './agent-registry';
import { MemoryMaintenanceSettingsStore } from './memory-maintenance-settings-store';
import { MemoryStore } from './memory-store';
import { PersonalAgent, type PersonalAgentResponse } from './personal-agent';
import { RunContextStore } from './run-context-store';
import { createAdminTools, listAdminToolDefinitions } from './tools/admin-tools';
import { createMemoryTools } from './tools/memory-tools';
import { ToolRegistry } from './tools/tool-registry';
import { UserProfileStore } from './user-profile-store';

export class AssistantRuntime {
  private readonly registry: AgentRegistry;
  private readonly models: readonly ModelOption[];
  private readonly tools = new ToolRegistry();
  private readonly userProfileStore: UserProfileStore;
  private readonly memoryStore: MemoryStore;
  private readonly memoryMaintenanceSettingsStore: MemoryMaintenanceSettingsStore;
  private readonly runContextStore: RunContextStore;

  constructor(options: AssistantRuntimeOptions = readRuntimeOptionsFromEnv()) {
    this.registry = new AgentRegistry(
      options.dataDir,
      options.defaultAgentId,
      options.defaultAgentName,
    );
    this.userProfileStore = new UserProfileStore(options.dataDir);
    this.memoryStore = new MemoryStore(options.dataDir);
    this.memoryMaintenanceSettingsStore = new MemoryMaintenanceSettingsStore(options.dataDir);
    this.runContextStore = new RunContextStore(options.dataDir);
    this.models = readModels();
  }

  async ensureReady(): Promise<void> {
    await this.registry.ensureReady();
    await this.userProfileStore.ensureReady();
    await this.memoryStore.ensureReady();
    await this.memoryMaintenanceSettingsStore.ensureReady();
    await this.runContextStore.ensureReady();
  }

  async health(): Promise<HealthResponse> {
    return {
      ok: true,
      service: 'rdma26-backend',
      agents: await this.listAgents(),
      defaultAgentId: this.registry.getDefaultAgentId(),
      apiKeyConfigured: Boolean(process.env['OPENAI_API_KEY']),
      authEnabled: readAuthConfig().enabled,
      dataDir: this.registry.dataDir,
    };
  }

  modelsResponse(): ModelsResponse {
    return {
      models: this.models,
      defaultModel: process.env['OPENAI_MODEL'] ?? this.models[0].id,
    };
  }

  async agentsResponse(): Promise<AgentsResponse> {
    return {
      agents: await this.listAgents(),
      defaultAgentId: this.registry.getDefaultAgentId(),
    };
  }

  async listAgents(): Promise<AgentProfile[]> {
    return await this.registry.listAgents();
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentProfile> {
    return await this.registry.createAgent(request);
  }

  async updateAgent(agentId: string, request: UpdateAgentRequest): Promise<AgentProfile> {
    return await this.registry.updateAgent(agentId, request);
  }

  async readAgentSoul(agentId: string): Promise<AgentSoulResponse> {
    const storage = await this.storageFor(agentId);

    return {
      agentId: storage.agent.id,
      content: await storage.readSoul(),
      updatedAt: await readFileUpdatedAt(storage.soulPath),
    };
  }

  async updateAgentSoul(
    agentId: string,
    request: UpdateAgentSoulRequest,
  ): Promise<AgentSoulResponse> {
    const storage = await this.storageFor(agentId);
    await storage.writeSoul(request.content);

    return {
      agentId: storage.agent.id,
      content: request.content,
      updatedAt: await readFileUpdatedAt(storage.soulPath),
    };
  }

  async readUserProfile(): Promise<UserProfile> {
    return await this.userProfileStore.readProfile();
  }

  async updateUserProfile(request: UpdateUserProfileRequest): Promise<UserProfile> {
    return await this.userProfileStore.updateProfile(request);
  }

  toolsResponse(): ToolsResponse {
    return {
      tools: this.tools.listDefinitions(),
    };
  }

  async agentToolsResponse(agentId: string): Promise<AgentToolsResponse> {
    const agent = await this.readAgent(agentId);

    return {
      agentId: agent.id,
      enabledTools: agent.enabledTools,
      tools: this.tools.listDefinitions(),
      controlledTools: this.controlledToolsFor(agent.id),
    };
  }

  async updateAgentTools(
    agentId: string,
    request: UpdateAgentToolsRequest,
  ): Promise<AgentToolsResponse> {
    const enabledTools = this.tools.validateToolIds(request.enabledTools);
    const agent = await this.registry.updateAgentTools(agentId, { enabledTools });

    return {
      agentId: agent.id,
      enabledTools: agent.enabledTools,
      tools: this.tools.listDefinitions(),
      controlledTools: this.controlledToolsFor(agent.id),
    };
  }

  async grantAgentTool(agentId: string, toolId: string): Promise<AgentToolsResponse> {
    const agent = await this.readAgent(agentId);

    return await this.updateAgentTools(agentId, {
      enabledTools: [...agent.enabledTools, toolId],
    });
  }

  async revokeAgentTool(agentId: string, toolId: string): Promise<AgentToolsResponse> {
    const agent = await this.readAgent(agentId);
    this.tools.validateToolIds([toolId]);

    return await this.updateAgentTools(agentId, {
      enabledTools: agent.enabledTools.filter((enabledToolId) => enabledToolId !== toolId),
    });
  }

  async deleteAgent(agentId: string): Promise<DeleteAgentResponse> {
    const deleted = await this.registry.deleteAgent(agentId);

    if (!deleted) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    return {
      deleted: true,
      agentId,
    };
  }

  async listMemories(request: MemoryListRequest = {}): Promise<MemoryListResponse> {
    if (request.agentId) {
      await this.readAgent(request.agentId);
    }

    return {
      memories: await this.memoryStore.listMemories(request),
    };
  }

  async readMemory(memoryId: string): Promise<MemoryRecord> {
    return await this.memoryStore.requireMemory(memoryId);
  }

  async createMemory(request: CreateMemoryRequest): Promise<MemoryRecord> {
    if (request.agentId) {
      await this.readAgent(request.agentId);
    }

    return await this.memoryStore.createMemory(request);
  }

  async updateMemory(memoryId: string, request: UpdateMemoryRequest): Promise<MemoryRecord> {
    return await this.memoryStore.updateMemory(memoryId, request);
  }

  async deleteMemory(memoryId: string): Promise<DeleteMemoryResponse> {
    const deleted = await this.memoryStore.deleteMemory(memoryId);

    if (!deleted) {
      throw new Error(`Memory ${memoryId} does not exist.`);
    }

    return {
      deleted: true,
      memoryId,
    };
  }

  async readMemoryMaintenanceSettings(): Promise<MemoryMaintenanceSettings> {
    return await this.memoryMaintenanceSettingsStore.readSettings();
  }

  async updateMemoryMaintenanceSettings(
    request: UpdateMemoryMaintenanceSettingsRequest,
  ): Promise<MemoryMaintenanceSettings> {
    if (request.agentId) {
      await this.readAgent(request.agentId);
    }

    return await this.memoryMaintenanceSettingsStore.updateSettings(request);
  }

  async recordMemoryMaintenanceStarted(startedAt: string): Promise<MemoryMaintenanceSettings> {
    return await this.memoryMaintenanceSettingsStore.recordRunStarted(startedAt);
  }

  async recordMemoryMaintenanceFinished(finishedAt: string): Promise<MemoryMaintenanceSettings> {
    return await this.memoryMaintenanceSettingsStore.recordRunFinished(finishedAt);
  }

  async recordMemoryMaintenanceFailed(errorMessage: string): Promise<MemoryMaintenanceSettings> {
    return await this.memoryMaintenanceSettingsStore.recordRunFailed(errorMessage);
  }

  async readRunContext(runId: string): Promise<RunContextDetails> {
    return await this.runContextStore.requireRunContext(runId);
  }

  async readAgent(agentId: string): Promise<AgentProfile> {
    const agent = await this.registry.readAgent(agentId);

    if (!agent) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    return agent;
  }

  async listThreads(agentId: string): Promise<ChatThreadSummary[]> {
    const storage = await this.storageFor(agentId);

    return await storage.listThreads();
  }

  async createThread(agentId: string, request: CreateThreadRequest = {}): Promise<ChatThread> {
    const storage = await this.storageFor(agentId);

    return await storage.createThread(request.title);
  }

  async readThread(agentId: string, threadId: string): Promise<ChatThread> {
    const storage = await this.storageFor(agentId);
    const thread = await storage.readThread(threadId);

    if (!thread) {
      throw new Error(`Thread ${threadId} does not exist for agent ${agentId}.`);
    }

    return thread;
  }

  async deleteThread(agentId: string, threadId: string): Promise<DeleteThreadResponse> {
    const storage = await this.storageFor(agentId);
    const deleted = await storage.deleteThread(threadId);

    if (!deleted) {
      throw new Error(`Thread ${threadId} does not exist for agent ${agentId}.`);
    }

    await this.memoryStore.deleteThreadSummaryMemories(agentId, threadId);
    await this.runContextStore.deleteRunsForThread(agentId, threadId);

    return {
      deleted: true,
      agentId,
      threadId,
    };
  }

  async consolidateThreadSummary(
    agentId: string,
    threadId: string,
    request: ThreadSummaryRequest = {},
  ): Promise<ThreadSummaryResponse> {
    const thread = await this.readThread(agentId, threadId);

    if (!thread.messages.length) {
      throw new Error('Cannot create a thread summary for an empty thread.');
    }

    return {
      agentId: thread.agentId,
      threadId: thread.id,
      ...(await this.upsertThreadSummaryMemory(thread, request.model)),
    };
  }

  async consolidateAgentThreadSummaries(
    agentId: string,
    request: ThreadSummariesRequest = {},
  ): Promise<ThreadSummariesResponse> {
    const threads = await this.listThreads(agentId);
    const limitedThreads =
      request.limit === undefined ? threads : threads.slice(0, Math.max(0, request.limit));
    const summaries: ThreadSummaryResponse[] = [];
    const skippedEmptyThreads: string[] = [];

    for (const threadSummary of limitedThreads) {
      const thread = await this.readThread(agentId, threadSummary.id);

      if (!thread.messages.length) {
        skippedEmptyThreads.push(thread.id);
        continue;
      }

      summaries.push(await this.consolidateThreadSummary(agentId, thread.id, request));
    }

    return {
      agentId,
      summaries,
      skippedEmptyThreads,
    };
  }

  async runMemoryMaintenance(
    request: MemoryMaintenanceRequest = {},
  ): Promise<MemoryMaintenanceResponse> {
    const startedAt = new Date().toISOString();
    const agents =
      request.agentId === undefined
        ? (await this.agentsResponse()).agents
        : [await this.readAgent(request.agentId)];
    const results: AgentMemoryMaintenanceResult[] = [];

    for (const agent of agents) {
      if (!agent.memory.canWrite) {
        results.push({
          agentId: agent.id,
          summaries: [],
          skippedEmptyThreads: [],
          skippedReason: 'memory_writes_disabled',
        });
        continue;
      }

      results.push(
        await this.consolidateAgentThreadSummaries(agent.id, {
          model: request.model,
          limit: request.limitPerAgent,
        }),
      );
    }

    return {
      mode: 'manual',
      startedAt,
      finishedAt: new Date().toISOString(),
      agents: results,
    };
  }

  async runAgent(request: AgentRunRequest, options: RunAgentOptions = {}): Promise<RunAgentResult> {
    const runId = options.runId ?? crypto.randomUUID();
    const storage = await this.storageFor(request.agentId);
    const existingThread = await storage.readThread(request.threadId);

    if (!existingThread) {
      throw new Error(`Thread ${request.threadId} does not exist for agent ${request.agentId}.`);
    }

    const tools = [
      ...this.tools.createTools(storage.agent.enabledTools),
      ...(storage.agent.memory.canWrite ? createMemoryTools(this, storage.agent.id) : []),
      ...this.adminToolsFor(storage.agent.id),
    ];
    const toolContext = this.runContextToolsFor(
      storage.agent.id,
      storage.agent.enabledTools,
      storage.agent.memory.canWrite,
    );
    const userProfile = await this.readUserProfile();
    const soulContent = await storage.readSoul();
    const memories = await this.memoryStore.searchForRun(storage.agent.id, request.prompt);
    const userThread = await storage.appendMessage(request.threadId, {
      role: 'user',
      content: request.prompt,
    });
    const agentResponse = await new PersonalAgent(storage).run({
      threadId: request.threadId,
      model: request.model,
      tools,
      enabledToolIds: storage.agent.enabledTools,
      isOperatorAgent: storage.agent.id === this.getDefaultAgentId(),
      userProfile,
      soulContent,
      memories: memories.map((memory) => memory.memory),
      memoryWritesEnabled: storage.agent.memory.canWrite,
      messages: userThread.messages,
      prompt: request.prompt,
    });
    const thread = await storage.appendMessage(request.threadId, {
      role: 'assistant',
      content: agentResponse.content,
    });
    if (storage.agent.memory.canWrite) {
      try {
        await this.upsertThreadSummaryMemory(thread, request.model);
      } catch {
        // Chat runs should not fail when no summary model is configured.
      }
    }
    const runContext = await this.runContextStore.writeRunContext({
      runId,
      agentId: storage.agent.id,
      agentName: storage.agent.name,
      threadId: request.threadId,
      threadTitle: thread.title,
      model: request.model,
      createdAt: new Date().toISOString(),
      prompt: request.prompt,
      assistantResponse: agentResponse.content,
      soulVirtualPath: storage.agent.soulVirtualPath,
      soulContent,
      userProfile,
      memories: memories.map((memory) => toRunContextMemory(memory)),
      messages: userThread.messages.map((message) => ({
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        content: message.content,
      })),
      tools: toolContext,
      toolCalls: agentResponse.toolCalls,
      tokenUsage: agentResponse.tokenUsage,
      memoryWritesEnabled: storage.agent.memory.canWrite,
    });

    return {
      agentResponse,
      runContext,
      runId,
      thread,
    };
  }

  getDefaultAgentId(): string {
    return this.registry.getDefaultAgentId();
  }

  private async storageFor(agentId: string) {
    validateAgentId(agentId);

    return await this.registry.storageFor(agentId);
  }

  private adminToolsFor(agentId: string) {
    return agentId === this.getDefaultAgentId() ? createAdminTools(this) : [];
  }

  private controlledToolsFor(agentId: string) {
    return agentId === this.getDefaultAgentId() ? listAdminToolDefinitions() : [];
  }

  private runContextToolsFor(
    agentId: string,
    enabledToolIds: readonly string[],
    canWriteMemory: boolean,
  ): readonly RunContextTool[] {
    const enabledToolIdSet = new Set(enabledToolIds);
    const assignableTools = this.tools
      .listDefinitions()
      .filter((tool) => tool.available && enabledToolIdSet.has(tool.id))
      .map((tool) => ({
        id: tool.id,
        label: tool.label,
        description: tool.description,
        provider: tool.provider,
        controlled: false,
      }));
    const memoryTools = canWriteMemory
      ? [
          {
            id: 'save_memory',
            label: 'Save memory',
            description: 'Save an important long-term memory for this agent.',
            provider: 'rdma26-memory',
            controlled: true,
          },
        ]
      : [];
    const adminTools = this.controlledToolsFor(agentId).map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
      provider: tool.provider,
      controlled: true,
    }));

    return [...assignableTools, ...memoryTools, ...adminTools];
  }

  private async upsertThreadSummaryMemory(
    thread: ChatThread,
    requestedModel?: string,
  ): Promise<ThreadSummaryMemoryResult> {
    if (!thread.messages.length) {
      throw new Error('Cannot create a thread summary for an empty thread.');
    }

    const existing = await this.memoryStore.findThreadSummary(thread.agentId, thread.id);
    const summary = await this.createThreadSummaryContent(
      thread,
      existing?.content,
      requestedModel,
    );
    const request = {
      type: 'conversation_summary' as const,
      lifetime: 'active' as const,
      content: summary.content,
      tags: ['thread-summary'],
      source: {
        agentId: thread.agentId,
        threadId: thread.id,
        note: `Model-generated thread summary using ${summary.model}.`,
      },
    };

    if (existing) {
      return {
        model: summary.model,
        memory: await this.memoryStore.updateMemory(existing.id, request),
      };
    }

    return {
      model: summary.model,
      memory: await this.memoryStore.createMemory({
        scope: 'agent',
        agentId: thread.agentId,
        ...request,
      }),
    };
  }

  private async createThreadSummaryContent(
    thread: ChatThread,
    previousContent: string | undefined,
    requestedModel: string | undefined,
  ): Promise<ThreadSummaryContent> {
    const model = requestedModel ?? process.env['OPENAI_SUMMARY_MODEL'] ?? this.models[0]?.id;

    if (!process.env['OPENAI_API_KEY']) {
      throw new Error('Cannot create a thread summary because OPENAI_API_KEY is not configured.');
    }

    if (!model) {
      throw new Error('Cannot create a thread summary because no summary model is configured.');
    }

    const content = await createModelThreadSummaryContent(thread, previousContent, model);

    return {
      model,
      content,
    };
  }
}

interface ThreadSummaryMemoryResult {
  readonly model?: string;
  readonly memory: MemoryRecord;
}

interface ThreadSummaryContent {
  readonly model?: string;
  readonly content: string;
}

async function createModelThreadSummaryContent(
  thread: ChatThread,
  previousContent: string | undefined,
  model: string,
): Promise<string> {
  const llm = new ChatOpenAI({
    apiKey: process.env['OPENAI_API_KEY'],
    model,
    temperature: 0,
  });
  const transcript = thread.messages
    .slice(-40)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');
  const result = await llm.invoke([
    {
      role: 'system',
      content: [
        'Create a concise long-term memory summary for a personal multi-agent assistant.',
        'Focus on durable facts, preferences, decisions, tracked topics, and open tasks.',
        'Do not invent details. Do not include private information that is not in the transcript.',
        'Use plain language. Prefer compact bullet points.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        previousContent ? `Previous summary:\n${previousContent}` : 'Previous summary: none',
        '',
        `Thread title: ${thread.title}`,
        `Thread updated at: ${thread.updatedAt}`,
        '',
        'Recent transcript:',
        transcript,
      ].join('\n'),
    },
  ]);
  const modelSummary = extractModelText(result).trim();

  if (!modelSummary) {
    throw new Error('Model summary was empty.');
  }

  return truncateSummaryContent(
    [
      `Conversation summary for thread "${thread.title}".`,
      `Last updated: ${thread.updatedAt}.`,
      `Model-generated summary using ${model}:`,
      modelSummary,
    ].join('\n'),
  );
}

function truncateSummaryContent(content: string): string {
  const maxLength = 4000;

  return content.length > maxLength ? `${content.slice(0, maxLength - 3).trimEnd()}...` : content;
}

function extractModelText(result: unknown): string {
  const content = readProperty<unknown>(result, 'content');

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => readProperty<unknown>(part, 'text'))
      .filter((part): part is string => typeof part === 'string')
      .join('\n');
  }

  return '';
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}

function toRunContextMemory(memory: {
  readonly memory: MemoryRecord;
  readonly source: {
    readonly score: number;
  };
}): RunContextMemory {
  return {
    memoryId: memory.memory.id,
    scope: memory.memory.scope,
    agentId: memory.memory.agentId,
    type: memory.memory.type,
    status: memory.memory.status,
    lifetime: memory.memory.lifetime,
    tags: memory.memory.tags,
    source: memory.memory.source,
    score: memory.source.score,
    content: memory.memory.content,
  };
}

async function readFileUpdatedAt(path: string): Promise<string> {
  return (await stat(path)).mtime.toISOString();
}

export interface RunAgentResult {
  readonly agentResponse: PersonalAgentResponse;
  readonly runContext: RunContextDetails;
  readonly runId: string;
  readonly thread: ChatThread;
}

export interface RunAgentOptions {
  readonly runId?: string;
}

export interface AssistantRuntimeOptions {
  readonly dataDir: string;
  readonly defaultAgentId: string;
  readonly defaultAgentName: string;
}

export function readRuntimeOptionsFromEnv(): AssistantRuntimeOptions {
  return {
    dataDir: process.env['ASSISTANT_DATA_DIR'] ?? join(process.cwd(), '.assistant-data'),
    defaultAgentId: process.env['ASSISTANT_AGENT_ID'] ?? 'scotty',
    defaultAgentName: process.env['ASSISTANT_AGENT_NAME'] ?? 'Scotty',
  };
}

function readModels(): readonly ModelOption[] {
  const configured = process.env['OPENAI_MODELS']
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const modelIds = configured?.length ? configured : ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'];

  return modelIds.map((id) => ({
    id,
    label: id,
    provider: 'openai',
    requiresApiKey: true,
  }));
}
