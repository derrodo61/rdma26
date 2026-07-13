import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as cheerio from 'cheerio';

type WebPageExtractionProvider = 'local_fetch';

interface WebPageReadResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly title?: string;
  readonly contentType?: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly fetchedAt: string;
  readonly extractionProvider: WebPageExtractionProvider;
  readonly extractionWarning?: string;
}

interface WebPageReaderOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxCharacters?: number;
  readonly maxRedirects?: number;
}

interface ReadBodyResult {
  readonly text: string;
  readonly truncated: boolean;
}

export interface WebPageFetchOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
}

export interface WebPageFetchResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly contentType?: string;
  readonly body: string;
  readonly truncated: boolean;
  readonly fetchedAt: string;
}

const defaultTimeoutMs = 10_000;
const defaultMaxBytes = 1_000_000;
const defaultMaxCharacters = 12_000;
const defaultMaxRedirects = 5;

export async function readWebPage(
  url: string,
  options: WebPageReaderOptions = {},
): Promise<WebPageReadResult> {
  let parsedUrl: URL;

  try {
    parsedUrl = await assertAllowedWebUrl(url);
  } catch (error) {
    return failedReadResult(
      url,
      'local_fetch',
      `Page URL could not be used. ${readErrorMessage(error)}`,
    );
  }

  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const maxCharacters = options.maxCharacters ?? defaultMaxCharacters;
  const maxRedirects = options.maxRedirects ?? defaultMaxRedirects;
  try {
    return await readWebPageLocally(parsedUrl.toString(), {
      timeoutMs,
      maxBytes,
      maxCharacters,
      maxRedirects,
    });
  } catch (error) {
    return failedReadResult(
      parsedUrl.toString(),
      'local_fetch',
      `Page could not be read. ${readErrorMessage(error)}`,
    );
  }
}

async function readWebPageLocally(
  url: string,
  options: Required<
    Pick<WebPageReaderOptions, 'timeoutMs' | 'maxBytes' | 'maxCharacters' | 'maxRedirects'>
  >,
): Promise<WebPageReadResult> {
  const fetched = await fetchWebPageBody(url, options);
  const readable = extractReadableText(fetched.body, fetched.contentType);
  const clipped = clipText(readable.text, options.maxCharacters);
  const warning = clipped.text
    ? undefined
    : 'No readable page text could be extracted. The page may be JavaScript-rendered or block extraction.';

  return {
    url,
    finalUrl: fetched.finalUrl,
    title: readable.title,
    contentType: fetched.contentType,
    text: clipped.text,
    truncated: fetched.truncated || clipped.truncated,
    fetchedAt: fetched.fetchedAt,
    extractionProvider: 'local_fetch',
    extractionWarning: warning,
  };
}

export async function fetchWebPageBody(
  url: string,
  options: WebPageFetchOptions = {},
): Promise<WebPageFetchResult> {
  const parsedUrl = await assertAllowedWebUrl(url);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const maxRedirects = options.maxRedirects ?? defaultMaxRedirects;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchWithSafeRedirects(
      parsedUrl.toString(),
      maxRedirects,
      controller.signal,
    );
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

    return {
      url: parsedUrl.toString(),
      finalUrl: response.url,
      contentType,
      body: body.text,
      truncated: body.truncated,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function failedReadResult(
  url: string,
  extractionProvider: WebPageExtractionProvider,
  extractionWarning: string,
): WebPageReadResult {
  return {
    url,
    finalUrl: url,
    contentType: undefined,
    text: '',
    truncated: false,
    fetchedAt: new Date().toISOString(),
    extractionProvider,
    extractionWarning,
  };
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

  const $ = cheerio.load(content);
  const title = normalizeWhitespace($('title').first().text());

  $(
    [
      'script',
      'style',
      'noscript',
      'svg',
      'canvas',
      'iframe',
      'nav',
      'footer',
      'form',
      'button',
      'input',
      'select',
      'textarea',
      '[aria-hidden="true"]',
      '[hidden]',
    ].join(','),
  ).remove();

  const candidates = $('article, main, [role="main"], .article, .post, .entry-content')
    .toArray()
    .map((element) => extractTextFromElement($, element))
    .filter((text) => text.length > 0)
    .sort((a, b) => b.length - a.length);
  const text = candidates[0] ?? extractTextFromElement($, $('body').get(0) ?? $.root().get(0));

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

function extractTextFromElement(
  $: cheerio.CheerioAPI,
  element: Parameters<cheerio.CheerioAPI>[0] | undefined,
): string {
  if (!element) {
    return '';
  }

  const clone = $(element).clone();

  clone.find('br').replaceWith('\n');
  clone
    .find('p, div, section, article, header, aside, li, h1, h2, h3, h4, h5, h6, tr')
    .append('\n');

  return normalizeWhitespace(clone.text());
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
