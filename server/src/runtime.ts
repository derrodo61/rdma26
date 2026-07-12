import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import type {
  AgentProfile,
  AgentRunRequest,
  AgentSoulResponse,
  AgentToolsResponse,
  AgentsResponse,
  ChatThread,
  ChatThreadSummary,
  CostSummaryRequest,
  CostSummaryResponse,
  CreateMemoryRequest,
  CreateModelPricingRequest,
  CreatePricingSourceRequest,
  CreateAgentRequest,
  CreateThreadRequest,
  DeleteAgentResponse,
  DeleteMemoryResponse,
  DeleteModelPricingResponse,
  DeletePricingSourceResponse,
  DeleteThreadResponse,
  HealthResponse,
  LlmCallListRequest,
  LlmCallListResponse,
  LlmCallRecord,
  MemoryListRequest,
  MemoryListResponse,
  MemoryPinnedBudgetsResponse,
  MemoryRecord,
  ModelOption,
  ModelPricingListRequest,
  ModelPricingListResponse,
  ModelPricingRecord,
  ModelsResponse,
  OptimizerRunRequest,
  OptimizerRunResponse,
  PricingSourceListRequest,
  PricingSourceListResponse,
  PricingSourceRecord,
  RunContextDetails,
  SyncOpenAiModelPricingResult,
  ToolsResponse,
  UpdateAgentRequest,
  UpdateAgentSoulRequest,
  UpdateAgentToolsRequest,
  UpdateMemoryRequest,
  UpdateModelPricingRequest,
  UpdatePricingSourceRequest,
  UpdateUserProfileRequest,
  UserProfile,
} from '../../shared/agent-contracts';
import { readAuthConfig } from './auth';
import { AgentRegistry, validateAgentId } from './agents/agent-registry';
import {
  costAnalystDefaultEnabledTools,
  costAnalystAgentId,
  costAnalystAgentName,
  isSystemOperatorAgent,
} from './agents/system-agents';
import { listAdminToolDefinitions } from './capabilities/admin-tools';
import { CapabilityRegistry } from './capabilities/capability-registry';
import { ChatRunService, type RunAgentOptions, type RunAgentResult } from './chat/chat-run-service';
import { FileMemoryStore } from './memory/file-memory-store';
import { SqliteSemanticMemoryIndex } from './memory/semantic-memory-index';
import { UserProfileStore } from './profiles/user-profile-store';
import { LlmCallStore } from './llm/llm-call-store';
import { ModelPricingStore } from './llm/model-pricing-store';
import { syncOpenAiModelPricingFromSource } from './llm/openai-pricing-sync';
import { PricingSourceStore } from './llm/pricing-source-store';
import { AccountingOpenAiEmbeddingClient } from './llm/openai-embedding-client';
import type { EmbeddingAccountingContext } from './llm/openai-embedding-client';
import { readWebPage } from './research/web-page-reader';
import { RunContextStore } from './runs/run-context-store';
import { ThreadService } from './threads/thread-service';
import { ThreadCheckpointer } from './threads/thread-checkpointer';

export class AssistantRuntime {
  private readonly registry: AgentRegistry;
  private readonly models: readonly ModelOption[];
  private readonly capabilities = new CapabilityRegistry();
  private readonly userProfileStore: UserProfileStore;
  private readonly fileMemoryStore: FileMemoryStore;
  private readonly runContextStore: RunContextStore;
  private readonly modelPricingStore: ModelPricingStore;
  private readonly pricingSourceStore: PricingSourceStore;
  private readonly llmCallStore: LlmCallStore;
  private readonly embeddingModel: string;
  private readonly threadCheckpointer: ThreadCheckpointer;
  private readonly threads: ThreadService;
  private readonly chatRuns: ChatRunService;

