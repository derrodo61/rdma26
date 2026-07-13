import type { StructuredToolInterface } from '@langchain/core/tools';

import type {
  AgentRunRequest,
  ChatThread,
  LlmCallRecord,
  RunContextDetails,
  RunContextTokenUsage,
  RunContextTool,
} from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import { PersonalAgent, type PersonalAgentResponse } from '../agents/personal-agent';
import { isSystemOperatorAgent } from '../agents/system-agents';
import { createAdminTools, listAdminToolDefinitions } from '../capabilities/admin-tools';
import type { CapabilityRegistry } from '../capabilities/capability-registry';
import { createMemoryReadTools, createMemoryTools } from '../capabilities/memory-tools';
import { createConversationTools } from '../capabilities/conversation-tools';
import type { FileMemoryStore } from '../memory/file-memory-store';
import type { UserProfileStore } from '../profiles/user-profile-store';
import type { LlmCallStore } from '../llm/llm-call-store';
import type { RunContextStore } from '../runs/run-context-store';
import type { AssistantRuntime } from '../runtime';
import type { ThreadCheckpointer } from '../threads/thread-checkpointer';

export class ChatRunService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly capabilities: CapabilityRegistry,
    private readonly fileMemoryStore: FileMemoryStore,
    private readonly runContextStore: RunContextStore,
    private readonly llmCallStore: LlmCallStore,
    private readonly userProfileStore: UserProfileStore,
    private readonly threadCheckpointer: ThreadCheckpointer,
    private readonly runtime: AssistantRuntime,
  ) {}

  async runAgent(request: AgentRunRequest, options: RunAgentOptions = {}): Promise<RunAgentResult> {
    const runId = options.runId ?? crypto.randomUUID();
    const storage = await this.registry.storageFor(request.agentId);
    const existingThread = await storage.readThread(request.threadId);
    const userProfile = await this.userProfileStore.readProfile();
    const model =
      request.model ??
      userProfile.agentSettings[request.agentId]?.model ??
      storage.agent.models.chat ??
      this.runtime.modelsResponse().defaultModel;

    if (!existingThread) {
      throw new Error(`Thread ${request.threadId} does not exist for agent ${request.agentId}.`);
    }

    const memoryReadsEnabled = storage.agent.memory.canRead;
    const memoryWritesEnabled = storage.agent.memory.canWrite;
    const tools = [
      ...this.capabilities.createRunnableTools(storage.agent.enabledTools),
      ...(memoryReadsEnabled
        ? createMemoryReadTools(this.runtime, storage.agent.id, {
            runId,
            threadId: request.threadId,
          })
        : []),
      ...(memoryReadsEnabled
        ? createConversationTools(this.runtime, storage.agent.id, request.threadId)
        : []),
      ...(memoryWritesEnabled ? createMemoryTools(this.runtime, storage.agent.id) : []),
      ...this.adminToolsFor(storage.agent.id),
    ];
    const toolContext = this.runContextToolsFor(
      storage.agent.id,
      storage.agent.enabledTools,
      memoryReadsEnabled,
      memoryWritesEnabled,
    );
    const soulContent = await storage.readSoul();
    const pinnedMemories = memoryReadsEnabled
      ? await this.fileMemoryStore.pinnedEntriesForAgent(storage.agent.id)
      : [];
    const memoryPaths = pinnedMemories.map((memory) => this.fileMemoryStore.virtualPath(memory));
    const userThread = await storage.appendMessage(request.threadId, {
      role: 'user',
      content: request.prompt,
    });
    const hasCheckpoint = await this.threadCheckpointer.hasThread(request.threadId);
    const inputMessages = hasCheckpoint ? userThread.messages.slice(-1) : userThread.messages;
    const agentResponse = await new PersonalAgent(storage, this.threadCheckpointer.get()).run({
      runId,
      threadId: request.threadId,
      model,
      tools,
      enabledToolIds: storage.agent.enabledTools,
      isOperatorAgent: isSystemOperatorAgent(storage.agent.id, this.registry.getDefaultAgentId()),
      userProfile,
      soulContent,
      memoryPaths,
      memoryDirectories: this.fileMemoryStore.memoryDirectoriesForAgent(storage.agent.id),
      memoryReadsEnabled,
      memoryWritesEnabled,
      messages: inputMessages,
      prompt: request.prompt,
      llmCallStore: this.llmCallStore,
      onActivity: options.onActivity,
    });
    const llmCalls = await this.llmCallStore.listCallsForRun(runId);
    const currentTokenUsage = summarizeCurrentRunTokenUsage(llmCalls);
    const currentAgentResponse: PersonalAgentResponse = {
      ...agentResponse,
      tokenUsage: currentTokenUsage,
    };
    const thread = await storage.appendMessage(request.threadId, {
      role: 'assistant',
      content: currentAgentResponse.content,
    });
    const assistantMessage = thread.messages.at(-1);
    const runContext = await this.runContextStore.writeRunContext({
      runId,
      agentId: storage.agent.id,
      agentName: storage.agent.name,
      threadId: request.threadId,
      threadTitle: thread.title,
      model,
      createdAt: new Date().toISOString(),
      prompt: request.prompt,
      assistantResponse: currentAgentResponse.content,
      assistantMessageId: assistantMessage?.role === 'assistant' ? assistantMessage.id : undefined,
      soulVirtualPath: storage.agent.soulVirtualPath,
      soulContent,
      userProfile,
      memories: pinnedMemories.map((memory) => ({
        memoryId: memory.id,
        scope: memory.scope,
        agentId: memory.agentId,
        pinned: true,
        tags: memory.tags,
        source: memory.source,
        virtualPath: this.fileMemoryStore.virtualPath(memory),
        access: 'startup' as const,
        content: memory.content,
      })),
      messages: userThread.messages.map((message) => ({
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        content: message.content,
      })),
      tools: toolContext,
      toolCalls: currentAgentResponse.toolCalls,
      skillsUsed: currentAgentResponse.skillsUsed,
      tokenUsage: currentAgentResponse.tokenUsage,
      llmCalls,
      memoryReadsEnabled,
      memoryWritesEnabled,
    });

    return {
      agentResponse: currentAgentResponse,
      runContext,
      runId,
      thread,
    };
  }

  private adminToolsFor(agentId: string): readonly StructuredToolInterface[] {
    return isSystemOperatorAgent(agentId, this.registry.getDefaultAgentId())
      ? createAdminTools(this.runtime)
      : [];
  }

  private controlledToolsFor(agentId: string) {
    return isSystemOperatorAgent(agentId, this.registry.getDefaultAgentId())
      ? listAdminToolDefinitions()
      : [];
  }

  private runContextToolsFor(
    agentId: string,
    enabledToolIds: readonly string[],
    canReadMemory: boolean,
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
    const conversationTools = canReadMemory
      ? [
          {
            id: 'search_unpinned_memory',
            label: 'Search unpinned memory',
            description: 'Search applicable unpinned long-term memory files on demand.',
            provider: 'rdma26-memory',
            controlled: true,
          },
          {
            id: 'search_past_conversations',
            label: 'Search past conversations',
            description: "Search this agent's earlier threads.",
            provider: 'rdma26-threads',
            controlled: true,
          },
          {
            id: 'read_past_conversation',
            label: 'Read past conversation',
            description: 'Read bounded messages from an earlier thread.',
            provider: 'rdma26-threads',
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

    return [...assignableTools, ...conversationTools, ...memoryTools, ...adminTools];
  }
}

function summarizeCurrentRunTokenUsage(
  calls: readonly LlmCallRecord[],
): RunContextTokenUsage | undefined {
  if (!calls.length) return undefined;

  const sum = (select: (call: LlmCallRecord) => number | undefined) =>
    calls.reduce((total, call) => total + (select(call) ?? 0), 0);
  const inputTokens = sum((call) => call.inputTokens);
  const outputTokens = sum((call) => call.outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: sum((call) => call.cachedInputTokens),
    reasoningTokens: sum((call) => call.reasoningTokens),
  };
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
