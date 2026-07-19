import { Marked, type RendererObject, type Tokens } from 'marked';

const renderer: RendererObject = {
  link(token: Tokens.Link): string {
    if (!isWebUrl(token.href)) {
      return renderExternalLink(this.parser.parseInline(token.tokens), token.href, token.title);
    }

    const label = token.text.trim() || readUrlDomain(token.href);
    return [
      '<a',
      ' class="source-citation"',
      ` href="${escapeHtml(token.href)}"`,
      '>',
      '<span class="source-citation__icon" aria-hidden="true"></span>',
      `<span class="source-citation__label">Source: ${escapeHtml(label)}</span>`,
      '</a>',
    ].join('');
  },
};
const markdown = new Marked({ renderer });

export function renderMarkdown(content: string): string {
  const html = markdown.parse(content, { async: false, breaks: true, gfm: true });

  return html.replace(/<a\b([^>]*)>/gi, (_match, attributes: string) => {
    const nextAttributes = String(attributes)
      .replace(/\s+target=(?:"[^"]*"|'[^']*'|[^\s>]*)/i, '')
      .replace(/\s+rel=(?:"[^"]*"|'[^']*'|[^\s>]*)/i, '');

    return `<a${nextAttributes} target="_blank" rel="noreferrer">`;
  });
}

function renderExternalLink(label: string, href: string, title?: string | null): string {
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';

  return `<a href="${escapeHtml(href)}"${titleAttribute}>${label}</a>`;
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function readUrlDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
