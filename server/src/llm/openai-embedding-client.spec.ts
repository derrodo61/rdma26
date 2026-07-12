import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { LlmCallStore } from './llm-call-store';
import { ModelPricingStore } from './model-pricing-store';
import { AccountingOpenAiEmbeddingClient } from './openai-embedding-client';

describe('AccountingOpenAiEmbeddingClient', () => {
  it('records provider-reported embedding usage, run ownership, metadata, and cost', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-embedding-accounting-'));

    try {
      const pricingStore = new ModelPricingStore(dataDir);
      await pricingStore.createPricing({
        provider: 'openai',
        model: 'text-embedding-test',
        inputCostPerMillionTokens: 0.02,
        outputCostPerMillionTokens: 0,
        sourceUrl: 'https://developers.openai.com/api/docs/pricing',
      });
      const callStore = new LlmCallStore(dataDir, pricingStore);
      const create = vi.fn(async () => ({
        model: 'text-embedding-test',
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      }));
      const client = new AccountingOpenAiEmbeddingClient(
        'test-key',
        'text-embedding-test',
        callStore,
        { embeddings: { create } },
      );

      await expect(
        client.embedQuery('Lieblingsverein', {
          runId: 'run-1',
          agentId: 'ronaldo',
          threadId: 'thread-1',
          operation: 'memory_query',
          metadata: { cachedMemoryCount: 2 },
        }),
      ).resolves.toEqual([0.1, 0.2, 0.3]);

      const [call] = await callStore.listCallsForRun('run-1');
      expect(call).toMatchObject({
        provider: 'openai',
        model: 'text-embedding-test',
        purpose: 'memory_retrieval',
        status: 'success',
        agentId: 'ronaldo',
        threadId: 'thread-1',
        inputTokens: 7,
        outputTokens: 0,
        totalTokens: 7,
        estimatedInputCost: 0.00000014,
        estimatedTotalCost: 0.00000014,
        metadata: {
          requestKind: 'embedding',
          operation: 'memory_query',
          inputCount: 1,
          cachedMemoryCount: 2,
        },
      });
      expect(create).toHaveBeenCalledWith({
        model: 'text-embedding-test',
        input: ['Lieblingsverein'],
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('records failed embedding requests', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-embedding-accounting-error-'));

    try {
      const callStore = new LlmCallStore(dataDir);
      const client = new AccountingOpenAiEmbeddingClient(
        'test-key',
        'text-embedding-test',
        callStore,
        {
          embeddings: {
            create: vi.fn(async () => {
              throw new Error('embedding failed');
            }),
          },
        },
      );

      await expect(
        client.embedQuery('query', {
          runId: 'run-error',
          operation: 'memory_query',
        }),
      ).rejects.toThrow('embedding failed');
      await expect(callStore.listCallsForRun('run-error')).resolves.toMatchObject([
        {
          status: 'error',
          errorMessage: 'embedding failed',
          purpose: 'memory_retrieval',
        },
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
