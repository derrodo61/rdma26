import { describe, expect, it } from 'vitest';

import type { ModelPricingRecord, PricingSourceRecord } from '../../../shared/agent-contracts';
import {
  compareOpenAiModelPricing,
  extractOpenAiModelPricingFromHtml,
} from './openai-pricing-sync';

const source: PricingSourceRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'openai',
  name: 'OpenAI API pricing',
  url: 'https://developers.openai.com/api/docs/pricing',
  trustLevel: 'official',
  active: true,
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('OpenAI pricing sync', () => {
  it('extracts standard short-context and long-context prices from the pricing table', () => {
    const pricing = extractOpenAiModelPricingFromHtml(`
      <table>
        <tr><th></th><th colspan="4">Short context</th><th colspan="4">Long context</th></tr>
        <tr>
          <th>Model</th>
          <th>Input</th>
          <th>Cached input</th>
          <th>Cache writes</th>
          <th>Output</th>
          <th>Input</th>
          <th>Cached input</th>
          <th>Cache writes</th>
          <th>Output</th>
        </tr>
        <tr>
          <td>gpt-5.4 (&lt;272K context length)</td>
          <td>$2.50</td>
          <td>$0.25</td>
          <td>-</td>
          <td>$15.00</td>
          <td>$5.00</td>
          <td>$0.50</td>
          <td>-</td>
          <td>$22.50</td>
        </tr>
      </table>
    `);

    expect(pricing).toEqual([
      {
        model: 'gpt-5.4',
        sourceLabel: 'gpt-5.4 (<272K context length)',
        shortContext: {
          inputCostPerMillionTokens: 2.5,
          cachedInputCostPerMillionTokens: 0.25,
          cacheWriteCostPerMillionTokens: undefined,
          outputCostPerMillionTokens: 15,
        },
        longContext: {
          inputCostPerMillionTokens: 5,
          cachedInputCostPerMillionTokens: 0.5,
          cacheWriteCostPerMillionTokens: undefined,
          outputCostPerMillionTokens: 22.5,
        },
      },
    ]);
  });

  it('compares saved active records against official short-context prices', () => {
    const result = compareOpenAiModelPricing({
      source,
      retrievedAt: '2026-07-10T01:00:00.000Z',
      officialPricing: [
        {
          model: 'gpt-5.4',
          sourceLabel: 'gpt-5.4 (<272K context length)',
          shortContext: {
            inputCostPerMillionTokens: 2.5,
            cachedInputCostPerMillionTokens: 0.25,
            outputCostPerMillionTokens: 15,
          },
        },
        {
          model: 'gpt-5.4-pro',
          sourceLabel: 'gpt-5.4-pro (<272K context length)',
          shortContext: {
            inputCostPerMillionTokens: 30,
            outputCostPerMillionTokens: 180,
          },
        },
      ],
      savedPricing: [
        savedPricing({
          model: 'gpt-5.4',
          inputCostPerMillionTokens: 2.5,
          outputCostPerMillionTokens: 15,
          sourceUrl: 'https://example.com/old-pricing',
        }),
        savedPricing({
          model: 'gpt-5.4-mini',
          inputCostPerMillionTokens: 0.75,
          outputCostPerMillionTokens: 4.5,
        }),
      ],
    });

    expect(result.summary).toContain('1 saved records differ: gpt-5.4.');
    expect(result.matchedModels).toEqual([]);
    expect(result.updatedModels).toEqual([]);
    expect(result.metadataWarnings).toContainEqual({
      model: 'gpt-5.4',
      warnings: [
        'Saved source URL is not the configured official OpenAI pricing source: https://example.com/old-pricing',
      ],
    });
    expect(result.different).toMatchObject([
      {
        model: 'gpt-5.4',
        differences: ['cachedInputCostPerMillionTokens: saved missing, official 0.25.'],
      },
    ]);
    expect(result.missingOfficialModels).toEqual(['gpt-5.4-mini']);
    expect(result.missingLocalModels).toEqual(['gpt-5.4-pro']);
    expect(result.notes).toContain(
      'This tool only compares records. It does not create, update, activate, deactivate, or delete pricing records.',
    );
  });
});

function savedPricing(
  input: Pick<
    ModelPricingRecord,
    'model' | 'inputCostPerMillionTokens' | 'outputCostPerMillionTokens'
  > &
    Partial<ModelPricingRecord>,
): ModelPricingRecord {
  return {
    id: crypto.randomUUID(),
    provider: 'openai',
    model: input.model,
    inputCostPerMillionTokens: input.inputCostPerMillionTokens,
    outputCostPerMillionTokens: input.outputCostPerMillionTokens,
    cachedInputCostPerMillionTokens: input.cachedInputCostPerMillionTokens,
    reasoningCostPerMillionTokens: input.reasoningCostPerMillionTokens,
    currency: 'USD',
    sourceUrl: input.sourceUrl ?? source.url,
    sourceName: input.sourceName,
    sourceRetrievedAt: '2026-07-10T00:00:00.000Z',
    status: 'active',
    notes: input.notes,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}
