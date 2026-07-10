import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

import { extractReadableText, fetchWebPageBody, type WebPageFetchResult } from './web-page-reader';

export type WebContentExtractionMode =
  'overview' | 'markdown' | 'article' | 'headings' | 'links' | 'lists' | 'tables' | 'full';

export interface WebContentExtractionOptions {
  readonly mode?: WebContentExtractionMode;
  readonly query?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxCharacters?: number;
  readonly maxHtmlCharacters?: number;
  readonly maxTables?: number;
  readonly maxRowsPerTable?: number;
  readonly maxLists?: number;
  readonly maxItemsPerList?: number;
}

export interface ExtractedHeading {
  readonly level: number;
  readonly text: string;
}

export interface ExtractedLink {
  readonly text: string;
  readonly url: string;
}

export interface ExtractedList {
  readonly index: number;
  readonly type: 'ordered' | 'unordered';
  readonly items: readonly string[];
  readonly truncated: boolean;
}

export interface ExtractedTable {
  readonly index: number;
  readonly caption?: string;
  readonly headers: readonly string[];
  readonly rows: readonly ExtractedTableRow[];
  readonly truncated: boolean;
}

export interface ExtractedTableRow {
  readonly cells: readonly string[];
  readonly record?: Record<string, string>;
}

export interface WebContentExtractionResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly title?: string;
  readonly contentType?: string;
  readonly markdown: string;
  readonly cleanHtml: string;
  readonly text: string;
  readonly headings: readonly ExtractedHeading[];
  readonly links: readonly ExtractedLink[];
  readonly lists: readonly ExtractedList[];
  readonly tables: readonly ExtractedTable[];
  readonly truncated: boolean;
  readonly fetchedAt: string;
  readonly extractionProvider: 'local_html';
  readonly extractionWarning?: string;
}

interface Cell {
  readonly text: string;
  readonly header: boolean;
  readonly colspan: number;
  readonly rowspan: number;
}

interface GridCell {
  readonly text: string;
  readonly header: boolean;
}

const defaultMaxCharacters = 24_000;
const defaultFullMaxHtmlCharacters = 24_000;
const defaultMaxTables = 20;
const defaultMaxRowsPerTable = 80;
const defaultMaxLists = 30;
const defaultMaxItemsPerList = 80;

export async function extractWebContent(
  url: string,
  options: WebContentExtractionOptions = {},
): Promise<WebContentExtractionResult> {
  const fetched = await fetchWebPageBody(url, {
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
  });

  return extractWebContentFromHtml(fetched, options);
}

export function extractWebContentFromHtml(
  fetched: WebPageFetchResult,
  options: WebContentExtractionOptions = {},
): WebContentExtractionResult {
  const mode = options.mode ?? 'overview';
  const query = normalizeQuery(options.query);
  const contentType = fetched.contentType;
  const readable = extractReadableText(fetched.body, contentType);

  if (!contentType?.toLowerCase().includes('html')) {
    const text = clipText(readable.text, options.maxCharacters ?? defaultMaxCharacters);

    return {
      url: fetched.url,
      finalUrl: fetched.finalUrl,
      contentType,
      markdown: text.text,
      cleanHtml: '',
      text: text.text,
      headings: [],
      links: [],
      lists: [],
      tables: [],
      truncated: fetched.truncated || text.truncated,
      fetchedAt: fetched.fetchedAt,
      extractionProvider: 'local_html',
      extractionWarning: 'The response was not HTML, so only normalized text was returned.',
    };
  }

  const $ = cheerio.load(fetched.body);
  const title = normalizeWhitespace($('title').first().text()) || readable.title;
  const body = $('body').first();
  const source = body.length ? body : $.root();

  removeNoisyElements($);

  const sourceHtml = $.html(source) ?? '';
  const includeHtml = mode === 'full';
  const includeMarkdown = mode === 'full' || mode === 'markdown' || mode === 'article';
  const includeText = mode === 'full' || mode === 'overview' || mode === 'article';
  const includeHeadings = mode === 'full' || mode === 'overview' || mode === 'headings';
  const includeLinks = mode === 'full' || mode === 'overview' || mode === 'links';
  const includeLists = mode === 'full' || mode === 'overview' || mode === 'lists';
  const includeTables = mode === 'full' || mode === 'overview' || mode === 'tables';
  const cleanHtml = includeHtml
    ? clipText(sourceHtml, options.maxHtmlCharacters ?? defaultFullMaxHtmlCharacters)
    : { text: '', truncated: false };
  const markdown = clipText(
    includeMarkdown ? htmlToMarkdown(sourceHtml) : '',
    options.maxCharacters ?? defaultMaxCharacters,
  );
  const text = clipText(
    includeText ? readable.text : '',
    options.maxCharacters ?? defaultMaxCharacters,
  );
  const tables = includeTables ? filterTables(extractTables($, options), query) : [];
  const lists = includeLists ? filterLists(extractLists($, options), query) : [];
  const links = includeLinks ? filterLinks(extractLinks($, fetched.finalUrl), query) : [];
  const headings = includeHeadings ? filterHeadings(extractHeadings($), query) : [];

  return {
    url: fetched.url,
    finalUrl: fetched.finalUrl,
    title,
    contentType,
    markdown: markdown.text,
    cleanHtml: cleanHtml.text,
    text: text.text,
    headings,
    links,
    lists,
    tables,
    truncated: fetched.truncated || cleanHtml.truncated || markdown.truncated || text.truncated,
    fetchedAt: fetched.fetchedAt,
    extractionProvider: 'local_html',
    extractionWarning:
      tables.length || lists.length || links.length || headings.length || markdown.text || text.text
        ? undefined
        : 'No useful HTML content could be extracted.',
  };
}

