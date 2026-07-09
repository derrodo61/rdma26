import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { PricingSourceStore } from './pricing-source-store';

describe('PricingSourceStore', () => {
  it('seeds the official OpenAI pricing source once', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-pricing-sources-'));
    const store = new PricingSourceStore(dataDir);

    try {
      await store.ensureDefaultSources();
      await store.ensureDefaultSources();

      const response = await store.listSources({ provider: 'openai' });

      expect(response).toHaveLength(1);
      expect(response[0]).toMatchObject({
        provider: 'openai',
        name: 'OpenAI API pricing',
        url: 'https://developers.openai.com/api/docs/pricing',
        trustLevel: 'official',
        active: true,
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('creates, filters, updates, and deletes pricing sources', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-pricing-sources-'));
    const store = new PricingSourceStore(dataDir);

    try {
      const source = await store.createSource({
        provider: 'anthropic',
        name: 'Anthropic pricing',
        url: 'https://example.com/pricing',
        trustLevel: 'third_party',
        active: true,
      });

      expect(await store.listSources({ trustLevel: 'third_party' })).toHaveLength(1);

      const updated = await store.updateSource(source.id, {
        active: false,
        notes: 'Temporarily disabled.',
      });

      expect(updated).toMatchObject({
        active: false,
        notes: 'Temporarily disabled.',
      });

      expect(await store.listSources({ active: true })).toHaveLength(0);
      expect(await store.deleteSource(source.id)).toEqual({
        deleted: true,
        sourceId: source.id,
      });
      expect(await store.listSources()).toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
