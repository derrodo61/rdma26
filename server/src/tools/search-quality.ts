import type { SearchRequest } from './search-provider';

export type SearchResultKind =
  'direct_answer' | 'preview_or_schedule' | 'live_update' | 'analysis_or_recap' | 'unknown';

export interface SearchQualityHints {
  readonly resultCount: number;
  readonly directAnswerCount: number;
  readonly previewOrScheduleCount: number;
  readonly liveUpdateCount: number;
  readonly analysisOrRecapCount: number;
  readonly hasRecentSources: boolean;
  readonly likelyNeedsFollowUp: boolean;
  readonly reasons: readonly string[];
  readonly suggestedFollowUpQueries: readonly string[];
  readonly results: readonly SearchResultQuality[];
}

export interface SearchResultQuality {
  readonly index: number;
  readonly kind: SearchResultKind;
  readonly title?: string;
  readonly url?: string;
  readonly publishedDate?: string;
  readonly reasons: readonly string[];
}

interface SearchResultLike {
  readonly title?: string;
  readonly url?: string;
  readonly content?: string;
  readonly published_date?: string;
}

interface SearchPayloadLike {
  readonly results?: readonly SearchResultLike[];
}

export function withSearchQualityHints(
  rawResult: unknown,
  request: Required<SearchRequest>,
): unknown {
  const payload = parseSearchPayload(rawResult);

  if (!isSearchPayloadLike(payload)) {
    return {
      rawResult,
      qualityHints: buildSearchQualityHints([], request),
    };
  }

  return {
    ...payload,
    qualityHints: buildSearchQualityHints(payload.results ?? [], request),
  };
}

export function buildSearchQualityHints(
  results: readonly SearchResultLike[],
  request: Required<SearchRequest>,
): SearchQualityHints {
  const resultHints = results.map((result, index) => classifySearchResult(result, index));
  const directAnswerCount = countKind(resultHints, 'direct_answer');
  const previewOrScheduleCount = countKind(resultHints, 'preview_or_schedule');
  const liveUpdateCount = countKind(resultHints, 'live_update');
  const analysisOrRecapCount = countKind(resultHints, 'analysis_or_recap');
  const hasRecentSources = resultHints.some((result) =>
    isRecentPublishedDate(result.publishedDate),
  );
  const reasons = buildSearchSetReasons({
    resultCount: results.length,
    directAnswerCount,
    previewOrScheduleCount,
    liveUpdateCount,
    hasRecentSources,
  });
  const likelyNeedsFollowUp = reasons.length > 0;

  return {
    resultCount: results.length,
    directAnswerCount,
    previewOrScheduleCount,
    liveUpdateCount,
    analysisOrRecapCount,
    hasRecentSources,
    likelyNeedsFollowUp,
    reasons,
    suggestedFollowUpQueries: likelyNeedsFollowUp
      ? buildSuggestedFollowUpQueries(request.query)
      : [],
    results: resultHints,
  };
}

function classifySearchResult(result: SearchResultLike, index: number): SearchResultQuality {
  const text = normalizeText([result.title, result.content, result.url].filter(Boolean).join(' '));
  const reasons: string[] = [];

  if (hasAny(text, previewOrScheduleMarkers)) {
    reasons.push('Looks like a preview, schedule, odds, or watch/live-stream page.');
  }

  if (hasAny(text, liveUpdateMarkers)) {
    reasons.push('Looks like a live update or live score page.');
  }

  if (hasAny(text, directAnswerMarkers)) {
    reasons.push('Contains language that often indicates a direct answer or completed result.');
  }

  if (hasAny(text, analysisOrRecapMarkers)) {
    reasons.push('Looks like analysis, highlights, recap, or reaction coverage.');
  }

  return {
    index,
    kind: chooseKind(text),
    title: result.title,
    url: result.url,
    publishedDate: result.published_date,
    reasons,
  };
}

function chooseKind(text: string): SearchResultKind {
  const directScore = markerScore(text, directAnswerMarkers);
  const previewScore = markerScore(text, previewOrScheduleMarkers);
  const liveScore = markerScore(text, liveUpdateMarkers);
  const analysisScore = markerScore(text, analysisOrRecapMarkers);

  if (directScore > 0 && directScore >= previewScore && directScore >= liveScore) {
    return 'direct_answer';
  }

  if (previewScore > 0) {
    return 'preview_or_schedule';
  }

  if (liveScore > 0) {
    return 'live_update';
  }

  if (analysisScore > 0) {
    return 'analysis_or_recap';
  }

  return 'unknown';
}

function buildSearchSetReasons({
  resultCount,
  directAnswerCount,
  previewOrScheduleCount,
  liveUpdateCount,
  hasRecentSources,
}: {
  readonly resultCount: number;
  readonly directAnswerCount: number;
  readonly previewOrScheduleCount: number;
  readonly liveUpdateCount: number;
  readonly hasRecentSources: boolean;
}): string[] {
  const reasons: string[] = [];

  if (!resultCount) {
    reasons.push('No search results were returned.');
  }

  if (resultCount > 0 && directAnswerCount === 0) {
    reasons.push('No result clearly looks like a direct answer.');
  }

  if (previewOrScheduleCount > directAnswerCount) {
    reasons.push('More results look like previews or schedules than direct answers.');
  }

  if (liveUpdateCount > 0 && directAnswerCount === 0) {
    reasons.push('Live-update pages may not contain a final answer yet.');
  }

  if (resultCount > 0 && !hasRecentSources) {
    reasons.push('No result has a clearly recent published date.');
  }

  return reasons;
}

function buildSuggestedFollowUpQueries(query: string): readonly string[] {
  const cleanQuery = query.trim().replace(/\s+/g, ' ');

  if (!cleanQuery) {
    return [];
  }

  return [
    `${cleanQuery} official latest answer`,
    `${cleanQuery} final result confirmed`,
    `${cleanQuery} recent source published today`,
  ];
}

function isSearchPayloadLike(value: unknown): value is SearchPayloadLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    (!('results' in value) || Array.isArray((value as { readonly results?: unknown }).results))
  );
}

function parseSearchPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function countKind(results: readonly SearchResultQuality[], kind: SearchResultKind): number {
  return results.filter((result) => result.kind === kind).length;
}

function markerScore(text: string, markers: readonly string[]): number {
  return markers.reduce((score, marker) => score + (text.includes(marker) ? 1 : 0), 0);
}

function hasAny(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function isRecentPublishedDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const ageMs = Date.now() - date.getTime();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 14;

  return ageMs >= 0 && ageMs <= maxAgeMs;
}

const directAnswerMarkers = [
  'announced',
  'after extra time',
  'after penalties',
  'beat',
  'beats',
  'confirmed',
  'defeat',
  'defeated',
  'eliminated',
  'eliminates',
  'final score',
  'final result',
  'final results',
  'full time',
  'full-time',
  'wins',
  'won',
];

const previewOrScheduleMarkers = [
  'fixture',
  'fixtures',
  'how to watch',
  'line-up',
  'line-ups',
  'odds',
  'prediction',
  'preview',
  'schedule',
  'scheduled',
  'stream',
  'tv channel',
  'upcoming',
  'watch',
  'where to watch',
  'will face',
];

const liveUpdateMarkers = ['live', 'live score', 'live updates', 'updates will start'];

const analysisOrRecapMarkers = [
  'analysis',
  'highlights',
  'instant reaction',
  'recap',
  'roundup',
  'takeaways',
];