function removeNoisyElements($: cheerio.CheerioAPI): void {
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
    ].join(','),
  ).remove();

  $('*').each((_, element) => {
    const current = $(element);
    for (const attribute of Object.keys(current.attr() ?? {})) {
      if (
        attribute === 'href' ||
        attribute === 'src' ||
        attribute === 'alt' ||
        attribute === 'title' ||
        attribute === 'colspan' ||
        attribute === 'rowspan'
      ) {
        continue;
      }

      current.removeAttr(attribute);
    }
  });
}

function extractHeadings($: cheerio.CheerioAPI): readonly ExtractedHeading[] {
  return $('h1,h2,h3,h4,h5,h6')
    .toArray()
    .map((heading) => ({
      level: Number.parseInt(heading.tagName.slice(1), 10),
      text: normalizeWhitespace($(heading).text()),
    }))
    .filter((heading) => heading.text);
}

function extractLinks($: cheerio.CheerioAPI, baseUrl: string): readonly ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, link) => {
    const text = normalizeWhitespace($(link).text());
    const href = $(link).attr('href');

    if (!text || !href) {
      return;
    }

    try {
      const url = new URL(href, baseUrl).toString();
      const key = `${text}\n${url}`;

      if (!seen.has(key)) {
        seen.add(key);
        links.push({ text, url });
      }
    } catch {
      // Ignore malformed page links.
    }
  });

  return links.slice(0, 120);
}

function extractLists(
  $: cheerio.CheerioAPI,
  options: WebContentExtractionOptions,
): readonly ExtractedList[] {
  const maxLists = options.maxLists ?? defaultMaxLists;
  const maxItemsPerList = options.maxItemsPerList ?? defaultMaxItemsPerList;

  return $('ul,ol')
    .toArray()
    .slice(0, maxLists)
    .map((list, index) => {
      const items = $(list)
        .children('li')
        .toArray()
        .map((item) => normalizeWhitespace($(item).text()))
        .filter(Boolean);

      return {
        index,
        type: list.tagName.toLowerCase() === 'ol' ? ('ordered' as const) : ('unordered' as const),
        items: items.slice(0, maxItemsPerList),
        truncated: items.length > maxItemsPerList,
      };
    })
    .filter((list) => list.items.length > 0);
}

function extractTables(
  $: cheerio.CheerioAPI,
  options: WebContentExtractionOptions,
): readonly ExtractedTable[] {
  const maxTables = options.maxTables ?? defaultMaxTables;
  const maxRowsPerTable = options.maxRowsPerTable ?? defaultMaxRowsPerTable;

  return $('table')
    .toArray()
    .slice(0, maxTables)
    .map((table, index) => {
      const rows = $(table)
        .find('tr')
        .toArray()
        .map((row) =>
          $(row)
            .children('th,td')
            .toArray()
            .map((cell) => ({
              text: normalizeWhitespace($(cell).text()),
              header: cell.tagName.toLowerCase() === 'th',
              colspan: parsePositiveInteger($(cell).attr('colspan')),
              rowspan: parsePositiveInteger($(cell).attr('rowspan')),
            })),
        )
        .filter((row) => row.some((cell) => cell.text));
      const grid = expandTableGrid(rows);
      const headerRowCount = countHeaderRows(grid);
      const dataRows = grid.slice(headerRowCount);
      const headers = uniqueHeaders(
        buildHeaders(grid.slice(0, headerRowCount), maxColumnCount(grid)),
      );
      const clippedRows = dataRows.slice(0, maxRowsPerTable);

      return {
        index,
        caption: normalizeWhitespace($(table).find('caption').first().text()) || undefined,
        headers,
        rows: clippedRows.map((row) => tableRowToResult(headers, row)),
        truncated: dataRows.length > maxRowsPerTable,
      };
    })
    .filter((table) => table.rows.length > 0 || table.headers.length > 0);
}

