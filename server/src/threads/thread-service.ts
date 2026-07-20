import type {
  ChatThread,
  ChatThreadSummary,
  CreateThreadRequest,
  DeleteThreadResponse,
  UpdateThreadRequest,
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

  async updateThread(
    agentId: string,
    threadId: string,
    request: UpdateThreadRequest,
  ): Promise<ChatThread> {
    const storage = await this.registry.storageFor(agentId);
    const thread = await storage.updateThreadTitle(threadId, request.title);

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
    const terms = meaningfulSearchTerms(query);
    const previousThreadRequested = requestsImmediatelyPreviousThread(query);
    const threads = await storage.listThreads();
    const matches = [];

    for (const summary of threads) {
      if (summary.id === excludeThreadId) continue;
      const thread = await storage.readThread(summary.id);
      if (!thread) continue;
      const searchable =
        `${thread.title}\n${thread.messages.map((message) => message.content).join('\n')}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
      if (!score && !previousThreadRequested) continue;
      const matchingMessage = bestMatchingMessage(thread, terms);
      matches.push({
        threadId: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        messageCount: thread.messages.length,
        excerpt: matchingMessage?.content.slice(0, 400) ?? thread.title,
        score,
        ranking: previousThreadRequested ? 'previous_thread' : 'relevance',
      });
    }

    return {
      query,
      results: matches
        .sort((left, right) =>
          previousThreadRequested
            ? right.updatedAt.localeCompare(left.updatedAt) || right.score - left.score
            : right.score - left.score || right.updatedAt.localeCompare(left.updatedAt),
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

const conversationNavigationTerms = new Set([
  'chat',
  'conversation',
  'conversations',
  'earlier',
  'last',
  'latest',
  'message',
  'messages',
  'previous',
  'recent',
  'search',
  'thread',
  'threads',
  'unterhaltung',
  'unterhaltungen',
  'vorherige',
  'vorherigen',
  'vorheriger',
  'letzte',
  'letzten',
  'letzter',
  'nachricht',
  'nachrichten',
]);

function meaningfulSearchTerms(query: string): readonly string[] {
  const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
  return [
    ...new Set(terms.filter((term) => term.length > 1 && !conversationNavigationTerms.has(term))),
  ];
}

function requestsImmediatelyPreviousThread(query: string): boolean {
  const normalized = query.toLocaleLowerCase();
  return (
    /\b(previous|last|most recent)\s+(thread|conversation|chat)\b/.test(normalized) ||
    /\b(vorherig(?:e|en|er|es)?|letzt(?:e|en|er|es)?)\s+(thread|chat|unterhaltung)\b/.test(
      normalized,
    )
  );
}

function bestMatchingMessage(
  thread: ChatThread,
  terms: readonly string[],
): ChatThread['messages'][number] | undefined {
  if (!terms.length) return thread.messages.at(-1);

  return thread.messages
    .map((message) => ({
      message,
      score: terms.reduce(
        (total, term) => total + (message.content.toLocaleLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score)[0]?.message;
}
