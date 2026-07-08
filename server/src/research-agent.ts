import { tool, toolStrategy } from 'langchain';
import type { SubAgent } from 'deepagents';
import { z } from 'zod/v3';

import type { SearchProvider, SearchTopic } from './tools/search-provider';
import { readWebPage } from './tools/web-page-reader';

export type ResearchMode = 'auto' | 'deep';
export type ResearchExpectedOutput = 'answer' | 'structured_facts' | 'report';
export type ResearchStatus = 'verified' | 'partial' | 'unresolved';
export type ResearchClaimStatus =
  'confirmed' | 'reported' | 'disputed' | 'unsupported' | 'false' | 'unclear' | 'not_applicable';

export interface ResearchFinding {
  readonly item: string;
  readonly values: Record<string, string>;
  readonly sourceUrls: readonly string[];
}

export interface ResearchSource {
  readonly url: string;
  readonly title?: string;
  readonly excerpt?: string;
  readonly extractionProvider?: string;
  readonly extractionWarning?: string;
}

export interface ResearchSearch {
  readonly query: string;
  readonly resultCount: number;
}

export interface ResearchTemporalCandidate {
  readonly label: string;
  readonly date: string;
  readonly sourceUrls: readonly string[];
  readonly notes?: string;
}

export interface ResearchResult {
  readonly status: ResearchStatus;
  readonly claimStatus?: ResearchClaimStatus;
  readonly answer: string;
  readonly findings: readonly ResearchFinding[];
  readonly unresolved: readonly string[];
  readonly sources: readonly ResearchSource[];
  readonly searches: readonly ResearchSearch[];
  readonly temporalCandidates: readonly ResearchTemporalCandidate[];
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

interface SearchResultItem {
  readonly title?: string;
  readonly url?: string;
  readonly content?: string;
  readonly raw_content?: string;
  readonly score?: number;
  readonly published_date?: string;
}

interface SearchPayload {
  readonly results?: readonly SearchResultItem[];
}

const researchFindingSchema = z.object({
  item: z.string(),
  values: z.record(z.string()).default({}),
  sourceUrls: z.array(z.string()).default([]),
});

const researchSourceSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
  extractionProvider: z.string().optional(),
  extractionWarning: z.string().optional(),
});

const researchSearchSchema = z.object({
  query: z.string(),
  resultCount: z.number(),
});

