import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';

import { ClawHubCatalogAdapter } from './skill-catalog';

describe('ClawHubCatalogAdapter', () => {
  it('uses the public non-suspicious search API and maps canonical links', async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Response.json({
        results: [
          {
            slug: 'calendar-helper',
            displayName: 'Calendar Helper',
            summary: 'Plan calendar work.',
            version: '1.2.3',
            ownerHandle: 'openclaw',
          },
        ],
      });
    });
    const adapter = new ClawHubCatalogAdapter('https://clawhub.test', fetchMock as typeof fetch);

    await expect(adapter.search('calendar', 5)).resolves.toEqual({
      results: [
        {
          catalogId: 'clawhub',
          skillId: '@openclaw/calendar-helper',
          displayName: 'Calendar Helper',
          description: 'Plan calendar work.',
          version: '1.2.3',
          author: 'openclaw',
          canonicalUrl: 'https://clawhub.ai/openclaw/skills/calendar-helper',
        },
      ],
    });
    const requestedUrl = requestedUrls[0] ?? '';
    expect(requestedUrl).toContain('/api/v1/search');
    expect(requestedUrl).toContain('nonSuspiciousOnly=true');
  });

  it('resolves a clean hosted ClawHub ZIP without rewriting package content', async () => {
    const archive = await zipBuffer([
      {
        path: 'SKILL.md',
        content: '---\nname: calendar-helper\ndescription: Plan calendars.\n---\n\n# Calendar\n',
      },
    ]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/v1/skills/')) {
        return Response.json({
          skill: { slug: 'calendar-helper' },
          latestVersion: { version: '1.2.3' },
          owner: { handle: 'openclaw' },
          moderation: { isSuspicious: false, isMalwareBlocked: false },
        });
      }
      return new Response(archive, { headers: { 'content-type': 'application/zip' } });
    });
    const adapter = new ClawHubCatalogAdapter('https://clawhub.test', fetchMock as typeof fetch);

    const resolved = await adapter.resolve('calendar-helper');
    try {
      expect(resolved).toMatchObject({
        version: '1.2.3',
        author: 'openclaw',
        license: 'MIT-0',
      });
      await expect(
        import('node:fs/promises').then(
          async ({ readFile }) => await readFile(`${resolved.staged.directory}/SKILL.md`, 'utf8'),
        ),
      ).resolves.toContain('# Calendar');
    } finally {
      await resolved.staged.cleanup();
    }
  });
});

async function zipBuffer(files: readonly { path: string; content: string }[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const file of files) {
    zip.addBuffer(Buffer.from(file.content), file.path);
  }
  zip.end();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  zip.outputStream.pipe(output);
  await new Promise<void>((resolvePromise, reject) => {
    output.on('end', resolvePromise);
    output.on('error', reject);
  });
  return Buffer.concat(chunks);
}