  constructor(options: AssistantRuntimeOptions = readRuntimeOptionsFromEnv()) {
    this.registry = new AgentRegistry(
      options.dataDir,
      options.defaultAgentId,
      options.defaultAgentName,
    );
    this.userProfileStore = new UserProfileStore(options.dataDir);
    this.modelPricingStore = new ModelPricingStore(options.dataDir);
    this.llmCallStore = new LlmCallStore(options.dataDir, this.modelPricingStore);
    this.embeddingModel = process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small';
    const apiKey = process.env['OPENAI_API_KEY'];
    const semanticMemoryIndex = apiKey
      ? new SqliteSemanticMemoryIndex(
          options.dataDir,
          new AccountingOpenAiEmbeddingClient(apiKey, this.embeddingModel, this.llmCallStore),
          this.embeddingModel,
        )
      : undefined;
    this.fileMemoryStore = new FileMemoryStore(options.dataDir, undefined, semanticMemoryIndex);
    this.runContextStore = new RunContextStore(options.dataDir);
    this.pricingSourceStore = new PricingSourceStore(options.dataDir);
    this.threadCheckpointer = new ThreadCheckpointer(options.dataDir);
    this.models = readModels();
    this.threads = new ThreadService(
      this.registry,
      this.runContextStore,
      this.llmCallStore,
      this.threadCheckpointer,
    );
    this.chatRuns = new ChatRunService(
      this.registry,
      this.capabilities,
      this.fileMemoryStore,
      this.runContextStore,
      this.llmCallStore,
      this.userProfileStore,
      this.threadCheckpointer,
      this,
    );
  }

