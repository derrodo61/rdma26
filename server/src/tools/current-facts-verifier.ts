import { ChatOpenAI } from '@langchain/openai';

import type { SearchProvider, SearchTopic } from './search-provider';
import { readWebPage, type WebPageReadResult } from './web-page-reader';

export interface VerifyCurrentFactsRequest {
  readonly question: string;
  readonly requiredItems?: number;
  readonly requiredFields?: readonly string[];
  readonly topic?: SearchTopic;
  readonly maxSearches?: number;
  readonly maxSources?: number;
}

export interface VerifiedFactsResult {
  readonly status: 'verified' | 'partial' | 'unresolved';
  readonly answer: string;
  readonly findings: readonly VerifiedFactFinding[];
  readonly unresolved: readonly string[];
  readonly sources: readonly VerifiedFactSource[];
  readonly searches: readonly VerifiedFactSearch[];
  readonly notes: readonly string[];
}

export interface VerifiedFactFinding {
  readonly item: string;
  readonly values: Readonly<Record<string, string>>;
  readonly sourceUrls: readonly string[];
}

export interface VerifiedFactSource {
  readonly url: string;
  readonly title?: string;
  readonly extractionProvider?: string;
  readonly extractionWarning?: string;
  readonly excerpt: string;
}

export interface VerifiedFactSearch {
  readonly query: string;
  readonly resultCount: number;
}

export interface VerifyCurrentFactsDependencies {
  readonly planSearchQueries: (request: PlanSearchQueriesRequest) => Promise<readonly string[]>;
  readonly search: (
    request: Required<Pick<VerifyCurrentFactsRequest, 'question' | 'topic'>>,
  ) => Promise<SearchPayload>;
  readonly readPage: (url: string, query: string) => Promise<WebPageReadResult>;
  readonly analyze: (request: AnalyzeFactsRequest) => Promise<AnalyzeFactsResult>;
}

export interface PlanSearchQueriesRequest {
  readonly question: string;
  readonly requiredItems?: number;
  readonly requiredFields: readonly string[];
  readonly currentDate: string;
}

export interface SearchPayload {
  readonly results: readonly SearchResult[];
}

export interface SearchResult {
  readonly url: string;
  readonly title?: string;
  readonly content?: string;
  readonly publishedDate?: string;
}

export interface AnalyzeFactsRequest {
  readonly question: string;
  readonly requiredItems?: number;
  readonly requiredFields: readonly string[];
  readonly sources: readonly VerifiedFactSource[];
  readonly previousUnresolved: readonly string[];
}

export interface AnalyzeFactsResult {
  readonly status: 'verified' | 'partial' | 'unresolved';
  readonly answer: string;
  readonly findings: readonly VerifiedFactFinding[];
  readonly unresolved: readonly string[];
  readonly followUpQueries: readonly string[];
  readonly notes: readonly string[];
}

const defaultRequiredFields = ['answer'];

export async function verifyCurrentFacts(
  request: VerifyCurrentFactsRequest,
  dependencies: VerifyCurrentFactsDependencies,
): Promise<VerifiedFactsResult> {
  const maxSearches = request.maxSearches ?? 4;
  const maxSources = request.maxSources ?? 6;
  const requiredFields = request.requiredFields?.length
    ? request.requiredFields
    : defaultRequiredFields;
  const topic = request.topic ?? 'news';
  const currentDate = new Date().toISOString().slice(0, 10);
  const plannedQueries = await dependencies.planSearchQueries({
    question: request.question,
    requiredItems: request.requiredItems,
    requiredFields,
    currentDate,
  });
  const pendingQueries = normalizeQueries(
    plannedQueries.length ? plannedQueries : buildFallbackQueries(request.question, currentDate),
  );
  const searchedQueries = new Set<string>();
  const readUrls = new Set<string>();
  const searches: VerifiedFactSearch[] = [];
  const sources: VerifiedFactSource[] = [];
  let latestAnalysis: AnalyzeFactsResult = {
    status: 'unresolved',
    answer: '',
    findings: [],
    unresolved: ['No searches have been run yet.'],
    followUpQueries: [],
    notes: [],
  };

  while (searchedQueries.size < maxSearches && pendingQueries.length) {
    const query = pendingQueries.shift()?.trim();

    if (!query || searchedQueries.has(query)) {
      continue;
    }

    searchedQueries.add(query);
    const searchPayload = await dependencies.search({
      question: query,
      topic,
    });
    searches.push({
      query,
      resultCount: searchPayload.results.length,
    });

    for (const result of searchPayload.results) {
      if (sources.length >= maxSources || readUrls.has(result.url)) {
        continue;
      }

      readUrls.add(result.url);
      const page = await dependencies.readPage(result.url, request.question);
      sources.push(toVerifiedFactSource(result, page));
    }

    latestAnalysis = await dependencies.analyze({
      question: request.question,
      requiredItems: request.requiredItems,
      requiredFields,
      sources,
      previousUnresolved: latestAnalysis.unresolved,
    });

    if (latestAnalysis.status === 'verified') {
      break;
    }

    for (const followUpQuery of latestAnalysis.followUpQueries) {
      const normalized = followUpQuery.trim();

      if (normalized && !searchedQueries.has(normalized)) {
        pendingQueries.unshift(normalized);
      }
    }
  }

  return {
    status: latestAnalysis.status,
    answer: latestAnalysis.answer,
    findings: latestAnalysis.findings,
    unresolved: latestAnalysis.unresolved,
    sources,
    searches,
    notes: latestAnalysis.notes,
  };
}

