import type { StructuredToolInterface } from '@langchain/core/tools';

import type {
  AgentRunRequest,
  ChatThread,
  RunContextDetails,
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
import type { OpenAiModelFactory } from '../llm/model-factory';
import { ChatRunRecorder, type ChatRunRecordingContext } from './chat-run-recorder';

export class ChatRunService {
  private readonly recorder: ChatRunRecorder;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly capabilities: CapabilityRegistry,
    private readonly fileMemoryStore: FileMemoryStore,
    private readonly runContextStore: RunContextStore,
    private readonly llmCallStore: LlmCallStore,
    private readonly userProfileStore: UserProfileStore,
    private readonly threadCheckpointer: ThreadCheckpointer,
    private readonly modelFactory: OpenAiModelFactory,
    private readonly runtime: AssistantRuntime,
  ) {
    this.recorder = new ChatRunRecorder(runContextStore, fileMemoryStore);
  }

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

    throwIfAborted(options.signal);

    const memoryReadsEnabled = storage.agent.memory.canRead;
    const memoryWritesEnabled = storage.agent.memory.canWrite;
    const enabledCapabilityIds = storage.agent.enabledTools;
    const tools = [
      ...this.capabilities.createRunnableTools(enabledCapabilityIds),
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
      enabledCapabilityIds,
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
    const recordingContext: ChatRunRecordingContext = {
      runId,
      storage,
      request,
      userThread,
      model,
      soulContent,
      userProfile,
      pinnedMemories,
      tools: toolContext,
      withheldCapabilities: [],
      memoryReadsEnabled,
      memoryWritesEnabled,
    };

    try {
      const agentResponse = await new PersonalAgent(
        storage,
        this.threadCheckpointer.get(),
        this.modelFactory,
      ).run({
        runId,
        threadId: request.threadId,
        model,
        tools,
        enabledToolIds: enabledCapabilityIds,
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
        signal: options.signal,
      });
      throwIfAborted(options.signal);

      const llmCalls = await this.llmCallStore.listCallsForRun(runId);
      const currentAgentResponse = this.recorder.responseWithTokenUsage(agentResponse, llmCalls);
      const thread = await storage.appendMessage(request.threadId, {
        role: 'assistant',
        content: currentAgentResponse.content,
      });
      const runContext = await this.recorder.recordSuccess(
        recordingContext,
        currentAgentResponse,
        thread,
        llmCalls,
      );

      return {
        agentResponse: currentAgentResponse,
        runContext,
        runId,
        thread,
      };
    } catch (error) {
      const llmCalls = await this.llmCallStore.listCallsForRun(runId);
      await this.recorder.recordFailure(
        recordingContext,
        error,
        llmCalls,
        options.signal?.aborted ? 'cancelled' : 'error',
      );

      throw error;
    }
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

export interface RunAgentResult {
  readonly agentResponse: PersonalAgentResponse;
  readonly runContext: RunContextDetails;
  readonly runId: string;
  readonly thread: ChatThread;
}

export interface RunAgentOptions {
  readonly runId?: string;
  readonly onActivity?: (activity: { readonly label: string; readonly detail?: string }) => void;
  readonly signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw new Error('Agent run was cancelled.');
}
