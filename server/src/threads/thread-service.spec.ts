import { describe, expect, it, vi } from 'vitest';

import type { ChatThread } from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import type { LlmCallStore } from '../llm/llm-call-store';
import type { RunContextStore } from '../runs/run-context-store';
import type { ThreadCheckpointer } from './thread-checkpointer';
import { ThreadService } from './thread-service';

describe('ThreadService conversation history', () => {
  it('searches only the selected agent and returns bounded excerpts', async () => {
    const ronaldoThreads = [
      thread('first', 'World Cup planning', [
        message('user', 'We discussed the England and Norway match.'),
        message('assistant', 'The match starts at 21:00.'),
      ]),
      thread('second', 'Cooking', [message('user', 'Pizza dough')]),
    ];
    const storage = storageFor(ronaldoThreads);
    const service = createService(storage);

    const result = await service.searchPastConversations('ronaldo', 'England Norway', 1, 'current');

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ threadId: 'first', title: 'World Cup planning' });
    expect(result.results[0]?.excerpt.length).toBeLessThanOrEqual(400);
    expect(storage.readThread).toHaveBeenCalledTimes(2);
  });

  it('bounds reads and rejects the current thread', async () => {
    const messages = Array.from({ length: 60 }, (_, index) =>
      message(index % 2 ? 'assistant' : 'user', `Message ${index}`),
    );
    const service = createService(storageFor([thread('earlier', 'Earlier', messages)]));

    const result = await service.readPastConversation('ronaldo', 'earlier', 50, 'current');
    expect(result.messages).toHaveLength(50);
    expect(result.messages[0]?.content).toBe('Message 10');
    await expect(service.readPastConversation('ronaldo', 'current', 20, 'current')).rejects.toThrow(
      'current thread',
    );
  });
});

function createService(storage: ReturnType<typeof storageFor>): ThreadService {
  const registry = {
    storageFor: vi.fn(async (agentId: string) => {
      if (agentId !== 'ronaldo') throw new Error('Wrong agent');
      return storage;
    }),
  } as unknown as AgentRegistry;

  return new ThreadService(
    registry,
    {} as RunContextStore,
    {} as LlmCallStore,
    {} as ThreadCheckpointer,
  );
}

function storageFor(threads: readonly ChatThread[]) {
  return {
    listThreads: vi.fn(async () =>
      threads.map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length })),
    ),
    readThread: vi.fn(
      async (threadId: string) => threads.find((candidate) => candidate.id === threadId) ?? null,
    ),
  };
}

function thread(id: string, title: string, messages: ChatThread['messages']): ChatThread {
  return {
    id,
    agentId: 'ronaldo',
    title,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-02T10:00:00.000Z',
    messageCount: messages.length,
    messages,
  };
}

function message(role: 'user' | 'assistant', content: string) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: '2026-07-01T10:00:00.000Z',
  } as const;
}
