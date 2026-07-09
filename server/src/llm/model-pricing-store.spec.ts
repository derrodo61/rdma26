import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ModelPricingStore } from './model-pricing-store';

describe('ModelPricingStore', () => {
  it('creates unverified pricing records by default', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-model-pricing-'));

    try {
      const store = new ModelPricingStore(dataDir);
      const pricing = await store.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 1,
        outputCostPerMillionTokens: 2,
        sourceUrl: 'https://example.com/pricing',
      });

      expect(pricing).toMatchObject({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        currency: 'USD',
        status: 'unverified',
      });
      await expect(
        store.findActivePricing('openai', 'gpt-5.4-mini', pricing.createdAt),
      ).resolves.toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('supersedes the previous active pricing record for the same model', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-model-pricing-'));

    try {
      const store = new ModelPricingStore(dataDir);
      const first = await store.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 1,
        outputCostPerMillionTokens: 2,
        sourceUrl: 'https://example.com/first',
        status: 'active',
      });
      const second = await store.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 3,
        outputCostPerMillionTokens: 4,
        sourceUrl: 'https://example.com/second',
        status: 'active',
      });

      await expect(store.requirePricing(first.id)).resolves.toMatchObject({
        status: 'superseded',
      });
      await expect(
        store.findActivePricing('openai', 'gpt-5.4-mini', new Date().toISOString()),
      ).resolves.toMatchObject({
        id: second.id,
        status: 'active',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('activates an existing unverified record', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-model-pricing-'));

    try {
      const store = new ModelPricingStore(dataDir);
      const pricing = await store.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 1,
        outputCostPerMillionTokens: 2,
        sourceUrl: 'https://example.com/pricing',
      });

      await expect(
        store.updatePricing(pricing.id, {
          status: 'active',
        }),
      ).resolves.toMatchObject({
        id: pricing.id,
        status: 'active',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