const researchTemporalCandidateSchema = z.object({
  label: z.string(),
  date: z.string(),
  sourceUrls: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const researchResponseSchema = z.object({
  status: z.enum(['verified', 'partial', 'unresolved']),
  claimStatus: z
    .enum([
      'confirmed',
      'reported',
      'disputed',
      'unsupported',
      'false',
      'unclear',
      'not_applicable',
    ])
    .optional(),
  answer: z.string().default(''),
  findings: z.array(researchFindingSchema).default([]),
  unresolved: z.array(z.string()).default([]),
  sources: z.array(researchSourceSchema).default([]),
  searches: z.array(researchSearchSchema).default([]),
  temporalCandidates: z.array(researchTemporalCandidateSchema).default([]),
  warnings: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export function createResearchSubagents(searchProvider: SearchProvider): readonly SubAgent[] {
  return [
    {
      name: 'researcher',
      description:
        'Researches external facts with web search and source reading, then returns structured findings with source URLs.',
      systemPrompt: createResearcherPrompt(),
      tools: createResearcherTools(searchProvider),
      responseFormat: toolStrategy(researchResponseSchema),
    },
  ];
}

function createResearcherTools(searchProvider: SearchProvider) {
  const searchTool = tool(
    async ({
      query,
      maxResults = 5,
      topic = 'general',
    }: {
      query: string;
      maxResults?: number;
      topic?: SearchTopic;
    }) => {
      const rawResult = await searchProvider.search({
        query,
        maxResults: clampInteger(maxResults, 1, 10),
        topic,
        includeRawContent: false,
      });
      const results = parseSearchResults(rawResult);
      const compactResults = results.map((result) => ({
        title: result.title,
        url: result.url,
        content: clipText(result.content ?? result.raw_content ?? '', 700),
        score: result.score,
        publishedDate: result.published_date,
      }));

      return {
        query,
        resultCount: compactResults.length,
        results: compactResults,
      };
    },
    {
      name: 'research_web_search',
      description:
        'Search the public web for candidate sources. Use short, keyword-rich search queries instead of full conversational prompts.',
      schema: z.object({
        query: z.string().describe('A concise web search query.'),
        maxResults: z.number().min(1).max(10).optional().default(5),
        topic: z.enum(['general', 'news', 'finance']).optional().default('general'),
      }),
    },
  );

  const readTool = tool(
    async ({ url, query }: { url: string; query?: string }) => {
      const page = await readWebPage(url, {
        query,
        maxCharacters: 14_000,
      });

      return {
        url: page.finalUrl || page.url,
        title: page.title,
        excerpt: clipText(page.text, 900),
        extractionProvider: page.extractionProvider,
        extractionWarning: page.extractionWarning,
        text: clipText(page.text, 5_000),
        truncated: page.truncated,
      };
    },
    {
      name: 'research_read_web_page',
      description:
        'Read a candidate source page and extract readable text. Use it before trusting search snippets for final facts.',
      schema: z.object({
        url: z.string().url().describe('The public HTTP or HTTPS source URL to read.'),
        query: z.string().optional().describe('Optional extraction focus based on the question.'),
      }),
    },
  );

  return [searchTool, readTool];
}

function createResearcherPrompt(): string {
  return `You are an internal internet research subagent for rdma26.

Goal:
- Answer the delegated question from current external sources.
- Use concise search queries, read source pages, compare evidence, and return a source-backed structured result.

Rules:
- Do not answer from memory.
- Translate the user's natural-language request into one or more search queries that a search engine can answer well.
- Prefer primary, official, authoritative, or directly relevant sources when possible.
- Match source type to the question. Use official sources for official records; use reputable reporting to evaluate allegations, controversy, or what people reportedly did.
- Search snippets are leads, not final evidence. Read pages before relying on exact dates, scores, versions, prices, rankings, statuses, or other concrete values.
- If sources conflict, search or read again. If still unresolved, report partial/unresolved instead of guessing.
- For lists, return every requested item if evidence allows. If an item is missing, put it in unresolved.
- For "latest", "last", "current", "most recent", or "next" questions:
  - collect all dated candidate events/items that may answer the question;
  - put them in temporalCandidates with source URLs;
  - compare their dates before naming anything as latest/last/current/next;
  - never return status "verified" if a dated candidate contradicts your chosen answer.
- For claim-checking or rumor questions:
  - separate official facts, reputable media reports, social posts, denials/corrections, and missing evidence;
  - do not treat silence in an official source as proof that a media-reported allegation is false;
  - use claimStatus: confirmed, reported, disputed, unsupported, false, or unclear;
  - use "reported" when reputable sources report a claim but no primary/official source confirms it;
  - use "unsupported" only when targeted searches find no credible supporting source;
  - use "false" only when reliable evidence directly contradicts the claim.
- Add warnings for stale sources, ambiguous wording, source conflicts, official-source silence, or any date ordering uncertainty.
- If warnings affect the main answer, set status to partial or unresolved instead of verified.
- Keep the final answer in the user's language.
- Include only sources actually used to support the answer.

Return the structured result required by the schema.`;
}

function parseSearchResults(rawResult: unknown): readonly SearchResultItem[] {
  const payload = typeof rawResult === 'string' ? parseJson(rawResult) : rawResult;

  if (!isSearchPayload(payload) || !payload.results) {
    return [];
  }

  return payload.results.filter((result): result is SearchResultItem => isRecord(result));
}

function isSearchPayload(value: unknown): value is SearchPayload {
  return isRecord(value) && (value['results'] === undefined || Array.isArray(value['results']));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function clipText(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text;
  }

  return `${text.slice(0, maxCharacters).trimEnd()}...`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
