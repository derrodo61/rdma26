import { describe, expect, it, vi } from 'vitest';

import type { ChatThread } from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import type { LlmCallStore } from '../llm/llm-call-store';
import type { RunContextStore } from '../runs/run-context-store';
import type { ThreadCheckpointer } from './thread-checkpointer';
import { ThreadService } from './thread-service';

describe('ThreadService conversation history', () => {
  it('renames a thread through its agent-scoped storage', async () => {
    const original = thread('first', 'Original title', []);
    const renamed = { ...original, title: 'Renamed thread' };
    const storage = storageFor([original]);
    storage.updateThreadTitle.mockResolvedValueOnce(renamed);
    const service = createService(storage);

    await expect(
      service.updateThread('ronaldo', original.id, { title: renamed.title }),
    ).resolves.toEqual(renamed);
    expect(storage.updateThreadTitle).toHaveBeenCalledWith(original.id, renamed.title);
  });

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

  it('prioritizes the newest thread when the query asks for the previous thread', async () => {
    const older = thread(
      'older',
      'Evaluation thread follow-up',
      [
        message('user', 'Remember the temporary marker ORBIT-742.'),
        message('assistant', 'I will remember it for the previous message in this thread.'),
      ],
      '2026-07-02T10:00:00.000Z',
    );
    const newest = thread(
      'newest',
      'Historical marker',
      [message('user', 'The temporary historical marker is HISTORY-731.')],
      '2026-07-03T10:00:00.000Z',
    );
    const service = createService(storageFor([older, newest]));

    const result = await service.searchPastConversations(
      'ronaldo',
      'temporary historical marker previous thread',
      5,
      'current',
    );

    expect(result.results.map((candidate) => candidate.threadId)).toEqual(['newest', 'older']);
    expect(result.results[0]).toMatchObject({
      excerpt: 'The temporary historical marker is HISTORY-731.',
      ranking: 'previous_thread',
    });
  });

  it('returns the newest prior thread for a previous-thread query without topic words', async () => {
    const service = createService(
      storageFor([
        thread('older', 'Older', [message('user', 'First topic')], '2026-07-02T10:00:00.000Z'),
        thread('newest', 'Newest', [message('user', 'Second topic')], '2026-07-03T10:00:00.000Z'),
      ]),
    );

    const result = await service.searchPastConversations(
      'ronaldo',
      'What did we discuss in the previous thread?',
      1,
      'current',
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.threadId).toBe('newest');
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
    updateThreadTitle: vi.fn(async () => null as ChatThread | null),
  };
}

function thread(
  id: string,
  title: string,
  messages: ChatThread['messages'],
  updatedAt = '2026-07-02T10:00:00.000Z',
): ChatThread {
  return {
    id,
    agentId: 'ronaldo',
    title,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt,
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
