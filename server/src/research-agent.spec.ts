import { describe, expect, it, vi } from 'vitest';

import { createResearchSubagents, researchResponseSchema } from './research-agent';
import type { SearchProvider } from './tools/search-provider';

describe('research subagent capability', () => {
  it('creates a Deep Agents researcher subagent with search and page-reading tools', () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(),
    };

    const subagents = createResearchSubagents(searchProvider);

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
      answer: 'Angular v22 was released on June 3, 2026.',
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
    });

    expect(result.unresolved).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.findings[0]?.values['version']).toBe('v22');
  });
});
