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

  it('renders web citations as compact source buttons with safe details', () => {
    const rendered = renderMarkdown(
      '[FIFA match report](https://www.fifa.com/final?team=Spain&stage=final)',
    );

    expect(rendered).toContain('class="source-citation"');
    expect(rendered).toContain('class="source-citation__icon"');
    expect(rendered).not.toContain('<svg');
    expect(rendered).toContain('Source: FIFA match report');
    expect(rendered).toContain('href="https://www.fifa.com/final?team=Spain&amp;stage=final"');
    expect(rendered).not.toContain('>FIFA match report</a>');
  });

  it('keeps non-web markdown links as links', () => {
    const rendered = renderMarkdown('[Email](mailto:hello@example.com)');

    expect(rendered).toContain('href="mailto:hello@example.com"');
    expect(rendered).not.toContain('source-citation');
  });
});
