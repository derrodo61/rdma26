import { ChatOpenAI } from '@langchain/openai';

import type {
  AgentMemoryMaintenanceResult,
  AgentProfile,
  ChatThread,
  ChatThreadSummary,
  MemoryMaintenanceRequest,
  MemoryMaintenanceResponse,
  MemoryRecord,
  ThreadSummariesRequest,
  ThreadSummariesResponse,
  ThreadSummaryRequest,
  ThreadSummaryResponse,
} from '../../../shared/agent-contracts';
import type { MemoryStore } from './memory-store';

export class ThreadSummaryService {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly models: readonly { readonly id: string }[],
  ) {}

  async consolidateThreadSummary(
    thread: ChatThread,
    request: ThreadSummaryRequest = {},
  ): Promise<ThreadSummaryResponse> {
    if (!thread.messages.length) {
      throw new Error('Cannot create a thread summary for an empty thread.');
    }

    return {
      agentId: thread.agentId,
      threadId: thread.id,
      ...(await this.createThreadSummaryMemoryIfMissing(thread, request.model)),
    };
  }

  async consolidateAgentThreadSummaries(
    agentId: string,
    request: ThreadSummariesRequest,
    listThreads: (agentId: string) => Promise<readonly ChatThreadSummary[]>,
    readThread: (agentId: string, threadId: string) => Promise<ChatThread>,
  ): Promise<ThreadSummariesResponse> {
    const threads = await listThreads(agentId);
    const limitedThreads =
      request.limit === undefined ? threads : threads.slice(0, Math.max(0, request.limit));
    const summaries: ThreadSummaryResponse[] = [];
    const skippedEmptyThreads: string[] = [];

    for (const threadSummary of limitedThreads) {
      const thread = await readThread(agentId, threadSummary.id);

      if (!thread.messages.length) {
        skippedEmptyThreads.push(thread.id);
        continue;
      }

      summaries.push(await this.consolidateThreadSummary(thread, request));
    }

    return {
      agentId,
      summaries,
      skippedEmptyThreads,
    };
  }

  async runMemoryMaintenance(
    request: MemoryMaintenanceRequest,
    listAgents: () => Promise<readonly AgentProfile[]>,
    readAgent: (agentId: string) => Promise<AgentProfile>,
    listThreads: (agentId: string) => Promise<readonly ChatThreadSummary[]>,
    readThread: (agentId: string, threadId: string) => Promise<ChatThread>,
  ): Promise<MemoryMaintenanceResponse> {
    const startedAt = new Date().toISOString();
    const agents =
      request.agentId === undefined ? await listAgents() : [await readAgent(request.agentId)];
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
        await this.consolidateAgentThreadSummaries(
          agent.id,
          {
            model: request.model,
            limit: request.limitPerAgent,
          },
          listThreads,
          readThread,
        ),
      );
    }

    return {
      mode: 'manual',
      startedAt,
      finishedAt: new Date().toISOString(),
      agents: results,
    };
  }

  async createPreviousThreadSummaryIfPossible(
    memoryWritesEnabled: boolean,
    previousThreadId: string | undefined,
    readThread: (threadId: string) => Promise<ChatThread | null>,
  ): Promise<void> {
    if (!memoryWritesEnabled || !previousThreadId || !process.env['OPENAI_API_KEY']) {
      return;
    }

    try {
      const previousThread = await readThread(previousThreadId);

      if (!previousThread?.messages.length) {
        return;
      }

      await this.createThreadSummaryMemoryIfMissing(previousThread);
    } catch {
      // Starting a new thread should not fail because memory maintenance is unavailable.
    }
  }

  private async createThreadSummaryMemoryIfMissing(
    thread: ChatThread,
    requestedModel?: string,
  ): Promise<ThreadSummaryMemoryResult> {
    if (!thread.messages.length) {
      throw new Error('Cannot create a thread summary for an empty thread.');
    }

    const existing = await this.memoryStore.findThreadSummary(thread.agentId, thread.id);

    if (existing) {
      return {
        memory: existing,
      };
    }

    const summary = await this.createThreadSummaryContent(thread, requestedModel);
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
    requestedModel: string | undefined,
  ): Promise<ThreadSummaryContent> {
    const model = requestedModel ?? process.env['OPENAI_SUMMARY_MODEL'] ?? this.models[0]?.id;

    if (!process.env['OPENAI_API_KEY']) {
      throw new Error('Cannot create a thread summary because OPENAI_API_KEY is not configured.');
    }

    if (!model) {
      throw new Error('Cannot create a thread summary because no summary model is configured.');
    }

    const content = await createModelThreadSummaryContent(thread, model);

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

async function createModelThreadSummaryContent(thread: ChatThread, model: string): Promise<string> {
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
        'No previous summary exists for this thread. Create the first durable summary.',
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
