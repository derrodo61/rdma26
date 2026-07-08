import { describe, expect, it, vi } from 'vitest';

import {
  verifyCurrentFacts,
  type AnalyzeFactsRequest,
  type AnalyzeFactsResult,
  type VerifyCurrentFactsDependencies,
} from './tools/current-facts-verifier';

describe('verifyCurrentFacts', () => {
  it('runs targeted follow-up searches until the requested facts are verified', async () => {
    const search = vi
      .fn<VerifyCurrentFactsDependencies['search']>()
      .mockResolvedValueOnce({
        results: [
          {
            url: 'https://example.test/final-day',
            title: 'Final day results',
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            url: 'https://example.test/switzerland-colombia',
            title: 'Switzerland vs Colombia result',
          },
        ],
      });
    const readPage = vi
      .fn<VerifyCurrentFactsDependencies['readPage']>()
      .mockResolvedValueOnce({
        url: 'https://example.test/final-day',
        finalUrl: 'https://example.test/final-day',
        title: 'Final day results',
        text: 'Argentina beat Egypt 3-2. Switzerland also advanced after penalties.',
        extractionProvider: 'local_fetch',
        truncated: false,
        fetchedAt: '2026-07-08T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        url: 'https://example.test/switzerland-colombia',
        finalUrl: 'https://example.test/switzerland-colombia',
        title: 'Switzerland vs Colombia result',
        text: 'Switzerland and Colombia finished 0-0. Switzerland won 4-3 on penalties.',
        extractionProvider: 'local_fetch',
        truncated: false,
        fetchedAt: '2026-07-08T00:00:00.000Z',
      });
    const analyze = vi
      .fn<VerifyCurrentFactsDependencies['analyze']>()
      .mockImplementation((request: AnalyzeFactsRequest) => {
        const hasSwitzerlandScore = request.sources.some((source) =>
          source.excerpt.includes('finished 0-0'),
        );

        if (!hasSwitzerlandScore) {
          const partialResult: AnalyzeFactsResult = {
            status: 'partial',
            answer: 'Argentina beat Egypt 3-2. Switzerland-Colombia is still unresolved.',
            findings: [
              {
                item: 'Argentina vs Egypt',
                values: {
                  final_score: 'Argentina 3-2 Egypt',
                },
                sourceUrls: ['https://example.test/final-day'],
              },
            ],
            unresolved: ['Switzerland vs Colombia final score'],
            followUpQueries: ['Switzerland Colombia final score penalties'],
            notes: [],
          };

          return Promise.resolve(partialResult);
        }

        const verifiedResult: AnalyzeFactsResult = {
          status: 'verified',
          answer:
            'The last two games were Argentina 3-2 Egypt and Switzerland 0-0 Colombia, with Switzerland winning 4-3 on penalties.',
          findings: [
            {
              item: 'Argentina vs Egypt',
              values: {
                final_score: 'Argentina 3-2 Egypt',
              },
              sourceUrls: ['https://example.test/final-day'],
            },
            {
              item: 'Switzerland vs Colombia',
              values: {
                final_score: '0-0',
                shootout: 'Switzerland won 4-3 on penalties',
              },
              sourceUrls: ['https://example.test/switzerland-colombia'],
            },
          ],
          unresolved: [],
          followUpQueries: [],
          notes: [],
        };

        return Promise.resolve(verifiedResult);
      });
    const planSearchQueries = vi
      .fn<VerifyCurrentFactsDependencies['planSearchQueries']>()
      .mockResolvedValue(['FIFA World Cup 2026 latest completed matches results']);

    const result = await verifyCurrentFacts(
      {
        question: 'What were the last two games and their results?',
        requiredItems: 2,
        requiredFields: ['teams', 'final_score', 'winner'],
      },
      {
        planSearchQueries,
        search,
        readPage,
        analyze,
      },
    );

    expect(result.status).toBe('verified');
    expect(result.answer).toContain('Switzerland 0-0 Colombia');
    expect(result.searches.map((searchRun) => searchRun.query)).toEqual([
      'FIFA World Cup 2026 latest completed matches results',
      'Switzerland Colombia final score penalties',
    ]);
    expect(planSearchQueries).toHaveBeenCalledWith({
      question: 'What were the last two games and their results?',
      requiredItems: 2,
      requiredFields: ['teams', 'final_score', 'winner'],
      currentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(readPage).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('falls back to compact search queries instead of only using the raw question', async () => {
    const search = vi.fn<VerifyCurrentFactsDependencies['search']>().mockResolvedValue({
      results: [],
    });

    await verifyCurrentFacts(
      {
        question:
          'Hi Ronaldo, welches waren die letzten 2 Spiele in der aktuellen Fussball-Weltmeisterschaft und wie gingen sie aus?',
        requiredItems: 2,
        maxSearches: 1,
      },
      {
        planSearchQueries: async () => [],
        search,
        readPage: async () => {
          throw new Error('No source pages should be read for empty search results.');
        },
        analyze: async () => ({
          status: 'unresolved',
          answer: '',
          findings: [],
          unresolved: ['No sources found.'],
          followUpQueries: [],
          notes: [],
        }),
      },
    );

    expect(search).toHaveBeenCalledWith({
      question: expect.stringContaining('latest completed results'),
      topic: 'news',
    });
    expect(search.mock.calls[0]?.[0].question).not.toContain('? latest verified current facts');
  });

  it('returns partial results without guessing when follow-up searches run out', async () => {
    const result = await verifyCurrentFacts(
      {
        question: 'What is the current result?',
        maxSearches: 1,
      },
      {
        planSearchQueries: async () => ['current event result official'],
        search: async () => ({
          results: [
            {
              url: 'https://example.test/live',
              title: 'Live report',
            },
          ],
        }),
        readPage: async () => ({
          url: 'https://example.test/live',
          finalUrl: 'https://example.test/live',
          title: 'Live report',
          text: 'The event is ongoing.',
          extractionProvider: 'local_fetch',
          truncated: false,
          fetchedAt: '2026-07-08T00:00:00.000Z',
        }),
        analyze: async () => ({
          status: 'partial',
          answer: 'The event is ongoing, but the final result is not verified.',
          findings: [],
          unresolved: ['Final result'],
          followUpQueries: ['final result official'],
          notes: ['No final result in the available source.'],
        }),
      },
    );

    expect(result.status).toBe('partial');
    expect(result.unresolved).toEqual(['Final result']);
    expect(result.searches).toHaveLength(1);
  });

  it('filters clearly off-topic source pages before verification', async () => {
    const analyze = vi.fn<VerifyCurrentFactsDependencies['analyze']>().mockResolvedValue({
      status: 'verified',
      answer: 'Angular v22 was released on June 3, 2026.',
      findings: [
        {
          item: 'Angular',
          values: {
            version: 'v22',
            release_date: 'June 3, 2026',
          },
          sourceUrls: ['https://blog.angular.dev/announcing-angular-v22'],
        },
      ],
      unresolved: [],
      followUpQueries: [],
      notes: [],
    });

    const result = await verifyCurrentFacts(
      {
        question: 'What is the current stable Angular version and release date?',
        maxSearches: 1,
        requiredFields: ['version', 'release_date'],
      },
      {
        planSearchQueries: async () => ['Angular latest stable version official release date'],
        search: async () => ({
          results: [
            {
              url: 'https://example.test/android-update',
              title: 'Android update released',
            },
            {
              url: 'https://blog.angular.dev/announcing-angular-v22',
              title: 'Announcing Angular v22',
            },
          ],
        }),
        readPage: async (url) => ({
          url,
          finalUrl: url,
          title: url.includes('android') ? 'Android update released' : 'Announcing Angular v22',
          text: url.includes('android')
            ? 'Google released a Pixel update for Android devices.'
            : 'Angular v22 was released on June 3, 2026.',
          extractionProvider: 'local_fetch',
          truncated: false,
          fetchedAt: '2026-07-08T00:00:00.000Z',
        }),
        analyze,
      },
    );

    expect(result.status).toBe('verified');
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [
          expect.objectContaining({
            url: 'https://blog.angular.dev/announcing-angular-v22',
          }),
        ],
      }),
    );
  });
});
