import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface WebPageReadResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly title?: string;
  readonly contentType?: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly fetchedAt: string;
}

export interface WebPageReaderOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxCharacters?: number;
  readonly maxRedirects?: number;
}

interface ReadBodyResult {
  readonly text: string;
  readonly truncated: boolean;
}

const defaultTimeoutMs = 10_000;
const defaultMaxBytes = 1_000_000;
const defaultMaxCharacters = 12_000;
const defaultMaxRedirects = 5;

export async function readWebPage(
  url: string,
  options: WebPageReaderOptions = {},
): Promise<WebPageReadResult> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const maxCharacters = options.maxCharacters ?? defaultMaxCharacters;
  const maxRedirects = options.maxRedirects ?? defaultMaxRedirects;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchWithSafeRedirects(url, maxRedirects, controller.signal);
    const contentType = response.headers.get('content-type') ?? undefined;

    if (!isReadableContentType(contentType)) {
      throw new Error(
        `Unsupported content type${contentType ? `: ${contentType}` : ''}. Only readable text and HTML pages are supported.`,
      );
    }

    const contentLength = response.headers.get('content-length');

    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error(`Page is too large to read safely. Limit is ${maxBytes} bytes.`);
    }

    const body = await readResponseBody(response, maxBytes);
    const readable = extractReadableText(body.text, contentType);
    const clipped = clipText(readable.text, maxCharacters);

    return {
      url,
      finalUrl: response.url,
      title: readable.title,
      contentType,
      text: clipped.text,
      truncated: body.truncated || clipped.truncated,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertAllowedWebUrl(url: string): Promise<URL> {
  const parsed = parseWebUrl(url);
  const hostname = parsed.hostname.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('Localhost URLs are not allowed.');
  }

  if (isBlockedHostAddress(hostname)) {
    throw new Error('Private or local network URLs are not allowed.');
  }

  if (!isIP(hostname)) {
    const addresses = await lookup(hostname, { all: true });
    const blockedAddress = addresses.find((address) => isBlockedHostAddress(address.address));

    if (blockedAddress) {
      throw new Error('Private or local network URLs are not allowed.');
    }
  }

  return parsed;
}

export function extractReadableText(
  content: string,
  contentType: string | undefined,
): { readonly title?: string; readonly text: string } {
  if (!contentType?.toLowerCase().includes('html')) {
    return {
      text: normalizeWhitespace(decodeHtmlEntities(content)),
    };
  }

  const title = decodeHtmlEntities(
    content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '',
  ).trim();
  const withoutNoise = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|header|footer|main|aside|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = normalizeWhitespace(decodeHtmlEntities(withoutNoise));

  return {
    title: title || undefined,
    text,
  };
}

export function isBlockedHostAddress(value: string): boolean {
  const ipVersion = isIP(value);

  if (ipVersion === 4) {
    return isBlockedIpv4(value);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6(value);
  }

  return false;
}

async function fetchWithSafeRedirects(
  initialUrl: string,
  maxRedirects: number,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = (await assertAllowedWebUrl(initialUrl)).toString();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers: {
        accept: 'text/html,text/plain,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
        'user-agent': 'rdma26 web_page_reader',
      },
      redirect: 'manual',
      signal,
    });

    if (!isRedirectStatus(response.status)) {
      if (!response.ok) {
        throw new Error(`Page request failed with HTTP ${response.status}.`);
      }

      return response;
    }

    const location = response.headers.get('location');

    if (!location) {
      throw new Error(`Redirect response ${response.status} did not include a Location header.`);
    }

    currentUrl = (await assertAllowedWebUrl(new URL(location, currentUrl).toString())).toString();
  }

  throw new Error(`Too many redirects. Limit is ${maxRedirects}.`);
}

async function readResponseBody(response: Response, maxBytes: number): Promise<ReadBodyResult> {
  if (!response.body) {
    return {
      text: '',
      truncated: false,
    };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    totalBytes += chunk.byteLength;

    if (totalBytes > maxBytes) {
      const remainingBytes = maxBytes - (totalBytes - chunk.byteLength);

      if (remainingBytes > 0) {
        chunks.push(chunk.slice(0, remainingBytes));
      }

      truncated = true;
      break;
    }

    chunks.push(chunk);
  }

  return {
    text: Buffer.concat(chunks).toString('utf8'),
    truncated,
  };
}

function parseWebUrl(url: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL is invalid.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }

  return parsed;
}

function isReadableContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();

  return (
    normalized.startsWith('text/') ||
    normalized.includes('html') ||
    normalized.includes('xml') ||
    normalized.includes('json')
  );
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function isBlockedIpv4(value: string): boolean {
  const [a = 0, b = 0] = value.split('.').map((part) => Number.parseInt(part, 10));

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase();

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  );
}

function clipText(
  text: string,
  maxCharacters: number,
): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maxCharacters) {
    return {
      text,
      truncated: false,
    };
  }

  return {
    text: text.slice(0, maxCharacters).trimEnd(),
    truncated: true,
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}
