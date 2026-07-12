import { describe, expect, it } from 'vitest';

import { extractOpenAiHostedWebToolCalls } from './openai-hosted-web-search';

describe('extractOpenAiHostedWebToolCalls', () => {
  it('captures hosted search actions and final citations as run evidence', () => {
    const calls = extractOpenAiHostedWebToolCalls({
      content: [
        {
          type: 'text',
          text: 'Angular v22 is current.',
          annotations: [
            {
              type: 'citation',
              source: 'url_citation',
              url: 'https://angular.dev/reference/releases',
              title: 'Versioning and releases',
            },
          ],
        },
      ],
      additional_kwargs: {
        tool_outputs: [
          {
            id: 'ws-1',
            type: 'web_search_call',
            action: {
              type: 'search',
              queries: ['Angular current stable version'],
            },
          },
          {
            id: 'ws-2',
            type: 'web_search_call',
            action: {
              type: 'open_page',
              url: 'https://angular.dev/reference/releases',
            },
          },
        ],
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        id: 'ws-1',
        name: 'web_search',
        args: expect.objectContaining({ type: 'search' }),
      }),
    );
    expect(JSON.parse(calls[0]?.result ?? '{}')).toEqual(
      expect.objectContaining({
        answerSourceUrls: ['https://angular.dev/reference/releases'],
      }),
    );
  });
});
