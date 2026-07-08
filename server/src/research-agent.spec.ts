import { describe, expect, it, vi } from 'vitest';

import { createResearchSubagents, researchResponseSchema } from './research-agent';
import type { SearchProvider } from './tools/search-provider';

const testUserProfile = {
  name: '',
  timeZone: 'Europe/Berlin',
  language: 'de',
  locale: 'de-DE',
  dateStyle: 'medium' as const,
  timeStyle: 'short' as const,
  theme: 'system' as const,
  agentSettings: {},
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
};

describe('research subagent capability', () => {
  it('creates a Deep Agents researcher subagent with search and page-reading tools', () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(),
    };

    const subagents = createResearchSubagents(searchProvider, testUserProfile);

    expect(subagents).toHaveLength(1);
    expect(subagents[0]?.name).toBe('researcher');
    expect(subagents[0]?.description).toContain('Researches external facts');
    expect(subagents[0]?.tools?.map((tool) => tool.name)).toEqual([
      'research_web_search',
      'research_read_web_page',
    ]);
    expect(subagents[0]?.responseFormat).toBeDefined();
  });

  it('validates the structured research result shape', () => {
    const result = researchResponseSchema.parse({
      status: 'verified',
      claimStatus: 'not_applicable',
      answer: 'Angular v22 was released on June 3, 2026.',
      answerSourceUrls: ['https://blog.angular.dev/angular-v22'],
      findings: [
        {
          item: 'Angular',
          values: {
            version: 'v22',
            release_date: 'June 3, 2026',
          },
          sourceUrls: ['https://blog.angular.dev/angular-v22'],
        },
      ],
      sources: [
        {
          url: 'https://blog.angular.dev/angular-v22',
          title: 'Announcing Angular v22',
        },
      ],
      searches: [
        {
          query: 'Angular latest stable release official',
          resultCount: 3,
        },
      ],
      temporalCandidates: [
        {
          label: 'Angular v22 release',
          date: '2026-06-03',
          sourceUrls: ['https://blog.angular.dev/angular-v22'],
        },
      ],
    });

    expect(result.unresolved).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.answerSourceUrls).toEqual(['https://blog.angular.dev/angular-v22']);
    expect(result.findings[0]?.values['version']).toBe('v22');
    expect(result.temporalCandidates[0]?.date).toBe('2026-06-03');
  });

  it('instructs the researcher to compare temporal candidates before claiming latest facts', () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(),
    };

    const subagents = createResearchSubagents(searchProvider, testUserProfile);
    const systemPrompt = (subagents[0] as unknown as { systemPrompt: string }).systemPrompt;

    expect(systemPrompt).toContain(
      'For "latest", "last", "current", "most recent", or "next" questions',
    );
    expect(systemPrompt).toContain('put them in temporalCandidates');
    expect(systemPrompt).toContain('compare their dates before naming anything as latest');
    expect(systemPrompt).toContain(
      'never return status "verified" if a dated candidate contradicts',
    );
  });

  it('instructs the researcher to handle reported claims without treating official silence as disproof', () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(),
    };

    const subagents = createResearchSubagents(searchProvider, testUserProfile);
    const systemPrompt = (subagents[0] as unknown as { systemPrompt: string }).systemPrompt;

    expect(systemPrompt).toContain('For claim-checking or rumor questions');
    expect(systemPrompt).toContain('do not treat silence in an official source as proof');
    expect(systemPrompt).toContain('use "reported" when reputable sources report a claim');
    expect(systemPrompt).toContain('use "false" only when reliable evidence directly contradicts');
  });

  it('gives the researcher current date context for relative-date questions', () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(),
    };

    const subagents = createResearchSubagents(searchProvider, testUserProfile);
    const systemPrompt = (subagents[0] as unknown as { systemPrompt: string }).systemPrompt;

    expect(systemPrompt).toContain('Current user date/time context');
    expect(systemPrompt).toContain('Time zone: Europe/Berlin');
    expect(systemPrompt).toContain('Resolve relative dates');
    expect(systemPrompt).toContain('Include the absolute date');
    expect(systemPrompt).toContain('Do not treat an older source as today');
  });

  it('instructs the researcher to use adaptive local-language search only when needed', () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(),
    };

    const subagents = createResearchSubagents(searchProvider, testUserProfile);
    const systemPrompt = (subagents[0] as unknown as { systemPrompt: string }).systemPrompt;

    expect(systemPrompt).toContain('Use an adaptive search strategy');
    expect(systemPrompt).toContain('stop early when read sources already provide strong');
    expect(systemPrompt).toContain('search in the likely local language');
    expect(systemPrompt).toContain(
      'do not run extra searches just to complete every possible strategy step',
    );
  });
});
