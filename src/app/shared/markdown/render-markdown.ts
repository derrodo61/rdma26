import { marked } from 'marked';

export function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false, breaks: true, gfm: true });

  return html.replace(/<a\b([^>]*)>/gi, (_match, attributes: string) => {
    const nextAttributes = String(attributes)
      .replace(/\s+target=(?:"[^"]*"|'[^']*'|[^\s>]*)/i, '')
      .replace(/\s+rel=(?:"[^"]*"|'[^']*'|[^\s>]*)/i, '');

    return `<a${nextAttributes} target="_blank" rel="noreferrer">`;
  });
}
