import { describe, expect, it } from 'vitest';

import { buildSearchQualityHints, withSearchQualityHints } from './tools/search-quality';

describe('search quality hints', () => {
  it('flags result sets dominated by previews as needing follow-up', () => {
    const hints = buildSearchQualityHints(
      [
        {
          title: 'How to watch Example vs Sample: TV channel and live stream',
          content: 'The teams will face each other tomorrow. Preview and odds.',
          published_date: new Date().toUTCString(),
        },
        {
          title: 'Example vs Sample prediction and odds',
          content: 'Prediction for the upcoming match.',
          published_date: new Date().toUTCString(),
        },
      ],
      {
        query: 'Example Sample final result',
        maxResults: 5,
        topic: 'news',
        includeRawContent: false,
      },
    );

    expect(hints.likelyNeedsFollowUp).toBe(true);
    expect(hints.previewOrScheduleCount).toBe(2);
    expect(hints.directAnswerCount).toBe(0);
    expect(hints.reasons).toContain('No result clearly looks like a direct answer.');
    expect(hints.suggestedFollowUpQueries.length).toBeGreaterThan(0);
  });

  it('accepts recent direct-answer result sets without follow-up', () => {
    const hints = buildSearchQualityHints(
      [
        {
          title: 'Example confirms final result after vote',
          content: 'Officials announced the final result and confirmed the answer today.',
          published_date: new Date().toUTCString(),
        },
        {
          title: 'Analysis: What the confirmed result means',
          content: 'The result was confirmed by two sources.',
          published_date: new Date().toUTCString(),
        },
      ],
      {
        query: 'Example final result',
        maxResults: 5,
        topic: 'news',
        includeRawContent: false,
      },
    );

    expect(hints.likelyNeedsFollowUp).toBe(false);
    expect(hints.directAnswerCount).toBe(2);
    expect(hints.suggestedFollowUpQueries).toEqual([]);
  });

  it('adds quality hints to JSON string search payloads', () => {
    const wrapped = withSearchQualityHints(
      JSON.stringify({
        query: 'Example final result',
        results: [
          {
            title: 'Example confirms final result',
            content: 'Officials confirmed the result today.',
            published_date: new Date().toUTCString(),
          },
        ],
      }),
      {
        query: 'Example final result',
        maxResults: 5,
        topic: 'news',
        includeRawContent: false,
      },
    );

    expect(wrapped).toMatchObject({
      query: 'Example final result',
      qualityHints: {
        directAnswerCount: 1,
        likelyNeedsFollowUp: false,
      },
    });
  });

  it('does not treat live-score snippets as final-result evidence by default', () => {
    const hints = buildSearchQualityHints(
      [
        {
          title: 'Example vs Sample live score and updates',
          content: 'Follow live score updates and match commentary.',
          published_date: new Date().toUTCString(),
        },
      ],
      {
        query: 'Example Sample final result',
        maxResults: 5,
        topic: 'news',
        includeRawContent: false,
      },
    );

    expect(hints.directAnswerCount).toBe(0);
    expect(hints.liveUpdateCount).toBe(1);
    expect(hints.likelyNeedsFollowUp).toBe(true);
  });
});
