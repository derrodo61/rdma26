import type {
  ChatThread,
  ChatThreadSummary,
  CreateThreadRequest,
  DeleteThreadResponse,
} from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import type { LlmCallStore } from '../llm/llm-call-store';
import type { RunContextStore } from '../runs/run-context-store';
import type { ThreadCheckpointer } from './thread-checkpointer';

export class ThreadService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly runContextStore: RunContextStore,
    private readonly llmCallStore: LlmCallStore,
    private readonly threadCheckpointer: ThreadCheckpointer,
  ) {}

  async listThreads(agentId: string): Promise<ChatThreadSummary[]> {
    const storage = await this.registry.storageFor(agentId);

    return await storage.listThreads();
  }

  async createThread(agentId: string, request: CreateThreadRequest = {}): Promise<ChatThread> {
    const storage = await this.registry.storageFor(agentId);
    return await storage.createThread(request.title);
  }

  async readThread(agentId: string, threadId: string): Promise<ChatThread> {
    const storage = await this.registry.storageFor(agentId);
    const thread = await storage.readThread(threadId);

    if (!thread) {
      throw new Error(`Thread ${threadId} does not exist for agent ${agentId}.`);
    }

    return thread;
  }

  async searchPastConversations(
    agentId: string,
    query: string,
    limit = 5,
    excludeThreadId?: string,
  ) {
    const storage = await this.registry.storageFor(agentId);
    const terms = query
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1);
    const threads = await storage.listThreads();
    const matches = [];

    for (const summary of threads) {
      if (summary.id === excludeThreadId) continue;
      const thread = await storage.readThread(summary.id);
      if (!thread) continue;
      const searchable =
        `${thread.title}\n${thread.messages.map((message) => message.content).join('\n')}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
      if (!score) continue;
      const matchingMessage = thread.messages.find((message) =>
        terms.some((term) => message.content.toLocaleLowerCase().includes(term)),
      );
      matches.push({
        threadId: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        messageCount: thread.messages.length,
        excerpt: matchingMessage?.content.slice(0, 400) ?? thread.title,
        score,
      });
    }

    return {
      query,
      results: matches
        .sort(
          (left, right) =>
            right.score - left.score || right.updatedAt.localeCompare(left.updatedAt),
        )
        .slice(0, Math.min(Math.max(limit, 1), 10)),
    };
  }

  async readPastConversation(
    agentId: string,
    threadId: string,
    messageLimit = 20,
    currentThreadId?: string,
  ) {
    if (threadId === currentThreadId) {
      throw new Error(
        'Use the current thread context instead of reading it as past conversation history.',
      );
    }
    const thread = await this.readThread(agentId, threadId);
    return {
      threadId: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      messages: thread.messages.slice(-Math.min(Math.max(messageLimit, 1), 50)).map((message) => ({
        role: message.role,
        createdAt: message.createdAt,
        content: message.content,
      })),
    };
  }

  async deleteThread(agentId: string, threadId: string): Promise<DeleteThreadResponse> {
    const storage = await this.registry.storageFor(agentId);
    const deleted = await storage.deleteThread(threadId);

    if (!deleted) {
      throw new Error(`Thread ${threadId} does not exist for agent ${agentId}.`);
    }

    await this.runContextStore.deleteRunsForThread(agentId, threadId);
    await this.llmCallStore.deleteCallsForThread(agentId, threadId);
    await this.threadCheckpointer.deleteThread(threadId);

    return {
      deleted: true,
      agentId,
      threadId,
    };
  }
}
