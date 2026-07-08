import { describe, expect, it, vi } from 'vitest';

import { ResearchAgent } from './research-agent';
import type { VerifyCurrentFactsDependencies } from './tools/current-facts-verifier';

describe('ResearchAgent', () => {
  it('uses the quick factual workflow for auto research requests', async () => {
    const dependencies: VerifyCurrentFactsDependencies = {
      planSearchQueries: vi.fn().mockResolvedValue(['Angular latest release official blog']),
      search: vi.fn().mockResolvedValue({
        results: [
          {
            url: 'https://blog.angular.dev/angular-v22',
            title: 'Announcing Angular v22',
          },
        ],
      }),
      readPage: vi.fn().mockResolvedValue({
        url: 'https://blog.angular.dev/angular-v22',
        finalUrl: 'https://blog.angular.dev/angular-v22',
        title: 'Announcing Angular v22',
        text: 'Angular v22 was released on June 3, 2026.',
        extractionProvider: 'local_fetch',
        truncated: false,
        fetchedAt: '2026-07-08T00:00:00.000Z',
      }),
      analyze: vi.fn().mockResolvedValue({
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
        unresolved: [],
        followUpQueries: [],
        notes: [],
      }),
    };

    const result = await new ResearchAgent({
      verifyCurrentFactsDependencies: dependencies,
    }).research({
      question: 'What is the latest Angular version and release date?',
      mode: 'auto',
      topic: 'general',
      requiredFields: ['version', 'release_date'],
    });

    expect(result.status).toBe('verified');
    expect(result.modeUsed).toBe('quick');
    expect(result.answer).toContain('Angular v22');
    expect(result.sources).toEqual([
      expect.objectContaining({
        url: 'https://blog.angular.dev/angular-v22',
        title: 'Announcing Angular v22',
      }),
    ]);
    expect(dependencies.planSearchQueries).toHaveBeenCalledWith({
      question: 'What is the latest Angular version and release date?',
      requiredItems: undefined,
      requiredFields: ['version', 'release_date'],
      currentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('reports deep mode as unavailable in the first implementation', async () => {
    const result = await new ResearchAgent().research({
      question: 'Write a market report.',
      mode: 'deep',
      expectedOutput: 'report',
    });

    expect(result.status).toBe('unresolved');
    expect(result.modeUsed).toBe('deep');
    expect(result.unresolved).toContain('Deep research mode is not implemented yet.');
    expect(result.sources).toEqual([]);
  });
});
