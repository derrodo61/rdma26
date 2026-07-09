import type {
  ChatThread,
  ChatThreadSummary,
  CreateThreadRequest,
  DeleteThreadResponse,
} from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import type { MemoryStore } from '../memory/memory-store';
import type { ThreadSummaryService } from '../memory/thread-summary-service';
import type { LlmCallStore } from '../llm/llm-call-store';
import type { RunContextStore } from '../runs/run-context-store';

export class ThreadService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly memoryStore: MemoryStore,
    private readonly runContextStore: RunContextStore,
    private readonly llmCallStore: LlmCallStore,
    private readonly threadSummaries: ThreadSummaryService,
  ) {}

  async listThreads(agentId: string): Promise<ChatThreadSummary[]> {
    const storage = await this.registry.storageFor(agentId);

    return await storage.listThreads();
  }

  async createThread(agentId: string, request: CreateThreadRequest = {}): Promise<ChatThread> {
    const storage = await this.registry.storageFor(agentId);
    const previousThread = (await storage.listThreads()).find((thread) => thread.messageCount > 0);
    const thread = await storage.createThread(request.title);

    await this.threadSummaries.createPreviousThreadSummaryIfPossible(
      storage.agent.memory.canWrite,
      previousThread?.id,
      async (threadId) => await storage.readThread(threadId),
    );

    return thread;
  }

  async readThread(agentId: string, threadId: string): Promise<ChatThread> {
    const storage = await this.registry.storageFor(agentId);
    const thread = await storage.readThread(threadId);

    if (!thread) {
      throw new Error(`Thread ${threadId} does not exist for agent ${agentId}.`);
    }

    return thread;
  }

  async deleteThread(agentId: string, threadId: string): Promise<DeleteThreadResponse> {
    const storage = await this.registry.storageFor(agentId);
    const deleted = await storage.deleteThread(threadId);

    if (!deleted) {
      throw new Error(`Thread ${threadId} does not exist for agent ${agentId}.`);
    }

    await this.memoryStore.deleteThreadSummaryMemories(agentId, threadId);
    await this.runContextStore.deleteRunsForThread(agentId, threadId);
    await this.llmCallStore.deleteCallsForThread(agentId, threadId);

    return {
      deleted: true,
      agentId,
      threadId,
    };
  }
}
