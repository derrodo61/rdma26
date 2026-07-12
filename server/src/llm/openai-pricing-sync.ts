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
  additionalModelPages: readonly { readonly model: string; readonly url: string }[] = [],
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
  const additionalPricing = await Promise.all(
    additionalModelPages.map(async ({ model, url }) => {
      const modelResponse = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });

      if (!modelResponse.ok) {
        throw new Error(`OpenAI model pricing source returned HTTP ${modelResponse.status}.`);
      }

      return extractOpenAiModelPagePricing(await modelResponse.text(), model, url);
    }),
  );

  return compareOpenAiModelPricing({
    source,
    savedPricing,
    officialPricing: [...extractOpenAiModelPricingFromHtml(html), ...additionalPricing],
    retrievedAt: fetchedAt,
  });
}

export function extractOpenAiModelPagePricing(
  html: string,
  model: string,
  sourceUrl: string,
): OpenAiOfficialPricingRecord {
  const $ = cheerio.load(html);
  const priceLabel = $('div')
    .toArray()
    .find((candidate) => {
      const directText = $(candidate).clone().children().remove().end().text().trim();
      return directText === 'Price';
    });
  const price = priceLabel ? parsePrice($(priceLabel).parent().text()) : undefined;

  if (price === undefined) {
    throw new Error(`Could not find the official token price for ${model}.`);
  }

  return {
    model,
    sourceLabel: model,
    sourceUrl,
    shortContext: {
      inputCostPerMillionTokens: price,
      outputCostPerMillionTokens: 0,
    },
  };
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
    const comparison = compareSavedPricing(saved, official, official?.sourceUrl ?? source.url);

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
  const missingLocalPricing = officialPricing.filter((record) => !savedModels.has(record.model));

  return {
    summary: [
      `${matched.length} saved active OpenAI pricing records match official short-context input, cached-input, and output prices.`,
      different.length
        ? `${different.length} saved records differ: ${different.map((item) => item.model).join(', ')}.`
        : 'No saved records differ on short-context price values.',
      missingOfficial.length
        ? `${missingOfficial.length} saved records were not found in the official table: ${missingOfficial.map((item) => item.model).join(', ')}.`
        : 'Every saved active OpenAI model was found in the official table.',
      missingLocalModels.length
        ? `${missingLocalModels.length} official models are missing locally: ${missingLocalModels.join(', ')}.`
        : 'No official models are missing locally.',
      'Use metadataWarnings for source metadata, cached-input, cache-write, and long-context schema gaps. No pricing records were changed.',
    ].join(' '),
    source: {
      id: source.id,
      name: source.name,
      url: source.url,
      retrievedAt,
    },
    officialModelCount: officialPricing.length,
    savedActiveModelCount: savedOpenAi.length,
    matchedModels: matched.map((comparison) => comparison.model),
    updatedModels: [],
    different,
    missingOfficialModels: missingOfficial.map((comparison) => comparison.model),
    missingLocalModels,
    missingLocalPricing,
    metadataWarnings: [...matched, ...different, ...missingOfficial]
      .map((comparison) => ({
        model: comparison.model,
        warnings: comparison.metadataWarnings,
      }))
      .filter((warning) => warning.warnings.length > 0),
    notes: [
      'Saved input, cached-input, and output prices are compared against official short-context prices.',
      'Official cached-input, cache-write, and long-context prices are reported as metadata because the local pricing schema does not fully represent every official dimension.',
      'This tool only compares records. It does not create, update, activate, deactivate, or delete pricing records.',
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
    optionalPriceDifference(
      'cachedInputCostPerMillionTokens',
      saved.cachedInputCostPerMillionTokens,
      official.shortContext.cachedInputCostPerMillionTokens,
    ),
  ].filter((difference): difference is string => Boolean(difference));

  const metadataWarnings = [
    ...sourceWarnings(saved, officialSourceUrl),
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
