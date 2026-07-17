import { describe, expect, it } from 'vitest';

import {
  extractOpenAiHostedWebToolCalls,
  extractOpenAiHostedWebToolCallsFromAgentResult,
} from './openai-hosted-web-search';

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

  it('keeps provider-reported search candidates separate from answer citations', () => {
    const calls = extractOpenAiHostedWebToolCalls({
      content: [{ type: 'text', text: 'The final result was 3-1.' }],
      additional_kwargs: {
        tool_outputs: [
          {
            id: 'ws-1',
            type: 'web_search_call',
            action: {
              type: 'search',
              queries: ['latest completed match'],
              sources: [
                { type: 'url', url: 'https://www.fifa.com/match-report' },
                { type: 'url', url: 'https://apnews.com/match-report' },
              ],
            },
          },
        ],
      },
    });

    expect(JSON.parse(calls[0]?.result ?? '{}')).toEqual(
      expect.objectContaining({
        answerSourceUrls: [],
        sources: [
          { url: 'https://www.fifa.com/match-report' },
          { url: 'https://apnews.com/match-report' },
        ],
      }),
    );
  });

  it('associates citations from a later result message with earlier search actions', () => {
    const calls = extractOpenAiHostedWebToolCallsFromAgentResult({
      messages: [
        {
          content: [],
          additional_kwargs: {
            tool_outputs: [
              {
                id: 'ws-1',
                type: 'web_search_call',
                action: { type: 'search', queries: ['Angular release'] },
              },
            ],
          },
        },
        {
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
        },
      ],
    });

    expect(JSON.parse(calls[0]?.result ?? '{}')).toEqual(
      expect.objectContaining({
        answerSourceUrls: ['https://angular.dev/reference/releases'],
      }),
    );
  });

  it('does not copy citations or search actions from an earlier conversation turn', () => {
    const calls = extractOpenAiHostedWebToolCallsFromAgentResult({
      messages: [
        {
          role: 'assistant',
          content: [
            {
              annotations: [
                {
                  type: 'citation',
                  source: 'url_citation',
                  url: 'https://example.com/previous-turn',
                },
              ],
            },
          ],
          additional_kwargs: {
            tool_outputs: [{ id: 'ws-old', type: 'web_search_call', action: { type: 'search' } }],
          },
        },
        { role: 'user', content: 'That is wrong. Try again.' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'France against Germany.' }],
          additional_kwargs: {
            tool_outputs: [{ id: 'ws-new', type: 'web_search_call', action: { type: 'search' } }],
          },
        },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe('ws-new');
    expect(JSON.parse(calls[0]?.result ?? '{}').answerSourceUrls).toEqual([]);
  });
});
