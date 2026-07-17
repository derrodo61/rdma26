import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LocalDatabase } from '../storage/local-database';
import { LlmCallStore } from './llm-call-store';
import { ModelPricingStore } from './model-pricing-store';

describe('LlmCallStore', () => {
  it('stores successful LLM calls with token usage', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-llm-calls-'));

    try {
      const store = new LlmCallStore(dataDir);
      const runId = crypto.randomUUID();
      const call = await store.startCall({
        runId,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'chat',
        agentId: 'ronaldo',
        threadId: crypto.randomUUID(),
        providerRunId: crypto.randomUUID(),
      });

      await store.finishCall(call.id, 'success', {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        cachedInputTokens: 4,
        reasoningTokens: 2,
      });

      await expect(store.listCallsForRun(runId)).resolves.toMatchObject([
        {
          id: call.id,
          runId,
          provider: 'openai',
          model: 'gpt-5.4-mini',
          purpose: 'chat',
          status: 'success',
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 4,
          reasoningTokens: 2,
        },
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('calculates estimated costs from active pricing records', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-llm-calls-'));

    try {
      const pricingStore = new ModelPricingStore(dataDir);
      const store = new LlmCallStore(dataDir, pricingStore);
      const pricing = await pricingStore.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 1,
        outputCostPerMillionTokens: 2,
        cachedInputCostPerMillionTokens: 0.1,
        reasoningCostPerMillionTokens: 3,
        sourceUrl: 'https://example.com/pricing',
      });
      const runId = crypto.randomUUID();
      const call = await store.startCall({
        runId,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'chat',
      });

      await store.finishCall(call.id, 'success', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
        cachedInputTokens: 250_000,
        reasoningTokens: 100_000,
      });

      await expect(store.listCallsForRun(runId)).resolves.toMatchObject([
        {
          id: call.id,
          pricingSnapshotId: pricing.id,
          estimatedInputCost: 0.75,
          estimatedOutputCost: 1.8,
          estimatedCachedInputCost: 0.025,
          estimatedReasoningCost: 0.3,
          estimatedTotalCost: 2.875,
          estimatedCostCurrency: 'USD',
        },
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('estimates ChatGPT login model costs from matching OpenAI pricing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-llm-calls-'));

    try {
      const pricingStore = new ModelPricingStore(dataDir);
      const store = new LlmCallStore(dataDir, pricingStore);
      const pricing = await pricingStore.createPricing({
        provider: 'openai',
        model: 'gpt-5.4',
        inputCostPerMillionTokens: 2.5,
        outputCostPerMillionTokens: 15,
        cachedInputCostPerMillionTokens: 0.25,
        sourceUrl: 'https://example.com/pricing',
      });
      const runId = crypto.randomUUID();
      const call = await store.startCall({
        runId,
        provider: 'openai-chatgpt',
        model: 'gpt-5.4',
        purpose: 'chat',
      });

      await store.finishCall(call.id, 'success', {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
        cachedInputTokens: 250_000,
      });

      await expect(store.listCallsForRun(runId)).resolves.toMatchObject([
        {
          id: call.id,
          provider: 'openai-chatgpt',
          model: 'gpt-5.4',
          pricingSnapshotId: pricing.id,
          estimatedInputCost: 1.875,
          estimatedOutputCost: 1.5,
          estimatedCachedInputCost: 0.0625,
          estimatedTotalCost: 3.4375,
          estimatedCostCurrency: 'USD',
        },
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('summarizes estimated costs by model', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-llm-calls-'));

    try {
      const pricingStore = new ModelPricingStore(dataDir);
      const store = new LlmCallStore(dataDir, pricingStore);
      await pricingStore.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 1,
        outputCostPerMillionTokens: 2,
        sourceUrl: 'https://example.com/pricing',
      });
      const first = await store.startCall({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'chat',
      });
      const second = await store.startCall({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'thread_summary',
      });

      await store.finishCall(first.id, 'success', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
      });
      await store.finishCall(second.id, 'success', {
        inputTokens: 500_000,
        outputTokens: 250_000,
        totalTokens: 750_000,
      });

      await expect(
        store.summarizeCosts({
          groupBy: 'model',
        }),
      ).resolves.toEqual({
        groupBy: 'model',
        rows: [
          {
            key: 'openai/gpt-5.4-mini',
            currency: 'USD',
            callCount: 2,
            inputTokens: 1_500_000,
            outputTokens: 1_250_000,
            totalTokens: 2_750_000,
            estimatedTotalCost: 4,
          },
        ],
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('stores failed LLM calls without token usage', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-llm-calls-'));

    try {
      const store = new LlmCallStore(dataDir);
      const runId = crypto.randomUUID();
      const call = await store.startCall({
        runId,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'thread_summary',
      });

      await store.finishCall(call.id, 'error', undefined, 'Boom');

      await expect(store.listCallsForRun(runId)).resolves.toMatchObject([
        {
          id: call.id,
          status: 'error',
          errorMessage: 'Boom',
        },
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('keeps unfinished calls as cancelled', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-llm-calls-'));

    try {
      const store = new LlmCallStore(dataDir);
      const runId = crypto.randomUUID();

      await store.startCall({
        runId,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'chat',
      });

      await expect(store.listCallsForRun(runId)).resolves.toMatchObject([
        {
          status: 'cancelled',
        },
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes orphaned calls whose owning thread no longer exists', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-llm-calls-'));

    try {
      const store = new LlmCallStore(dataDir);
      const database = new LocalDatabase(dataDir);
      const keptThreadId = crypto.randomUUID();
      const deletedThreadId = crypto.randomUUID();
      const keptRunId = crypto.randomUUID();
      const deletedRunId = crypto.randomUUID();

      await database.ensureReady();
      database
        .get()
        .prepare(
          `
            insert into threads (id, agent_id, title, created_at, updated_at)
            values (?, ?, ?, ?, ?)
          `,
        )
        .run(
          keptThreadId,
          'ronaldo',
          'Existing',
          new Date().toISOString(),
          new Date().toISOString(),
        );

      await store.startCall({
        runId: keptRunId,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'chat',
        agentId: 'ronaldo',
        threadId: keptThreadId,
      });
      await store.startCall({
        runId: deletedRunId,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        purpose: 'chat',
        agentId: 'ronaldo',
        threadId: deletedThreadId,
      });

      await expect(store.deleteOrphanedCalls()).resolves.toBe(1);
      await expect(store.listCallsForRun(keptRunId)).resolves.toHaveLength(1);
      await expect(store.listCallsForRun(deletedRunId)).resolves.toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
