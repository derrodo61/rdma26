import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryStore } from './memory-store';

describe('MemoryStore', () => {
  const originalOpenAiApiKey = process.env['OPENAI_API_KEY'];

  beforeAll(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  afterAll(() => {
    if (originalOpenAiApiKey) {
      process.env['OPENAI_API_KEY'] = originalOpenAiApiKey;
    } else {
      delete process.env['OPENAI_API_KEY'];
    }
  });

  it('stores, searches, updates, and deletes agent-scoped memories', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-memory-'));

    try {
      const store = new MemoryStore(dataDir);
      const memory = await store.createMemory({
        scope: 'agent',
        agentId: 'ronaldo',
        type: 'tracked_topic',
        content: 'Track the Brazil versus Norway game result.',
        tags: ['football', 'world-cup'],
      });

      await store.createMemory({
        scope: 'user',
        type: 'preference',
        lifetime: 'permanent',
        content: 'The user prefers German match times.',
      });
      const summary = await store.createMemory({
        scope: 'agent',
        agentId: 'ronaldo',
        type: 'conversation_summary',
        content: 'Conversation summary for a tracked match thread.',
        source: {
          agentId: 'ronaldo',
          threadId: '00000000-0000-0000-0000-000000000000',
        },
      });

      const searchResults = await store.searchForRun('ronaldo', 'Norway football', 5);

      expect(searchResults.map((result) => result.memory.id)).toContain(memory.id);
      await expect(
        store.findThreadSummary('ronaldo', '00000000-0000-0000-0000-000000000000'),
      ).resolves.toEqual(summary);

      const updated = await store.updateMemory(memory.id, {
        status: 'archived',
      });

      expect(updated.status).toBe('archived');
      expect(await store.listMemories({ agentId: 'ronaldo' })).toHaveLength(2);
      expect(await store.listMemories({ agentId: 'ronaldo', status: 'archived' })).toHaveLength(1);

      await expect(store.deleteMemory(memory.id)).resolves.toBe(true);
      await expect(store.readMemory(memory.id)).resolves.toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('requires agent ids for agent-scoped memories', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-memory-'));

    try {
      const store = new MemoryStore(dataDir);

      await expect(
        store.createMemory({
          scope: 'agent',
          type: 'fact',
          content: 'This should fail.',
        }),
      ).rejects.toThrow('Agent-scoped memories require agentId.');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('stores multiline memory content as readable content lines', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-memory-'));

    try {
      const store = new MemoryStore(dataDir);
      const memory = await store.createMemory({
        scope: 'agent',
        agentId: 'ronaldo',
        type: 'conversation_summary',
        content: ['Conversation summary for thread.', '- First point.', '- Second point.'].join(
          '\n',
        ),
      });
      const stored = await store.requireMemory(memory.id);

      expect(memory.contentLines).toEqual([
        'Conversation summary for thread.',
        '- First point.',
        '- Second point.',
      ]);
      expect(stored.contentLines).toEqual(memory.contentLines);
      await expect(stat(join(dataDir, 'rdma26.sqlite'))).resolves.toBeTruthy();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('imports existing JSON memories into SQLite', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-memory-'));

    try {
      const memoryDir = join(dataDir, 'agents', 'ronaldo', 'memories');
      await mkdir(memoryDir, { recursive: true });
      await writeFile(
        join(memoryDir, '00000000-0000-0000-0000-000000000001.json'),
        `${JSON.stringify(
          {
            id: '00000000-0000-0000-0000-000000000001',
            scope: 'agent_user',
            agentId: 'ronaldo',
            type: 'preference',
            status: 'active',
            lifetime: 'permanent',
            content: 'The user prefers to communicate with Ronaldo in German.',
            tags: ['language'],
            createdAt: '2026-07-08T00:00:00.000Z',
            updatedAt: '2026-07-08T00:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );

      const store = new MemoryStore(dataDir);

      await expect(store.readMemory('00000000-0000-0000-0000-000000000001')).resolves.toMatchObject(
        {
          id: '00000000-0000-0000-0000-000000000001',
          scope: 'agent_user',
          agentId: 'ronaldo',
        },
      );
      await expect(
        stat(join(memoryDir, '00000000-0000-0000-0000-000000000001.json')),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('does not re-import deleted JSON memories after initial migration', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-memory-'));

    try {
      const memoryDir = join(dataDir, 'user', 'memories');
      await mkdir(memoryDir, { recursive: true });
      await writeFile(
        join(memoryDir, '00000000-0000-0000-0000-000000000002.json'),
        `${JSON.stringify(
          {
            id: '00000000-0000-0000-0000-000000000002',
            scope: 'user',
            type: 'fact',
            status: 'active',
            lifetime: 'permanent',
            content: 'Imported user memory.',
            tags: [],
            createdAt: '2026-07-08T00:00:00.000Z',
            updatedAt: '2026-07-08T00:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );

      const store = new MemoryStore(dataDir);
      await expect(store.deleteMemory('00000000-0000-0000-0000-000000000002')).resolves.toBe(true);
      await expect(store.listMemories({ scope: 'user' })).resolves.toEqual([]);
      await new MemoryStore(dataDir).ensureReady();

      await expect(store.listMemories({ scope: 'user' })).resolves.toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('filters memories by lifetime, tag, and created or updated date ranges', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-memory-'));

    try {
      const memoryDir = join(dataDir, 'agents', 'ronaldo', 'memories');
      await mkdir(memoryDir, { recursive: true });
      await writeFile(
        join(memoryDir, '00000000-0000-0000-0000-000000000003.json'),
        `${JSON.stringify(
          {
            id: '00000000-0000-0000-0000-000000000003',
            scope: 'agent',
            agentId: 'ronaldo',
            type: 'tracked_topic',
            status: 'active',
            lifetime: 'active',
            content: 'Track the current World Cup knockout results.',
            tags: ['football', 'world-cup'],
            createdAt: '2026-07-07T08:00:00.000Z',
            updatedAt: '2026-07-08T09:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(memoryDir, '00000000-0000-0000-0000-000000000004.json'),
        `${JSON.stringify(
          {
            id: '00000000-0000-0000-0000-000000000004',
            scope: 'agent',
            agentId: 'ronaldo',
            type: 'fact',
            status: 'active',
            lifetime: 'permanent',
            content: 'Ronaldo should answer with concise football summaries.',
            tags: ['style'],
            createdAt: '2026-07-01T08:00:00.000Z',
            updatedAt: '2026-07-01T09:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );

      const store = new MemoryStore(dataDir);
      const filtered = await store.listMemories({
        agentId: 'ronaldo',
        scope: 'agent',
        status: 'active',
        lifetime: 'active',
        tag: 'world-cup',
        createdFrom: '2026-07-07',
        updatedTo: '2026-07-08',
      });

      expect(filtered.map((memory) => memory.id)).toEqual(['00000000-0000-0000-0000-000000000003']);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('retrieves recent conversation summaries for recall prompts without topic overlap', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-memory-'));

    try {
      const store = new MemoryStore(dataDir);
      const summary = await store.createMemory({
        scope: 'agent',
        agentId: 'ronaldo',
        type: 'conversation_summary',
        content: 'The user asked the agent to track Brazil versus Norway.',
        tags: ['thread-summary'],
      });
      const stablePreference = await store.createMemory({
        scope: 'agent_user',
        agentId: 'ronaldo',
        type: 'preference',
        lifetime: 'permanent',
        content: 'The user prefers match times in Europe/Berlin.',
      });

      const results = await store.searchForRun('ronaldo', 'What did we talk about last time?', 5);

      expect(results.map((result) => result.memory.id)).toContain(summary.id);
      expect(results.map((result) => result.memory.id)).toContain(stablePreference.id);
      expect(
        results.find((result) => result.memory.id === summary.id)?.source.score,
      ).toBeGreaterThan(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
