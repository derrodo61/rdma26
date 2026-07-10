import { describe, expect, it } from 'vitest';

import { extractWebContentFromHtml } from './web-content-extractor';

describe('web content extractor', () => {
  it('uses a compact overview by default', async () => {
    const url = 'https://example.com/pricing';
    const extracted = extractWebContentFromHtml({
      url,
      finalUrl: url,
      contentType: 'text/html; charset=utf-8',
      truncated: false,
      fetchedAt: '2026-07-10T00:00:00.000Z',
      body: `
        <main>
          <h1>Pricing</h1>
          <p>Readable text.</p>
          <a href="/details">Details</a>
          <table><tr><th>Model</th></tr><tr><td>gpt-example</td></tr></table>
        </main>
      `,
    });

    expect(extracted.markdown).toBe('');
    expect(extracted.cleanHtml).toBe('');
    expect(extracted.text).toContain('Readable text');
    expect(extracted.headings).toHaveLength(1);
    expect(extracted.links).toHaveLength(1);
    expect(extracted.tables).toHaveLength(1);
  });

  it('extracts cleaned html, markdown, lists, links, and structured tables', async () => {
    const url = 'https://example.com/pricing';
    const extracted = extractWebContentFromHtml(
      {
        url,
        finalUrl: url,
        contentType: 'text/html; charset=utf-8',
        truncated: false,
        fetchedAt: '2026-07-10T00:00:00.000Z',
        body: `
      <!doctype html>
      <html>
        <head>
          <title>Pricing</title>
          <style>.x { color: red; }</style>
          <script>window.secret = true;</script>
        </head>
        <body>
          <nav>Navigation</nav>
          <main>
            <h1>Pricing</h1>
            <p>Prices are per 1M tokens.</p>
            <ul>
              <li>Standard tier</li>
              <li>Batch tier</li>
            </ul>
            <a href="/details">Details</a>
            <table>
              <caption>Model prices</caption>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Input</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>gpt-example</td>
                  <td>$1.00</td>
                  <td>$4.00</td>
                </tr>
              </tbody>
            </table>
          </main>
        </body>
      </html>
    `,
      },
      { mode: 'full' },
    );

    expect(extracted.title).toBe('Pricing');
    expect(extracted.cleanHtml).toContain('<h1>Pricing</h1>');
    expect(extracted.cleanHtml).not.toContain('window.secret');
    expect(extracted.markdown).toContain('# Pricing');
    expect(extracted.lists[0]).toMatchObject({
      type: 'unordered',
      items: ['Standard tier', 'Batch tier'],
    });
    expect(extracted.links[0]).toMatchObject({
      text: 'Details',
      url: 'https://example.com/details',
    });
    expect(extracted.tables[0]).toMatchObject({
      caption: 'Model prices',
      headers: ['Model', 'Input', 'Output'],
      rows: [
        {
          cells: ['gpt-example', '$1.00', '$4.00'],
          record: {
            Model: 'gpt-example',
            Input: '$1.00',
            Output: '$4.00',
          },
        },
      ],
    });
  });

  it('preserves row-spanned values in table records', async () => {
    const url = 'https://example.com/pricing';
    const extracted = extractWebContentFromHtml({
      url,
      finalUrl: url,
      contentType: 'text/html',
      truncated: false,
      fetchedAt: '2026-07-10T00:00:00.000Z',
      body: `
      <table>
        <tr><th>Category</th><th>Model</th><th>Input</th></tr>
        <tr><td rowspan="2">Flagship</td><td>gpt-a</td><td>$1.00</td></tr>
        <tr><td>gpt-b</td><td>$2.00</td></tr>
      </table>
    `,
    });

    expect(extracted.tables[0]?.rows[1]?.record).toEqual({
      Category: 'Flagship',
      Model: 'gpt-b',
      Input: '$2.00',
    });
  });

  it('filters table rows by query in table mode', async () => {
    const url = 'https://example.com/pricing';
    const extracted = extractWebContentFromHtml(
      {
        url,
        finalUrl: url,
        contentType: 'text/html',
        truncated: false,
        fetchedAt: '2026-07-10T00:00:00.000Z',
        body: `
        <main>
          <h1>Pricing</h1>
          <p>This page has prose that should not be returned in table mode.</p>
          <table>
            <tr><th>Model</th><th>Input</th><th>Output</th></tr>
            <tr><td>gpt-5.4</td><td>$2.50</td><td>$15.00</td></tr>
            <tr><td>gpt-5.5</td><td>$5.00</td><td>$30.00</td></tr>
            <tr><td>gpt-6.0</td><td>$10.00</td><td>$60.00</td></tr>
          </table>
        </main>
      `,
      },
      { mode: 'tables', query: 'gpt-5.4 gpt-5.5' },
    );

    expect(extracted.text).toBe('');
    expect(extracted.markdown).toBe('');
    expect(extracted.headings).toHaveLength(0);
    expect(extracted.tables[0]?.rows.map((row) => row.record?.['Model'])).toEqual([
      'gpt-5.4',
      'gpt-5.5',
    ]);
  });
});
