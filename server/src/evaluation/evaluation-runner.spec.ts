import { describe, expect, it } from 'vitest';

import { evaluateAssertions } from './evaluation-runner';

describe('evaluation assertions', () => {
  it('checks response text, sources, domains, and tool calls', () => {
    expect(
      evaluateAssertions(
        'Paris is the capital of France.',
        ['https://example.com/article', 'https://docs.angular.dev/reference'],
        ['web_search'],
        {
          containsAll: ['Paris'],
          containsAny: ['France', 'French'],
          excludesAll: ['Berlin'],
          minimumSources: 2,
          sourceDomainsAny: ['angular.dev'],
          requiredToolCalls: ['web_search'],
          forbiddenToolCalls: ['read_web_page'],
        },
      ),
    ).toEqual([]);
  });

  it('returns actionable failures for unmet assertions', () => {
    expect(
      evaluateAssertions('Berlin', [], ['read_web_page'], {
        containsAll: ['Paris'],
        minimumSources: 1,
        requiredToolCalls: ['web_search'],
        forbiddenToolCalls: ['read_web_page'],
      }),
    ).toEqual([
      'Response does not contain required text: Paris',
      'Expected at least 1 sources, received 0.',
      'Required tool was not called: web_search',
      'Forbidden tool was called: read_web_page',
    ]);
  });

  it('normalizes typographic punctuation in model responses', () => {
    expect(
      evaluateAssertions('You can’t know that in advance.', [], [], {
        containsAny: ["can't know", 'unknown'],
      }),
    ).toEqual([]);
  });
});
