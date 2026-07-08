import { describe, expect, it } from 'vitest';

import { extractReadableText, isBlockedHostAddress } from './tools/web-page-reader';

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
});