export function createVerifyCurrentFactsDependencies(
  searchProvider: SearchProvider,
): VerifyCurrentFactsDependencies {
  return {
    planSearchQueries: planSearchQueriesWithOpenAI,
    search: async ({ question, topic }) =>
      parseSearchPayload(
        await searchProvider.search({
          query: question,
          maxResults: 5,
          topic,
          includeRawContent: false,
        }),
      ),
    readPage: async (url, query) => await readWebPage(url, { query, maxCharacters: 12_000 }),
    analyze: analyzeFactsWithOpenAI,
  };
}

async function planSearchQueriesWithOpenAI(
  request: PlanSearchQueriesRequest,
): Promise<readonly string[]> {
  const apiKey = process.env['OPENAI_API_KEY'];

  if (!apiKey) {
    return [];
  }

  const model = new ChatOpenAI({
    apiKey,
    model: process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini',
    temperature: 0,
  });
  const result = await model.invoke([
    {
      role: 'system',
      content: [
        'You convert user questions into concise web search queries.',
        'Return only valid JSON. Do not wrap the JSON in Markdown.',
        'Do not answer the question.',
        'Do not copy the whole conversational question as a search query.',
        'Create keyword-style, source-seeking queries that a search engine can match well.',
        'For latest, last, current, newest, recent, top-N, or result questions, include words such as latest completed, results, schedule, standings, official, date, or year when useful.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        schema: {
          queries: [
            'compact search query with entities, event/year, requested answer type, and date context',
          ],
        },
        currentDate: request.currentDate,
        question: request.question,
        requiredItems: request.requiredItems,
        requiredFields: request.requiredFields,
        maxQueries: 4,
      }),
    },
  ]);

  return parseSearchQueryPlan(readModelText(result));
}

async function analyzeFactsWithOpenAI(request: AnalyzeFactsRequest): Promise<AnalyzeFactsResult> {
  const apiKey = process.env['OPENAI_API_KEY'];

  if (!apiKey) {
    return {
      status: 'unresolved',
      answer: '',
      findings: [],
      unresolved: ['OPENAI_API_KEY is not configured for fact verification analysis.'],
      followUpQueries: [],
      notes: [],
    };
  }

  const model = new ChatOpenAI({
    apiKey,
    model: process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini',
    temperature: 0,
  });
  const result = await model.invoke([
    {
      role: 'system',
      content: [
        'You are a strict current-fact verification engine.',
        'Answer only valid JSON. Do not wrap the JSON in Markdown.',
        'Use only the supplied source excerpts.',
        'If a requested item or concrete value is missing, mark status as partial or unresolved and propose targeted follow-up queries.',
        'For latest, last, current, newest, recent, or top-N questions, status may be verified only when the supplied sources prove both the requested facts and the ordering/recency.',
        'For latest completed events or matches, identify candidate events, exclude previews/schedules/upcoming events, rank completed candidates by date/time when available, and choose the most recent requested count.',
        'If sources prove completed events but do not prove they are the latest requested events, mark status as partial and propose a search query for latest completed results or schedule.',
        'Never ask the user whether to continue. The caller will run follow-up searches when needed.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        schema: {
          status: 'verified | partial | unresolved',
          answer: 'concise answer string',
          findings: [
            {
              item: 'name of verified item',
              values: { field: 'verified value' },
              sourceUrls: ['source URL'],
            },
          ],
          unresolved: ['missing concrete value or item'],
          followUpQueries: ['targeted search query for missing evidence'],
          notes: ['brief caveats about evidence quality'],
        },
        question: request.question,
        requiredItems: request.requiredItems,
        requiredFields: request.requiredFields,
        previousUnresolved: request.previousUnresolved,
        sources: request.sources,
      }),
    },
  ]);

  return parseAnalysisResult(readModelText(result));
}

