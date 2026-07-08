import type { StructuredToolInterface } from '@langchain/core/tools';

import type {
  AgentRunRequest,
  ChatThread,
  MemoryRecord,
  RunContextDetails,
  RunContextMemory,
  RunContextTool,
} from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import { PersonalAgent, type PersonalAgentResponse } from '../agents/personal-agent';
import { createAdminTools, listAdminToolDefinitions } from '../capabilities/admin-tools';
import type { CapabilityRegistry } from '../capabilities/capability-registry';
import { createMemoryTools } from '../capabilities/memory-tools';
import type { MemoryStore } from '../memory/memory-store';
import type { UserProfileStore } from '../profiles/user-profile-store';
import type { RunContextStore } from '../runs/run-context-store';
import type { AssistantRuntime } from '../runtime';

export class ChatRunService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly capabilities: CapabilityRegistry,
    private readonly memoryStore: MemoryStore,
    private readonly runContextStore: RunContextStore,
    private readonly userProfileStore: UserProfileStore,
    private readonly runtime: AssistantRuntime,
  ) {}

  async runAgent(request: AgentRunRequest, options: RunAgentOptions = {}): Promise<RunAgentResult> {
    const runId = options.runId ?? crypto.randomUUID();
    const storage = await this.registry.storageFor(request.agentId);
    const existingThread = await storage.readThread(request.threadId);

    if (!existingThread) {
      throw new Error(`Thread ${request.threadId} does not exist for agent ${request.agentId}.`);
    }

    const tools = [
      ...this.capabilities.createRunnableTools(storage.agent.enabledTools),
      ...(storage.agent.memory.canWrite ? createMemoryTools(this.runtime, storage.agent.id) : []),
      ...this.adminToolsFor(storage.agent.id),
    ];
    const toolContext = this.runContextToolsFor(
      storage.agent.id,
      storage.agent.enabledTools,
      storage.agent.memory.canWrite,
    );
    const userProfile = await this.userProfileStore.readProfile();
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
      isOperatorAgent: storage.agent.id === this.registry.getDefaultAgentId(),
      userProfile,
      soulContent,
      memories: memories.map((memory) => memory.memory),
      memoryWritesEnabled: storage.agent.memory.canWrite,
      messages: userThread.messages,
      prompt: request.prompt,
      onActivity: options.onActivity,
    });
    const thread = await storage.appendMessage(request.threadId, {
      role: 'assistant',
      content: agentResponse.content,
    });
    const assistantMessage = thread.messages.at(-1);
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
      assistantMessageId: assistantMessage?.role === 'assistant' ? assistantMessage.id : undefined,
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

  private adminToolsFor(agentId: string): readonly StructuredToolInterface[] {
    return agentId === this.registry.getDefaultAgentId() ? createAdminTools(this.runtime) : [];
  }

  private controlledToolsFor(agentId: string) {
    return agentId === this.registry.getDefaultAgentId() ? listAdminToolDefinitions() : [];
  }

  private runContextToolsFor(
    agentId: string,
    enabledToolIds: readonly string[],
    canWriteMemory: boolean,
  ): readonly RunContextTool[] {
    const enabledToolIdSet = new Set(enabledToolIds);
    const assignableTools = this.capabilities
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
}

export interface RunAgentResult {
  readonly agentResponse: PersonalAgentResponse;
  readonly runContext: RunContextDetails;
  readonly runId: string;
  readonly thread: ChatThread;
}

export interface RunAgentOptions {
  readonly runId?: string;
  readonly onActivity?: (activity: { readonly label: string; readonly detail?: string }) => void;
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
