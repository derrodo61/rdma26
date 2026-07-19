import { describe, expect, it } from 'vitest';

import { normalizeAssistantText } from './agent-result';

describe('normalizeAssistantText', () => {
  it('removes duplicated raw URLs after equivalent markdown citations', () => {
    expect(
      normalizeAssistantText(
        'England won ([apnews.com](https://apnews.com/article/test?utm_source=openai))(https://apnews.com/article/test).',
      ),
    ).toBe('England won ([apnews.com](https://apnews.com/article/test?utm_source=openai)).');
  });

  it('keeps adjacent links when the URLs are different', () => {
    const text = 'See [first](https://example.com/one)(https://example.com/two) for comparison.';

    expect(normalizeAssistantText(text)).toBe(text);
  });
});