function toVerifiedFactSource(
  searchResult: SearchResult,
  page: WebPageReadResult,
): VerifiedFactSource {
  return {
    url: page.finalUrl || searchResult.url,
    title: page.title ?? searchResult.title,
    extractionProvider: page.extractionProvider,
    extractionWarning: page.extractionWarning,
    excerpt: clipSourceText(page.text || searchResult.content || '', 3_000),
  };
}

function parseSearchPayload(rawResult: unknown): SearchPayload {
  const payload = typeof rawResult === 'string' ? parseJson(rawResult) : rawResult;

  if (!isSearchPayloadLike(payload)) {
    return { results: [] };
  }

  const results: SearchResult[] = [];

  for (const result of payload.results ?? []) {
    if (!result.url) {
      continue;
    }

    results.push({
      url: result.url,
      title: result.title,
      content: result.content,
      publishedDate: result.published_date,
    });
  }

  return {
    results,
  };
}

function parseAnalysisResult(text: string): AnalyzeFactsResult {
  const parsed = parseJson(
    text
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim(),
  );

  if (!isAnalyzeFactsResultLike(parsed)) {
    return {
      status: 'unresolved',
      answer: '',
      findings: [],
      unresolved: ['The verifier model returned an invalid analysis response.'],
      followUpQueries: [],
      notes: [clipSourceText(text, 1_000)],
    };
  }

  return {
    status: parsed.status,
    answer: parsed.answer,
    findings: parsed.findings,
    unresolved: parsed.unresolved,
    followUpQueries: parsed.followUpQueries,
    notes: parsed.notes,
  };
}

function parseSearchQueryPlan(text: string): readonly string[] {
  const parsed = parseJson(
    text
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim(),
  );

  if (!isSearchQueryPlanLike(parsed)) {
    return [];
  }

  return normalizeQueries(parsed.queries);
}

function isSearchQueryPlanLike(value: unknown): value is { readonly queries: readonly string[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { readonly queries?: unknown }).queries) &&
    (value as { readonly queries: readonly unknown[] }).queries.every(
      (query) => typeof query === 'string',
    )
  );
}

function isSearchPayloadLike(value: unknown): value is {
  readonly results?: readonly {
    readonly url?: string;
    readonly title?: string;
    readonly content?: string;
    readonly published_date?: string;
  }[];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (!('results' in value) || Array.isArray((value as { readonly results?: unknown }).results))
  );
}

function isAnalyzeFactsResultLike(value: unknown): value is AnalyzeFactsResult {
  const candidate = value as AnalyzeFactsResult;

  return (
    typeof value === 'object' &&
    value !== null &&
    ['verified', 'partial', 'unresolved'].includes(candidate.status) &&
    typeof candidate.answer === 'string' &&
    Array.isArray(candidate.findings) &&
    Array.isArray(candidate.unresolved) &&
    Array.isArray(candidate.followUpQueries) &&
    Array.isArray(candidate.notes)
  );
}

function readModelText(result: unknown): string {
  const content = (result as { readonly content?: unknown }).content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? part.text : ''))
      .filter((part): part is string => typeof part === 'string')
      .join('\n');
  }

  return '';
}

function buildFallbackQueries(question: string, currentDate: string): readonly string[] {
  const normalized = question
    .replace(/[?!.:,;"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  return [
    `${normalized} latest completed results ${currentDate}`,
    `${normalized} official results schedule ${currentDate.slice(0, 4)}`,
  ];
}

function normalizeQueries(queries: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const query of queries) {
    const candidate = query.replace(/\s+/g, ' ').trim();
    const key = candidate.toLowerCase();

    if (!candidate || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(candidate);
  }

  return normalized;
}

function clipSourceText(text: string, maxCharacters: number): string {
  const normalized = text.trim();

  return normalized.length <= maxCharacters
    ? normalized
    : `${normalized.slice(0, maxCharacters).trimEnd()}...`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
