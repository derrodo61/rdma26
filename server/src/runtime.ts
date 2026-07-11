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
  MemoryMaintenanceRequest,
  MemoryMaintenanceResponse,
  MemoryMaintenanceSettings,
  MemoryListRequest,
  MemoryListResponse,
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
import { MemoryMaintenanceSettingsStore } from './memory/memory-maintenance-settings-store';
import { MemoryStore } from './memory/memory-store';
import { ThreadSummaryService } from './memory/thread-summary-service';
import { UserProfileStore } from './profiles/user-profile-store';
import { LlmCallStore } from './llm/llm-call-store';
import { ModelPricingStore } from './llm/model-pricing-store';
import { syncOpenAiModelPricingFromSource } from './llm/openai-pricing-sync';
import { PricingSourceStore } from './llm/pricing-source-store';
import { readWebPage } from './research/web-page-reader';
import { RunContextStore } from './runs/run-context-store';
import { ThreadService } from './threads/thread-service';

export class AssistantRuntime {
  private readonly registry: AgentRegistry;
  private readonly models: readonly ModelOption[];
  private readonly capabilities = new CapabilityRegistry();
  private readonly userProfileStore: UserProfileStore;
  private readonly memoryStore: MemoryStore;
  private readonly memoryMaintenanceSettingsStore: MemoryMaintenanceSettingsStore;
  private readonly runContextStore: RunContextStore;
  private readonly modelPricingStore: ModelPricingStore;
  private readonly pricingSourceStore: PricingSourceStore;
  private readonly llmCallStore: LlmCallStore;
  private readonly threadSummaries: ThreadSummaryService;
  private readonly threads: ThreadService;
  private readonly chatRuns: ChatRunService;

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
    this.modelPricingStore = new ModelPricingStore(options.dataDir);
    this.pricingSourceStore = new PricingSourceStore(options.dataDir);
    this.llmCallStore = new LlmCallStore(options.dataDir, this.modelPricingStore);
    this.models = readModels();
    this.threadSummaries = new ThreadSummaryService(
      this.memoryStore,
      this.llmCallStore,
      this.models,
    );
    this.threads = new ThreadService(
      this.registry,
      this.memoryStore,
      this.runContextStore,
      this.llmCallStore,
      this.threadSummaries,
    );
    this.chatRuns = new ChatRunService(
      this.registry,
      this.capabilities,
      this.memoryStore,
      this.runContextStore,
      this.llmCallStore,
      this.userProfileStore,
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
    await this.ensureCostAnalystSoulSupportsPricingMaintenance(costAnalystStorage);
    await this.userProfileStore.ensureReady();
    await this.memoryStore.ensureReady();
    await this.memoryMaintenanceSettingsStore.ensureReady();
    await this.runContextStore.ensureReady();
    await this.modelPricingStore.ensureReady();
    await this.pricingSourceStore.ensureReady();
    await this.pricingSourceStore.ensureDefaultSources();
    await this.llmCallStore.ensureReady();
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
    await this.llmCallStore.deleteCallsForAgent(agentId);
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

  async readPricingSourcePage(sourceId: string, query?: string) {
    const source = await this.pricingSourceStore.requireSource(sourceId);

    return {
      source,
      page: await readWebPage(source.url, {
        query,
        maxCharacters: 30_000,
      }),
    };
  }

  async syncOpenAiModelPricing(sourceId?: string): Promise<SyncOpenAiModelPricingResult> {
    const source = sourceId
      ? await this.pricingSourceStore.requireSource(sourceId)
      : await this.findActiveOfficialOpenAiPricingSource();
    const savedPricing = await this.modelPricingStore.listPricing({
      provider: 'openai',
      status: 'active',
    });

    try {
      const result = await syncOpenAiModelPricingFromSource(source, savedPricing);
      await this.pricingSourceStore.recordSourceCheck(source.id, result.source.retrievedAt);
      return result;
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

  async deleteThread(agentId: string, threadId: string): Promise<DeleteThreadResponse> {
    return await this.threads.deleteThread(agentId, threadId);
  }

  async consolidateThreadSummary(
    agentId: string,
    threadId: string,
    request: ThreadSummaryRequest = {},
  ): Promise<ThreadSummaryResponse> {
    return await this.threadSummaries.consolidateThreadSummary(
      await this.readThread(agentId, threadId),
      request,
    );
  }

  async consolidateAgentThreadSummaries(
    agentId: string,
    request: ThreadSummariesRequest = {},
  ): Promise<ThreadSummariesResponse> {
    return await this.threadSummaries.consolidateAgentThreadSummaries(
      agentId,
      request,
      async (selectedAgentId) => await this.listThreads(selectedAgentId),
      async (selectedAgentId, threadId) => await this.readThread(selectedAgentId, threadId),
    );
  }

  async runMemoryMaintenance(
    request: MemoryMaintenanceRequest = {},
  ): Promise<MemoryMaintenanceResponse> {
    return await this.threadSummaries.runMemoryMaintenance(
      request,
      async () => await this.listAgents(),
      async (agentId) => await this.readAgent(agentId),
      async (agentId) => await this.listThreads(agentId),
      async (agentId, threadId) => await this.readThread(agentId, threadId),
    );
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

  private async storageFor(agentId: string) {
    validateAgentId(agentId);

    return await this.registry.storageFor(agentId);
  }

  private async ensureCostAnalystSoulSupportsPricingMaintenance(
    storage: Awaited<ReturnType<AgentRegistry['storageFor']>>,
  ): Promise<void> {
    const soulContent = await storage.readSoul();
    const cleanedSoulContent = removeLegacyCostAnalystPricingGuidance(soulContent);
    const currentGuidance = `## Pricing source analysis

- First inspect configured pricing sources. Prefer active official provider sources and include source URL, source name, and retrieval date.
- For OpenAI model-price comparison, use the pricing-source-analysis skill and call admin_sync_openai_model_pricing first. It fetches the official OpenAI pricing page, extracts model prices, and compares them with saved active OpenAI pricing records without changing data.
- Use read_web_page_structure only when the dedicated OpenAI pricing sync cannot answer the question, when the user asks for page-structure debugging, or when the provider is not OpenAI.
- Use research only when no configured source exists, a configured source cannot be read, or the user asks you to find a new source.`;

    if (
      cleanedSoulContent.includes('## Pricing maintenance') &&
      cleanedSoulContent.includes(currentGuidance)
    ) {
      if (cleanedSoulContent !== soulContent) {
        await storage.writeSoul(cleanedSoulContent);
      }
      return;
    }

    if (cleanedSoulContent.includes('## Pricing maintenance')) {
      await storage.writeSoul(`${cleanedSoulContent.trim()}

${currentGuidance}
`);
      return;
    }

    await storage.writeSoul(`${cleanedSoulContent.trim()}

## Pricing maintenance

- First inspect configured pricing sources. Prefer active official provider sources and include source URL, source name, and retrieval date.
- For OpenAI model-price comparison, use the pricing-source-analysis skill and call admin_sync_openai_model_pricing first. It fetches the official OpenAI pricing page, extracts model prices, and compares them with saved active OpenAI pricing records without changing data.
- Use read_web_page_structure only when the dedicated OpenAI pricing sync cannot answer the question, when the user asks for page-structure debugging, or when the provider is not OpenAI.
- Use research only when no configured source exists, a configured source cannot be read, or the user asks you to find a new source.
- Keep one pricing record per provider and model. Creating or updating prices makes that record active.
- Do not create, update, deactivate, or delete pricing unless the user explicitly approves that specific change.
`);
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

function removeLegacyCostAnalystPricingGuidance(content: string): string {
  return content
    .replace(
      /\n## Pricing source registry\n\n- First inspect configured pricing sources\. Prefer active official provider sources and include source URL, source name, and retrieval date\.\n/g,
      '\n',
    )
    .replace(
      /\n## Pricing source extraction\n\n- When a pricing source URL is already configured, use structured pricing-source extraction and comparison tools before using general research\.\n- Use research only when no configured source exists, a configured source cannot be read, or the user asks you to find a new source\.\n/g,
      '\n',
    )
    .replace(
      /\n## Pricing source analysis\n\n- First inspect configured pricing sources\. Prefer active official provider sources and include source URL, source name, and retrieval date\.\n(?:(?!\n## ).)*?(?:extract_web_content|read_web_page_structure|configured source page)(?:(?!\n## ).)*?- Use research only when no configured source exists, a configured source cannot be read, or the user asks you to find a new source\.\n/gs,
      '\n',
    )
    .replace(
      '- Use research when the user asks you to find current provider prices.\n- Prefer official provider pricing pages and include source URL, source name, and retrieval date.\n',
      '- First inspect configured pricing sources. Prefer active official provider sources and include source URL, source name, and retrieval date.\n',
    )
    .replace(
      '- You may create unverified model pricing records when the user asks you to store researched prices.\n- Do not activate, supersede, or replace active pricing unless the user explicitly approves that specific change.\n',
      '- Keep one pricing record per provider and model. Creating or updating prices makes that record active.\n- Do not create, update, deactivate, or delete pricing unless the user explicitly approves that specific change.\n',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
