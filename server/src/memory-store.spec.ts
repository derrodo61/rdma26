import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
      const raw = JSON.parse(
        await readFile(join(dataDir, 'agents', 'ronaldo', 'memories', `${memory.id}.json`), 'utf8'),
      ) as { readonly contentLines?: readonly string[] };

      expect(memory.contentLines).toEqual([
        'Conversation summary for thread.',
        '- First point.',
        '- Second point.',
      ]);
      expect(raw.contentLines).toEqual(memory.contentLines);
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
