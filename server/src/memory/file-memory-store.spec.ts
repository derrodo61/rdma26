import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileMemoryStore } from './file-memory-store';

describe('FileMemoryStore', () => {
  it('persists scoped Markdown entries and returns applicable pinned paths', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-file-memory-'));

    try {
      const store = new FileMemoryStore(dataDir);
      const global = await store.createEntry({
        scope: 'user',
        pinned: true,
        content: 'The user prefers plain language.',
        tags: ['Style'],
      });
      const local = await store.createEntry({
        scope: 'agent_user',
        agentId: 'ronaldo',
        pinned: true,
        content: 'Use German for this agent.',
      });
      const privateEntry = await store.createEntry({
        scope: 'agent',
        agentId: 'scotty',
        content: 'Scotty-specific knowledge.',
      });

      await expect(store.listEntries({ agentId: 'ronaldo' })).resolves.toHaveLength(2);
      await expect(store.listEntries({ agentId: 'scotty' })).resolves.toHaveLength(2);
      await expect(store.pinnedPathsForAgent('ronaldo')).resolves.toEqual([
        `/memory/agent-user/${local.id}.md`,
        `/memory/global/${global.id}.md`,
      ]);
      await expect(store.readEntry(privateEntry.id)).resolves.toEqual(privateEntry);
      const markdown = await readFile(join(dataDir, 'user', 'memory', `${global.id}.md`), 'utf8');
      expect(markdown).toContain('scope: user');
      expect(markdown).toContain('The user prefers plain language.');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('enforces a bounded pinned-memory budget without limiting unpinned entries', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-file-memory-budget-'));

    try {
      const store = new FileMemoryStore(dataDir, 30);
      const first = await store.createEntry({
        scope: 'agent',
        agentId: 'ronaldo',
        pinned: true,
        content: 'One short memory.',
      });
      await expect(
        store.createEntry({
          scope: 'agent',
          agentId: 'ronaldo',
          pinned: true,
          content: 'This second memory exceeds the budget.',
        }),
      ).rejects.toThrow('Pinned agent memory would use');
      await expect(
        store.createEntry({
          scope: 'agent',
          agentId: 'ronaldo',
          content: 'Unpinned content can be much longer than the startup memory budget.',
        }),
      ).resolves.toBeTruthy();
      await expect(store.updateEntry(first.id, { pinned: false })).resolves.toMatchObject({
        pinned: false,
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('updates and deletes entries without a database copy', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-file-memory-update-'));

    try {
      const store = new FileMemoryStore(dataDir);
      const created = await store.createEntry({
        scope: 'agent',
        agentId: 'ronaldo',
        content: 'Original memory.',
      });
      const updated = await store.updateEntry(created.id, {
        content: 'Corrected memory.',
        pinned: true,
      });

      expect(updated.content).toBe('Corrected memory.');
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.pinned).toBe(true);
      await expect(store.deleteEntry(created.id)).resolves.toBe(true);
      await expect(store.readEntry(created.id)).resolves.toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