  async ensureReady(): Promise<void> {
    await this.registry.ensureReady();
    const costAnalyst = await this.registry.ensureAgent({
      id: costAnalystAgentId,
      name: costAnalystAgentName,
      kind: 'internal',
      chatEnabled: true,
    });
    const costAnalystTools = new Set([
      ...costAnalyst.enabledTools,
      ...costAnalystDefaultEnabledTools,
    ]);

    if (costAnalystTools.size !== costAnalyst.enabledTools.length) {
      await this.registry.updateAgentTools(costAnalystAgentId, {
        enabledTools: Array.from(costAnalystTools),
      });
    }

    if (!costAnalyst.chatEnabled) {
      await this.registry.updateAgent(costAnalystAgentId, {
        chatEnabled: true,
      });
    }

    if (costAnalyst.memory.canRead || costAnalyst.memory.canWrite) {
      await this.registry.updateAgent(costAnalystAgentId, {
        memory: {
          canRead: false,
          canWrite: false,
        },
      });
    }

    const costAnalystStorage = await this.registry.storageFor(costAnalystAgentId);
    await costAnalystStorage.ensureReady();
    await this.userProfileStore.ensureReady();
    await this.fileMemoryStore.ensureReady();
    await this.runContextStore.ensureReady();
    await this.modelPricingStore.ensureReady();
    await this.pricingSourceStore.ensureReady();
    await this.pricingSourceStore.ensureDefaultSources();
    await this.llmCallStore.ensureReady();
    await this.threadCheckpointer.ensureReady();
    await this.runContextStore.deleteOrphanedRuns();
    await this.llmCallStore.deleteOrphanedCalls();
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
      tools: this.capabilities.listDefinitions(),
    };
  }

  async agentToolsResponse(agentId: string): Promise<AgentToolsResponse> {
    const agent = await this.readAgent(agentId);

    return {
      agentId: agent.id,
      enabledTools: agent.enabledTools,
      tools: this.capabilities.listDefinitions(),
      controlledTools: this.controlledToolsFor(agent.id),
    };
  }

  async updateAgentTools(
    agentId: string,
    request: UpdateAgentToolsRequest,
  ): Promise<AgentToolsResponse> {
    const enabledTools = this.capabilities.validateCapabilityIds(request.enabledTools);
    const agent = await this.registry.updateAgentTools(agentId, { enabledTools });

    return {
      agentId: agent.id,
      enabledTools: agent.enabledTools,
      tools: this.capabilities.listDefinitions(),
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
    this.capabilities.validateCapabilityIds([toolId]);

    return await this.updateAgentTools(agentId, {
      enabledTools: agent.enabledTools.filter((enabledToolId) => enabledToolId !== toolId),
    });
  }

  async deleteAgent(agentId: string): Promise<DeleteAgentResponse> {
    const threads = await this.listThreads(agentId);
    await this.llmCallStore.deleteCallsForAgent(agentId);
    const deleted = await this.registry.deleteAgent(agentId);

    if (!deleted) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    await Promise.all(
      threads.map(async (thread) => await this.threadCheckpointer.deleteThread(thread.id)),
    );

    return {
      deleted: true,
      agentId,
    };
  }

  async listMemories(
    request: MemoryListRequest = {},
    embeddingContext?: Omit<EmbeddingAccountingContext, 'operation'>,
  ): Promise<MemoryListResponse> {
    if (request.agentId) {
      await this.readAgent(request.agentId);
    }

    return {
      memories: await this.fileMemoryStore.listEntries(request, {
        agentId: request.agentId,
        ...embeddingContext,
      }),
    };
  }

  async readMemory(memoryId: string): Promise<MemoryRecord> {
    return await this.fileMemoryStore.requireEntry(memoryId);
  }

  async readMemoryPinnedBudgets(agentId: string): Promise<MemoryPinnedBudgetsResponse> {
    await this.readAgent(agentId);
    return {
      agentId,
      budgets: await this.fileMemoryStore.pinnedBudgetsForAgent(agentId),
    };
  }

  async createMemory(request: CreateMemoryRequest): Promise<MemoryRecord> {
    if (request.agentId) {
      await this.readAgent(request.agentId);
    }

    return await this.fileMemoryStore.createEntry(request);
  }

  async updateMemory(memoryId: string, request: UpdateMemoryRequest): Promise<MemoryRecord> {
    return await this.fileMemoryStore.updateEntry(memoryId, request);
  }

  async deleteMemory(memoryId: string): Promise<DeleteMemoryResponse> {
    const deleted = await this.fileMemoryStore.deleteEntry(memoryId);

    if (!deleted) {
      throw new Error(`Memory ${memoryId} does not exist.`);
    }

    return {
      deleted: true,
      memoryId,
    };
  }

  async readRunContext(runId: string): Promise<RunContextDetails> {
    return await this.withLlmCalls(await this.runContextStore.requireRunContext(runId));
  }

  async listLlmCalls(request: LlmCallListRequest = {}): Promise<LlmCallListResponse> {
    return {
      calls: await this.llmCallStore.listCalls(request),
    };
  }

  async readLlmCall(callId: string): Promise<LlmCallRecord> {
    return await this.llmCallStore.requireCall(callId);
  }

  async summarizeCosts(request: CostSummaryRequest = {}): Promise<CostSummaryResponse> {
    return await this.llmCallStore.summarizeCosts(request);
  }

  async listModelPricing(request: ModelPricingListRequest = {}): Promise<ModelPricingListResponse> {
    return {
      pricing: await this.modelPricingStore.listPricing(request),
    };
  }

  async createModelPricing(request: CreateModelPricingRequest): Promise<ModelPricingRecord> {
    return await this.modelPricingStore.createPricing(request);
  }

  async updateModelPricing(
    pricingId: string,
    request: UpdateModelPricingRequest,
  ): Promise<ModelPricingRecord> {
    return await this.modelPricingStore.updatePricing(pricingId, request);
  }

  async setModelPricingActive(pricingId: string, active: boolean): Promise<ModelPricingRecord> {
    return await this.modelPricingStore.setPricingActive(pricingId, active);
  }

  async deleteModelPricing(pricingId: string): Promise<DeleteModelPricingResponse> {
    return await this.modelPricingStore.deletePricing(pricingId);
  }

  async listPricingSources(
    request: PricingSourceListRequest = {},
  ): Promise<PricingSourceListResponse> {
    return {
      sources: await this.pricingSourceStore.listSources(request),
    };
  }

  async createPricingSource(request: CreatePricingSourceRequest): Promise<PricingSourceRecord> {
    return await this.pricingSourceStore.createSource(request);
  }

  async updatePricingSource(
    sourceId: string,
    request: UpdatePricingSourceRequest,
  ): Promise<PricingSourceRecord> {
    return await this.pricingSourceStore.updateSource(sourceId, request);
  }

  async deletePricingSource(sourceId: string): Promise<DeletePricingSourceResponse> {
    return await this.pricingSourceStore.deleteSource(sourceId);
  }

  async checkPricingSource(sourceId: string): Promise<PricingSourceRecord> {
    return await this.pricingSourceStore.checkSource(sourceId);
  }

  async readPricingSourcePage(sourceId: string) {
    const source = await this.pricingSourceStore.requireSource(sourceId);

    return {
      source,
      page: await readWebPage(source.url, {
        maxCharacters: 30_000,
      }),
    };
  }

  async syncOpenAiModelPricing(
    sourceId?: string,
    apply = false,
  ): Promise<SyncOpenAiModelPricingResult> {
    const source = sourceId
      ? await this.pricingSourceStore.requireSource(sourceId)
      : await this.findActiveOfficialOpenAiPricingSource();
    const savedPricing = await this.modelPricingStore.listPricing({
      provider: 'openai',
      status: 'active',
    });

    try {
      const embeddingPricingUrl = `https://developers.openai.com/api/docs/models/${encodeURIComponent(this.embeddingModel)}`;
      const result = await syncOpenAiModelPricingFromSource(source, savedPricing, [
        { model: this.embeddingModel, url: embeddingPricingUrl },
      ]);
      await this.pricingSourceStore.recordSourceCheck(source.id, result.source.retrievedAt);

      if (!apply) {
        return result;
      }

      const updatedModels: string[] = [];

      for (const comparison of result.different) {
        const official = comparison.official?.shortContext;

        if (
          official?.inputCostPerMillionTokens === undefined ||
          official.outputCostPerMillionTokens === undefined
        ) {
          continue;
        }

        await this.modelPricingStore.updatePricing(comparison.saved.pricingId, {
          inputCostPerMillionTokens: official.inputCostPerMillionTokens,
          cachedInputCostPerMillionTokens:
            official.cachedInputCostPerMillionTokens === undefined
              ? null
              : official.cachedInputCostPerMillionTokens,
          outputCostPerMillionTokens: official.outputCostPerMillionTokens,
          sourceUrl: comparison.official?.sourceUrl ?? result.source.url,
          sourceName: result.source.name,
          sourceRetrievedAt: result.source.retrievedAt,
        });
        updatedModels.push(comparison.model);
      }

      const allOpenAiPricing = await this.modelPricingStore.listPricing({ provider: 'openai' });
      const configuredEmbeddingPricing = result.missingLocalPricing.find(
        (pricing) => pricing.model === this.embeddingModel,
      );
      const embeddingRecordExists = allOpenAiPricing.some(
        (pricing) => pricing.model === this.embeddingModel,
      );

      if (
        configuredEmbeddingPricing?.shortContext.inputCostPerMillionTokens !== undefined &&
        configuredEmbeddingPricing.shortContext.outputCostPerMillionTokens !== undefined &&
        !embeddingRecordExists
      ) {
        await this.modelPricingStore.createPricing({
          provider: 'openai',
          model: this.embeddingModel,
          inputCostPerMillionTokens:
            configuredEmbeddingPricing.shortContext.inputCostPerMillionTokens,
          outputCostPerMillionTokens:
            configuredEmbeddingPricing.shortContext.outputCostPerMillionTokens,
          sourceUrl: configuredEmbeddingPricing.sourceUrl ?? result.source.url,
          sourceName: result.source.name,
          sourceRetrievedAt: result.source.retrievedAt,
          notes: 'Embedding token pricing synchronized from the official OpenAI model page.',
        });
        updatedModels.push(this.embeddingModel);
      }

      const remainingDifferences = result.different.filter(
        (comparison) => !updatedModels.includes(comparison.model),
      );

      return {
        ...result,
        summary: updatedModels.length
          ? `Synchronized ${updatedModels.length} OpenAI pricing records from official sources. Input, cached-input, and output prices are now current for: ${updatedModels.join(', ')}.`
          : 'All saved OpenAI input, cached-input, and output prices already match the official source.',
        matchedModels: [...new Set([...result.matchedModels, ...updatedModels])],
        updatedModels,
        different: remainingDifferences,
        missingLocalModels: result.missingLocalModels.filter(
          (model) => !updatedModels.includes(model),
        ),
        missingLocalPricing: result.missingLocalPricing.filter(
          (pricing) => !updatedModels.includes(pricing.model),
        ),
        notes: [
          ...result.notes.filter((note) => !note.startsWith('This tool only compares records.')),
          `Apply mode creates the configured embedding model (${this.embeddingModel}) when it is missing. Other official models missing locally are not created automatically.`,
        ],
      };
    } catch (error) {
      await this.pricingSourceStore.recordSourceCheck(
        source.id,
        new Date().toISOString(),
        getErrorMessage(error),
      );
      throw error;
    }
  }

  async readLatestThreadRunContext(
    agentId: string,
    threadId: string,
  ): Promise<RunContextDetails | null> {
    await this.readThread(agentId, threadId);

    const context = await this.runContextStore.readLatestRunContextForThread(agentId, threadId);

    return context ? await this.withLlmCalls(context) : null;
  }

  async listThreadRunContexts(
    agentId: string,
    threadId: string,
  ): Promise<readonly RunContextDetails[]> {
    await this.readThread(agentId, threadId);

    const contexts = await this.runContextStore.listRunContextsForThread(agentId, threadId);

    return await Promise.all(contexts.map(async (context) => await this.withLlmCalls(context)));
  }

  async readAgent(agentId: string): Promise<AgentProfile> {
    const agent = await this.registry.readAgent(agentId);

    if (!agent) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    return agent;
  }

  async listThreads(agentId: string): Promise<ChatThreadSummary[]> {
    return await this.threads.listThreads(agentId);
  }

  async createThread(agentId: string, request: CreateThreadRequest = {}): Promise<ChatThread> {
    return await this.threads.createThread(agentId, request);
  }

  async readThread(agentId: string, threadId: string): Promise<ChatThread> {
    return await this.threads.readThread(agentId, threadId);
  }

  async searchPastConversations(
    agentId: string,
    query: string,
    limit?: number,
    excludeThreadId?: string,
  ) {
    return await this.threads.searchPastConversations(agentId, query, limit, excludeThreadId);
  }

  async readPastConversation(
    agentId: string,
    threadId: string,
    messageLimit?: number,
    currentThreadId?: string,
  ) {
    return await this.threads.readPastConversation(
      agentId,
      threadId,
      messageLimit,
      currentThreadId,
    );
  }

  async deleteThread(agentId: string, threadId: string): Promise<DeleteThreadResponse> {
    return await this.threads.deleteThread(agentId, threadId);
  }

  async runAgent(request: AgentRunRequest, options: RunAgentOptions = {}): Promise<RunAgentResult> {
    return await this.chatRuns.runAgent(request, options);
  }

  async runOptimizer(request: OptimizerRunRequest): Promise<OptimizerRunResponse> {
    const agent = await this.readAgent(costAnalystAgentId);
    const thread = await this.createThread(agent.id, {
      title: request.title ?? 'Cost optimization',
    });
    const result = await this.runAgent({
      agentId: agent.id,
      threadId: thread.id,
      model: request.model ?? agent.models.chat ?? this.modelsResponse().defaultModel,
      prompt: request.prompt,
    });

    return {
      runId: result.runId,
      thread: result.thread,
      runContext: result.runContext,
      content: result.agentResponse.content,
    };
  }

  private async withLlmCalls(context: RunContextDetails): Promise<RunContextDetails> {
    return {
      ...context,
      llmCalls: await this.llmCallStore.listCallsForRun(context.runId),
    };
  }

  getDefaultAgentId(): string {
    return this.registry.getDefaultAgentId();
  }

  close(): void {
    this.threadCheckpointer.close();
  }

  private async storageFor(agentId: string) {
    validateAgentId(agentId);

    return await this.registry.storageFor(agentId);
  }

  controlledToolsFor(agentId: string) {
    return isSystemOperatorAgent(agentId, this.getDefaultAgentId())
      ? listAdminToolDefinitions()
      : [];
  }

  private async findActiveOfficialOpenAiPricingSource(): Promise<PricingSourceRecord> {
    const sources = await this.pricingSourceStore.listSources({
      provider: 'openai',
      trustLevel: 'official',
      active: true,
    });
    const pricingPage = sources.find((source) => source.url.includes('/api/docs/pricing'));

    if (pricingPage) {
      return pricingPage;
    }

    if (sources[0]) {
      return sources[0];
    }

    throw new Error('No active official OpenAI pricing source is configured.');
  }
}

async function readFileUpdatedAt(path: string): Promise<string> {
  return (await stat(path)).mtime.toISOString();
}

interface AssistantRuntimeOptions {
  readonly dataDir: string;
  readonly defaultAgentId: string;
  readonly defaultAgentName: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'OpenAI pricing source check failed.';
}

function readRuntimeOptionsFromEnv(): AssistantRuntimeOptions {
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
