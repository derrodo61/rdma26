import { describe, expect, it } from 'vitest';

import {
  extractReadableText,
  isBlockedHostAddress,
  parseTavilyExtractResult,
  readWebPage,
} from './tools/web-page-reader';

describe('web page reader helpers', () => {
  it('extracts readable text from HTML and removes scripts/styles', () => {
    const readable = extractReadableText(
      `
        <!doctype html>
        <html>
          <head>
            <title>Example &amp; Result</title>
            <style>.hidden { display: none; }</style>
            <script>window.secret = true;</script>
          </head>
          <body>
            <main>
              <h1>Final score</h1>
              <p>Example defeated Sample 2-1.</p>
            </main>
          </body>
        </html>
      `,
      'text/html; charset=utf-8',
    );

    expect(readable.title).toBe('Example & Result');
    expect(readable.text).toContain('Final score');
    expect(readable.text).toContain('Example defeated Sample 2-1.');
    expect(readable.text).not.toContain('window.secret');
    expect(readable.text).not.toContain('display: none');
  });

  it('normalizes plain text content', () => {
    const readable = extractReadableText('One&nbsp;two\n\n\nthree &amp; four', 'text/plain');

    expect(readable.text).toBe('One two\n\nthree & four');
  });

  it('prefers article content over page chrome', () => {
    const readable = extractReadableText(
      `
        <html>
          <head><title>Match report</title></head>
          <body>
            <nav>Home Scores Login Subscribe</nav>
            <main>
              <article>
                <h1>Switzerland send Colombia home</h1>
                <p>Switzerland advanced 4-3 on penalties after a goalless 120 minutes.</p>
              </article>
            </main>
            <footer>Privacy Terms Advertising</footer>
          </body>
        </html>
      `,
      'text/html',
    );

    expect(readable.text).toContain('Switzerland send Colombia home');
    expect(readable.text).toContain('Switzerland advanced 4-3 on penalties');
    expect(readable.text).not.toContain('Login Subscribe');
    expect(readable.text).not.toContain('Privacy Terms Advertising');
  });

  it('blocks private and local IP addresses', () => {
    expect(isBlockedHostAddress('127.0.0.1')).toBe(true);
    expect(isBlockedHostAddress('10.0.0.1')).toBe(true);
    expect(isBlockedHostAddress('172.16.0.1')).toBe(true);
    expect(isBlockedHostAddress('192.168.1.1')).toBe(true);
    expect(isBlockedHostAddress('169.254.1.1')).toBe(true);
    expect(isBlockedHostAddress('::1')).toBe(true);
    expect(isBlockedHostAddress('fc00::1')).toBe(true);
  });

  it('allows public IP addresses', () => {
    expect(isBlockedHostAddress('8.8.8.8')).toBe(false);
    expect(isBlockedHostAddress('1.1.1.1')).toBe(false);
    expect(isBlockedHostAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('parses Tavily Extract content', () => {
    const extracted = parseTavilyExtractResult(
      {
        results: [
          {
            url: 'https://example.com/match',
            raw_content: '# Match report\n\nArgentina won 3-2.',
          },
        ],
        failed_results: [],
      },
      'https://example.com/match',
    );

    expect(extracted).toEqual({
      url: 'https://example.com/match',
      text: '# Match report\n\nArgentina won 3-2.',
      warning: undefined,
    });
  });

  it('uses Tavily Extract when a provider is available', async () => {
    const result = await readWebPage('https://93.184.216.34/match', {
      tavilyExtract: async () => ({
        results: [
          {
            url: 'https://93.184.216.34/match',
            raw_content: 'Switzerland advanced 4-3 on penalties.',
          },
        ],
        failed_results: [],
      }),
    });

    expect(result).toMatchObject({
      url: 'https://93.184.216.34/match',
      finalUrl: 'https://93.184.216.34/match',
      text: 'Switzerland advanced 4-3 on penalties.',
      extractionProvider: 'tavily_extract',
    });
  });

  it('returns a warning instead of throwing when extraction and local fallback fail', async () => {
    const result = await readWebPage('https://93.184.216.34/match', {
      tavilyExtract: async () => ({
        error: 'HTTP 403 Forbidden',
      }),
      timeoutMs: 1,
    });

    expect(result).toMatchObject({
      url: 'https://93.184.216.34/match',
      finalUrl: 'https://93.184.216.34/match',
      text: '',
      extractionProvider: 'local_fetch',
    });
    expect(result.extractionWarning).toContain('Tavily Extract failed');
    expect(result.extractionWarning).toContain('Local fallback also failed');
  });
});
