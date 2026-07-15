import { renderMarkdown } from './render-markdown';

describe('renderMarkdown', () => {
  it('adds safe external-link attributes and replaces existing target and rel values', () => {
    const rendered = renderMarkdown(
      '<a href="https://example.com" target="_self" rel="opener">Example</a>',
    );

    expect(rendered).toContain('href="https://example.com"');
    expect(rendered).toContain('target="_blank"');
    expect(rendered).toContain('rel="noreferrer"');
    expect(rendered).not.toContain('target="_self"');
    expect(rendered).not.toContain('rel="opener"');
  });
});
