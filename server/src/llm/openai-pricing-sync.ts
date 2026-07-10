import * as cheerio from 'cheerio';

import type {
  ModelPricingRecord,
  OpenAiOfficialPricingRecord,
  OpenAiPricingComparison,
  PricingSourceRecord,
  SyncOpenAiModelPricingResult,
} from '../../../shared/agent-contracts';

export async function syncOpenAiModelPricingFromSource(
  source: PricingSourceRecord,
  savedPricing: readonly ModelPricingRecord[],
): Promise<SyncOpenAiModelPricingResult> {
  const fetchedAt = new Date().toISOString();
  const response = await fetch(source.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`OpenAI pricing source returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  return compareOpenAiModelPricing({
    source,
    savedPricing,
    officialPricing: extractOpenAiModelPricingFromHtml(html),
    retrievedAt: fetchedAt,
  });
}

export function extractOpenAiModelPricingFromHtml(
  html: string,
): readonly OpenAiOfficialPricingRecord[] {
  const $ = cheerio.load(html);
  const table = $('table')
    .toArray()
    .find((candidate) => {
      const headers = $(candidate).find('tr').slice(0, 2).text().replace(/\s+/g, ' ').toLowerCase();

      return (
        headers.includes('model') &&
        headers.includes('short context') &&
        headers.includes('long context') &&
        headers.includes('cached input') &&
        headers.includes('cache writes')
      );
    });

  if (!table) {
    throw new Error('Could not find the OpenAI text-token pricing table.');
  }

  return $(table)
    .find('tr')
    .toArray()
    .map((row) =>
      $(row)
        .find('th,td')
        .toArray()
        .map((cell) => normalizeWhitespace($(cell).text())),
    )
    .filter((cells) => cells.length >= 5 && looksLikeModelId(cells[0] ?? ''))
    .map((cells) => cellsToOfficialPricingRecord(cells));
}

export function compareOpenAiModelPricing({
  source,
  savedPricing,
  officialPricing,
  retrievedAt,
}: {
  readonly source: PricingSourceRecord;
  readonly savedPricing: readonly ModelPricingRecord[];
  readonly officialPricing: readonly OpenAiOfficialPricingRecord[];
  readonly retrievedAt: string;
}): SyncOpenAiModelPricingResult {
  const officialByModel = new Map(officialPricing.map((record) => [record.model, record]));
  const savedOpenAi = savedPricing.filter((record) => record.provider === 'openai');
  const matched: OpenAiPricingComparison[] = [];
  const different: OpenAiPricingComparison[] = [];
  const missingOfficial: OpenAiPricingComparison[] = [];

  for (const saved of savedOpenAi) {
    const official = officialByModel.get(saved.model);
    const comparison = compareSavedPricing(saved, official, source.url);

    if (comparison.status === 'match') {
      matched.push(comparison);
    } else if (comparison.status === 'different') {
      different.push(comparison);
    } else {
      missingOfficial.push(comparison);
    }
  }

  const savedModels = new Set(savedOpenAi.map((record) => record.model));
  const missingLocalModels = officialPricing
    .map((record) => record.model)
    .filter((model) => !savedModels.has(model));

  return {
    source: {
      id: source.id,
      name: source.name,
      url: source.url,
      retrievedAt,
    },
    officialModelCount: officialPricing.length,
    savedActiveModelCount: savedOpenAi.length,
    matched,
    different,
    missingOfficial,
    missingLocalModels,
    notes: [
      'Saved flat input/output prices are compared against official standard short-context input/output prices.',
      'Official cached-input, cache-write, and long-context prices are reported as metadata because the local pricing schema does not fully represent every official dimension.',
      'This tool only compares records. It does not create, activate, supersede, or delete pricing records.',
    ],
  };
}

function cellsToOfficialPricingRecord(cells: readonly string[]): OpenAiOfficialPricingRecord {
  const sourceLabel = cells[0] ?? '';
  const model = normalizeModelId(sourceLabel);
  const [shortInput, shortCachedInput, shortCacheWrite, shortOutput] = cells
    .slice(1, 5)
    .map(parsePrice);
  const [longInput, longCachedInput, longCacheWrite, longOutput] = cells
    .slice(5, 9)
    .map(parsePrice);
  const longContext =
    longInput === undefined &&
    longCachedInput === undefined &&
    longCacheWrite === undefined &&
    longOutput === undefined
      ? undefined
      : {
          inputCostPerMillionTokens: longInput,
          cachedInputCostPerMillionTokens: longCachedInput,
          cacheWriteCostPerMillionTokens: longCacheWrite,
          outputCostPerMillionTokens: longOutput,
        };

  return {
    model,
    sourceLabel,
    shortContext: {
      inputCostPerMillionTokens: shortInput,
      cachedInputCostPerMillionTokens: shortCachedInput,
      cacheWriteCostPerMillionTokens: shortCacheWrite,
      outputCostPerMillionTokens: shortOutput,
    },
    longContext,
  };
}

function compareSavedPricing(
  saved: ModelPricingRecord,
  official: OpenAiOfficialPricingRecord | undefined,
  officialSourceUrl: string,
): OpenAiPricingComparison {
  const savedSnapshot = {
    pricingId: saved.id,
    inputCostPerMillionTokens: saved.inputCostPerMillionTokens,
    cachedInputCostPerMillionTokens: saved.cachedInputCostPerMillionTokens,
    outputCostPerMillionTokens: saved.outputCostPerMillionTokens,
    sourceUrl: saved.sourceUrl,
    sourceName: saved.sourceName,
  };

  if (!official) {
    return {
      model: saved.model,
      status: 'missing_official',
      saved: savedSnapshot,
      differences: ['No official row was found for this saved model id.'],
      metadataWarnings: sourceWarnings(saved, officialSourceUrl),
    };
  }

  const differences = [
    priceDifference(
      'inputCostPerMillionTokens',
      saved.inputCostPerMillionTokens,
      official.shortContext.inputCostPerMillionTokens,
    ),
    priceDifference(
      'outputCostPerMillionTokens',
      saved.outputCostPerMillionTokens,
      official.shortContext.outputCostPerMillionTokens,
    ),
    saved.cachedInputCostPerMillionTokens === undefined
      ? undefined
      : optionalPriceDifference(
          'cachedInputCostPerMillionTokens',
          saved.cachedInputCostPerMillionTokens,
          official.shortContext.cachedInputCostPerMillionTokens,
        ),
  ].filter((difference): difference is string => Boolean(difference));

  const metadataWarnings = [
    ...sourceWarnings(saved, officialSourceUrl),
    saved.cachedInputCostPerMillionTokens === undefined &&
    official.shortContext.cachedInputCostPerMillionTokens !== undefined
      ? `Official short-context cached-input pricing exists (${official.shortContext.cachedInputCostPerMillionTokens}) but is missing locally.`
      : undefined,
    official.shortContext.cacheWriteCostPerMillionTokens !== undefined
      ? 'Official short-context cache-write pricing exists but is not represented in the local flat pricing schema.'
      : undefined,
    official.longContext !== undefined
      ? 'Official long-context pricing exists but is not represented in the local flat pricing schema.'
      : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    model: saved.model,
    status: differences.length ? 'different' : 'match',
    saved: savedSnapshot,
    official,
    differences,
    metadataWarnings,
  };
}

function priceDifference(
  field: string,
  saved: number,
  official: number | undefined,
): string | undefined {
  if (official === undefined) {
    return `${field}: official price is missing.`;
  }

  return samePrice(saved, official) ? undefined : `${field}: saved ${saved}, official ${official}.`;
}

function optionalPriceDifference(
  field: string,
  saved: number | undefined,
  official: number | undefined,
): string | undefined {
  if (saved === undefined && official === undefined) {
    return undefined;
  }

  if (saved === undefined) {
    return `${field}: saved missing, official ${official}.`;
  }

  if (official === undefined) {
    return `${field}: saved ${saved}, official missing.`;
  }

  return samePrice(saved, official) ? undefined : `${field}: saved ${saved}, official ${official}.`;
}

function sourceWarnings(saved: ModelPricingRecord, officialSourceUrl: string): readonly string[] {
  return normalizeUrl(saved.sourceUrl) === normalizeUrl(officialSourceUrl)
    ? []
    : [`Saved source URL is not the configured official OpenAI pricing source: ${saved.sourceUrl}`];
}

function parsePrice(value: string | undefined): number | undefined {
  if (!value || value === '-' || value.toLowerCase() === 'null') {
    return undefined;
  }

  const match = value.match(/[\d.]+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeModelId(value: string): string {
  return value.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function looksLikeModelId(value: string): boolean {
  return /^(gpt|o\d|davinci|babbage)/i.test(value.trim());
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function samePrice(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000_001;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';

  return url.toString().replace(/\/$/, '');
}
