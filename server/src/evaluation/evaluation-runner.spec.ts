import { describe, expect, it } from 'vitest';

import { evaluateAssertions } from './evaluation-runner';

describe('evaluation assertions', () => {
  it('checks response text, sources, domains, and tool calls', () => {
    expect(
      evaluateAssertions(
        'Paris is the capital of France.',
        ['https://example.com/article', 'https://docs.angular.dev/reference'],
        ['task'],
        {
          containsAll: ['Paris'],
          containsAny: ['France', 'French'],
          excludesAll: ['Berlin'],
          minimumSources: 2,
          sourceDomainsAny: ['angular.dev'],
          requiredToolCalls: ['task'],
          forbiddenToolCalls: ['internet_search'],
        },
      ),
    ).toEqual([]);
  });

  it('returns actionable failures for unmet assertions', () => {
    expect(
      evaluateAssertions('Berlin', [], ['internet_search'], {
        containsAll: ['Paris'],
        minimumSources: 1,
        requiredToolCalls: ['task'],
        forbiddenToolCalls: ['internet_search'],
      }),
    ).toEqual([
      'Response does not contain required text: Paris',
      'Expected at least 1 sources, received 0.',
      'Required tool was not called: task',
      'Forbidden tool was called: internet_search',
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
