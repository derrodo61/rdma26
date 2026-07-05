import { join } from 'node:path';

import type {
  AgentProfile,
  AgentRunRequest,
  AgentToolsResponse,
  AgentsResponse,
  ChatThread,
  ChatThreadSummary,
  CreateAgentRequest,
  CreateThreadRequest,
  DeleteAgentResponse,
  DeleteThreadResponse,
  HealthResponse,
  ModelOption,
  ModelsResponse,
  ToolsResponse,
  UpdateAgentRequest,
  UpdateAgentToolsRequest,
  UpdateUserProfileRequest,
  UserProfile,
} from '../../shared/agent-contracts';
import { readAuthConfig } from './auth';
import { AgentRegistry, validateAgentId } from './agent-registry';
import { PersonalAgent, type PersonalAgentResponse } from './personal-agent';
import { ToolRegistry } from './tools/tool-registry';
import { UserProfileStore } from './user-profile-store';

export class AssistantRuntime {
  private readonly registry: AgentRegistry;
  private readonly models: readonly ModelOption[];
  private readonly tools = new ToolRegistry();
  private readonly userProfileStore: UserProfileStore;

  constructor(options: AssistantRuntimeOptions = readRuntimeOptionsFromEnv()) {
    this.registry = new AgentRegistry(
      options.dataDir,
      options.defaultAgentId,
      options.defaultAgentName,
    );
    this.userProfileStore = new UserProfileStore(options.dataDir);
    this.models = readModels();
  }

  async ensureReady(): Promise<void> {
    await this.registry.ensureReady();
    await this.userProfileStore.ensureReady();
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

    return {
      deleted: true,
      agentId,
      threadId,
    };
  }

  async runAgent(request: AgentRunRequest): Promise<RunAgentResult> {
    const storage = await this.storageFor(request.agentId);
    const existingThread = await storage.readThread(request.threadId);

    if (!existingThread) {
      throw new Error(`Thread ${request.threadId} does not exist for agent ${request.agentId}.`);
    }

    const tools = this.tools.createTools(storage.agent.enabledTools);
    const userThread = await storage.appendMessage(request.threadId, {
      role: 'user',
      content: request.prompt,
    });
    const agentResponse = await new PersonalAgent(storage).run({
      threadId: request.threadId,
      model: request.model,
      tools,
      messages: userThread.messages,
      prompt: request.prompt,
    });
    const thread = await storage.appendMessage(request.threadId, {
      role: 'assistant',
      content: agentResponse.content,
    });

    return {
      agentResponse,
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
}

export interface RunAgentResult {
  readonly agentResponse: PersonalAgentResponse;
  readonly thread: ChatThread;
}

export interface AssistantRuntimeOptions {
  readonly dataDir: string;
  readonly defaultAgentId: string;
  readonly defaultAgentName: string;
}

export function readRuntimeOptionsFromEnv(): AssistantRuntimeOptions {
  return {
    dataDir: process.env['ASSISTANT_DATA_DIR'] ?? join(process.cwd(), '.assistant-data'),
    defaultAgentId: process.env['ASSISTANT_AGENT_ID'] ?? 'default',
    defaultAgentName: process.env['ASSISTANT_AGENT_NAME'] ?? 'Default assistant',
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
