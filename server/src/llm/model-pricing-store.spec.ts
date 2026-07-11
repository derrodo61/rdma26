import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ModelPricingStore } from './model-pricing-store';

describe('ModelPricingStore', () => {
  it('creates active pricing records by default', async () => {
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
        status: 'active',
      });
      await expect(
        store.findActivePricing('openai', 'gpt-5.4-mini', pricing.createdAt),
      ).resolves.toMatchObject({ id: pricing.id });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('allows only one pricing record for each provider and model', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-model-pricing-'));

    try {
      const store = new ModelPricingStore(dataDir);
      await store.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 1,
        outputCostPerMillionTokens: 2,
        sourceUrl: 'https://example.com/first',
      });
      await expect(
        store.createPricing({
          provider: 'openai',
          model: 'gpt-5.4-mini',
          inputCostPerMillionTokens: 3,
          outputCostPerMillionTokens: 4,
          sourceUrl: 'https://example.com/second',
        }),
      ).rejects.toThrow('already exists');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('deactivates and reactivates a pricing record explicitly', async () => {
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

      await expect(store.setPricingActive(pricing.id, false)).resolves.toMatchObject({
        id: pricing.id,
        status: 'inactive',
      });
      await expect(
        store.findActivePricing('openai', 'gpt-5.4-mini', new Date().toISOString()),
      ).resolves.toBeNull();
      await expect(store.setPricingActive(pricing.id, true)).resolves.toMatchObject({
        status: 'active',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('updates editable pricing fields and clears nullable fields', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-model-pricing-'));

    try {
      const store = new ModelPricingStore(dataDir);
      const pricing = await store.createPricing({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        inputCostPerMillionTokens: 1,
        outputCostPerMillionTokens: 2,
        cachedInputCostPerMillionTokens: 0.5,
        reasoningCostPerMillionTokens: 3,
        sourceUrl: 'https://example.com/pricing',
        sourceName: 'Example',
        notes: 'Draft',
      });

      await store.setPricingActive(pricing.id, false);

      await expect(
        store.updatePricing(pricing.id, {
          inputCostPerMillionTokens: 1.25,
          outputCostPerMillionTokens: 2.5,
          cachedInputCostPerMillionTokens: null,
          reasoningCostPerMillionTokens: null,
          sourceName: null,
          notes: null,
        }),
      ).resolves.toMatchObject({
        id: pricing.id,
        inputCostPerMillionTokens: 1.25,
        outputCostPerMillionTokens: 2.5,
        cachedInputCostPerMillionTokens: undefined,
        reasoningCostPerMillionTokens: undefined,
        sourceName: undefined,
        status: 'active',
        notes: undefined,
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes pricing records', async () => {
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

      await expect(store.deletePricing(pricing.id)).resolves.toEqual({
        deleted: true,
        pricingId: pricing.id,
      });
      await expect(store.readPricing(pricing.id)).resolves.toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
