import { describe, expect, it } from 'vitest';

import { resolveEffectiveCapabilities } from './model-capability-policy';

describe('resolveEffectiveCapabilities', () => {
  const granted = ['interpreter', 'read_web_page', 'web_search'];

  it('keeps hosted web search for OpenAI API model selections', () => {
    expect(resolveEffectiveCapabilities('gpt-5.4', granted)).toEqual({
      enabledCapabilityIds: granted,
      withheldCapabilities: [],
    });
  });

  it('withholds hosted web search from ChatGPT/Codex runs without changing other grants', () => {
    expect(resolveEffectiveCapabilities('chatgpt:gpt-5.4', granted)).toEqual({
      enabledCapabilityIds: ['interpreter', 'read_web_page'],
      withheldCapabilities: [
        {
          id: 'web_search',
          reason:
            'OpenAI hosted web search requires an OpenAI API model and was not included in this ChatGPT/Codex run.',
        },
      ],
    });
  });
});
