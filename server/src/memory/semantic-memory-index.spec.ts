import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { describe, expect, it, vi } from 'vitest';

import { FileMemoryStore } from './file-memory-store';
import { SqliteSemanticMemoryIndex } from './semantic-memory-index';

describe('semantic memory retrieval', () => {
  it('finds an English agent memory from a German query without crossing agent scope', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-semantic-memory-'));
    const embedDocuments = vi.fn(async (texts: string[]) => texts.map(vectorFor));
    const embedQuery = vi.fn(async (text: string) => vectorFor(text));
    const embeddings = { embedDocuments, embedQuery } as unknown as EmbeddingsInterface;
    const index = new SqliteSemanticMemoryIndex(dataDir, embeddings, 'test-multilingual', 0.5);
    const store = new FileMemoryStore(dataDir, undefined, index);

    try {
      const ronaldoMemory = await store.createEntry({
        scope: 'agent_user',
        agentId: 'ronaldo',
        content: "The user's favorite club is Werder Bremen.",
        tags: ['favorite club', 'soccer'],
      });
      await store.createEntry({
        scope: 'agent_user',
        agentId: 'scotty',
        content: "The user's favorite club is FC St. Pauli.",
        tags: ['favorite club', 'soccer'],
      });

      await expect(
        store.listEntries({ agentId: 'ronaldo', query: 'Werder Bremen', limit: 5 }),
      ).resolves.toEqual([ronaldoMemory]);
      expect(embedDocuments).not.toHaveBeenCalled();
      expect(embedQuery).not.toHaveBeenCalled();

      await expect(
        store.listEntries({
          agentId: 'ronaldo',
          query: 'Welcher Fußballverein ist mein Lieblingsverein?',
          limit: 5,
        }),
      ).resolves.toEqual([ronaldoMemory]);
      expect(embedDocuments).toHaveBeenCalledTimes(1);

      await store.listEntries({
        agentId: 'ronaldo',
        query: 'Lieblingsverein',
        limit: 5,
      });
      expect(embedDocuments).toHaveBeenCalledTimes(1);
      expect(embedQuery).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('re-embeds changed memories and removes deleted memories from retrieval', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-semantic-memory-update-'));
    const embedDocuments = vi.fn(async (texts: string[]) => texts.map(vectorFor));
    const embeddings = {
      embedDocuments,
      embedQuery: async (text: string) => vectorFor(text),
    } as unknown as EmbeddingsInterface;
    const index = new SqliteSemanticMemoryIndex(dataDir, embeddings, 'test-multilingual', 0.5);
    const store = new FileMemoryStore(dataDir, undefined, index);

    try {
      const memory = await store.createEntry({
        scope: 'agent',
        agentId: 'ronaldo',
        content: 'The project uses Angular.',
      });
      await store.listEntries({ agentId: 'ronaldo', query: 'Frontend framework' });
      await store.updateEntry(memory.id, { content: 'The project uses Fastify.' });

      await expect(
        store.listEntries({ agentId: 'ronaldo', query: 'Backend framework' }),
      ).resolves.toMatchObject([{ id: memory.id, content: 'The project uses Fastify.' }]);
      expect(embedDocuments).toHaveBeenCalledTimes(2);

      await store.deleteEntry(memory.id);
      await expect(
        store.listEntries({ agentId: 'ronaldo', query: 'Backend framework' }),
      ).resolves.toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

function vectorFor(text: string): number[] {
  const normalized = text.toLocaleLowerCase();

  if (
    normalized.includes('favorite club') ||
    normalized.includes('lieblingsverein') ||
    normalized.includes('fußballverein')
  ) {
    return [1, 0, 0];
  }

  if (normalized.includes('angular') || normalized.includes('frontend')) {
    return [0, 1, 0];
  }

  if (normalized.includes('fastify') || normalized.includes('backend')) {
    return [0, 0, 1];
  }

  return [0.1, 0.1, 0.1];
}