function filterTables(
  tables: readonly ExtractedTable[],
  query: readonly string[],
): readonly ExtractedTable[] {
  if (!query.length) {
    return tables;
  }

  return tables
    .map((table) => ({
      ...table,
      rows: table.rows.filter((row) =>
        containsAnyQueryTerm([...table.headers, ...row.cells].join(' '), query),
      ),
    }))
    .filter((table) => table.rows.length > 0);
}

function filterLists(
  lists: readonly ExtractedList[],
  query: readonly string[],
): readonly ExtractedList[] {
  if (!query.length) {
    return lists;
  }

  return lists
    .map((list) => ({
      ...list,
      items: list.items.filter((item) => containsAnyQueryTerm(item, query)),
    }))
    .filter((list) => list.items.length > 0);
}

function filterLinks(
  links: readonly ExtractedLink[],
  query: readonly string[],
): readonly ExtractedLink[] {
  if (!query.length) {
    return links;
  }

  return links.filter((link) => containsAnyQueryTerm(`${link.text} ${link.url}`, query));
}

function filterHeadings(
  headings: readonly ExtractedHeading[],
  query: readonly string[],
): readonly ExtractedHeading[] {
  if (!query.length) {
    return headings;
  }

  return headings.filter((heading) => containsAnyQueryTerm(heading.text, query));
}

function expandTableGrid(rows: readonly (readonly Cell[])[]): readonly (readonly GridCell[])[] {
  const carry = new Map<number, { readonly cell: GridCell; remaining: number }>();

  return rows.map((row) => {
    const gridRow: GridCell[] = [];
    applyCarriedCells(carry, gridRow);
    let column = 0;

    for (const cell of row) {
      column = nextFreeColumn(gridRow, column);

      for (let offset = 0; offset < cell.colspan; offset += 1) {
        const gridCell = { text: cell.text, header: cell.header };
        gridRow[column + offset] = gridCell;

        if (cell.rowspan > 1) {
          carry.set(column + offset, {
            cell: gridCell,
            remaining: cell.rowspan - 1,
          });
        }
      }

      column += cell.colspan;
    }

    return gridRow;
  });
}

function applyCarriedCells(
  carry: Map<number, { readonly cell: GridCell; remaining: number }>,
  row: GridCell[],
): void {
  for (const [column, carried] of [...carry.entries()].sort(([left], [right]) => left - right)) {
    row[column] = carried.cell;
    carried.remaining -= 1;

    if (carried.remaining <= 0) {
      carry.delete(column);
    }
  }
}

function nextFreeColumn(row: readonly (GridCell | undefined)[], startColumn: number): number {
  let column = startColumn;

  while (row[column]) {
    column += 1;
  }

  return column;
}

function countHeaderRows(rows: readonly (readonly GridCell[])[]): number {
  const firstBodyRowIndex = rows.findIndex((row) => row.some((cell) => !cell.header));

  if (firstBodyRowIndex === -1) {
    return rows.length;
  }

  return firstBodyRowIndex;
}

function buildHeaders(
  headerRows: readonly (readonly GridCell[])[],
  columnCount: number,
): readonly string[] {
  if (!headerRows.length) {
    return Array.from({ length: columnCount }, (_, index) => `column_${index + 1}`);
  }

  return Array.from({ length: columnCount }, (_, column) => {
    const parts = headerRows
      .map((row) => row[column]?.text ?? '')
      .filter(Boolean)
      .filter((part, index, all) => all.indexOf(part) === index);

    return parts.join(' / ') || `column_${column + 1}`;
  });
}

function tableRowToResult(headers: readonly string[], row: readonly GridCell[]): ExtractedTableRow {
  const cells = row.map((cell) => cell.text);

  if (!headers.length) {
    return { cells };
  }

  const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));

  return { cells, record };
}

function maxColumnCount(rows: readonly (readonly GridCell[])[]): number {
  return Math.max(0, ...rows.map((row) => row.length));
}

function uniqueHeaders(headers: readonly string[]): readonly string[] {
  const seen = new Map<string, number>();

  return headers.map((header) => {
    const current = seen.get(header) ?? 0;
    seen.set(header, current + 1);

    return current === 0 ? header : `${header} ${current + 1}`;
  });
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });

  return normalizeWhitespace(turndown.turndown(html));
}

function clipText(
  text: string,
  maxCharacters: number,
): { readonly text: string; readonly truncated: boolean } {
  if (maxCharacters <= 0) {
    return { text: '', truncated: text.length > 0 };
  }

  if (text.length <= maxCharacters) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxCharacters)}\n\n[truncated]`,
    truncated: true,
  };
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeQuery(query: string | undefined): readonly string[] {
  return normalizeWhitespace(query ?? '')
    .toLowerCase()
    .split(/[\s,;|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

function containsAnyQueryTerm(value: string, query: readonly string[]): boolean {
  const normalized = value.toLowerCase();

  return query.some((term) => normalized.includes(term));
}
