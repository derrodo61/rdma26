import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { afterEach, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import { parseGitTree, stageLocalDirectory, stageZipArchive } from './skill-package-source';

describe('skill package sources', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('stages a one-package ZIP and normalizes a root-level SKILL.md', async () => {
    const root = await temporaryRoot(temporaryDirectories);
    const archive = join(root, 'skill.zip');
    await writeZip(archive, [
      {
        path: 'SKILL.md',
        content: '---\nname: archive-skill\ndescription: Test.\n---\n\n# Archive\n',
      },
      { path: 'references/info.md', content: '# Info\n' },
    ]);

    const staged = await stageZipArchive(archive);
    try {
      await expect(
        import('node:fs/promises').then(({ access }) => access(join(staged.directory, 'SKILL.md'))),
      ).resolves.toBeUndefined();
      expect(staged.directory).toMatch(/archive-skill$/);
    } finally {
      await staged.cleanup();
    }
  });

  it('rejects symbolic links in local packages', async () => {
    const root = await temporaryRoot(temporaryDirectories);
    const directory = join(root, 'linked-skill');
    await mkdir(directory);
    await writeFile(
      join(directory, 'SKILL.md'),
      '---\nname: linked-skill\ndescription: Test.\n---\n',
      'utf8',
    );
    await symlink('/etc/passwd', join(directory, 'secret.txt'));

    await expect(stageLocalDirectory(directory)).rejects.toThrow('unsupported symbolic link');
  });

  it('describes missing local skill paths without leaking Node filesystem errors', async () => {
    const root = await temporaryRoot(temporaryDirectories);

    await expect(stageLocalDirectory(join(root, 'missing-directory'))).rejects.toMatchObject({
      code: 'SKILL_SOURCE_NOT_FOUND',
      message: expect.stringContaining('Skill directory does not exist:'),
    });
    await expect(stageZipArchive(join(root, 'missing-archive.zip'))).rejects.toMatchObject({
      code: 'SKILL_ARCHIVE_NOT_FOUND',
      message: expect.stringContaining('Skill archive does not exist:'),
    });
  });

  it('rejects traversal paths and symbolic links in ZIP archives', async () => {
    const root = await temporaryRoot(temporaryDirectories);
    const traversalArchive = join(root, 'traversal.zip');
    const safeArchive = await zipBuffer([{ path: 'safe.txt', content: 'outside' }]);
    await writeFile(traversalArchive, replaceAscii(safeArchive, 'safe.txt', '../x.txt'));
    await expect(stageZipArchive(traversalArchive)).rejects.toThrow(/relative path|unsafe path/);

    const symlinkArchive = join(root, 'symlink.zip');
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from('SKILL.md'), 'linked-skill/link', { mode: 0o120777 });
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(symlinkArchive));
    await expect(stageZipArchive(symlinkArchive)).rejects.toThrow('symbolic link');
  });

  it('rejects Git tree symlinks and accepts regular blobs', () => {
    expect(
      parseGitTree(Buffer.from('100644 blob abcdef\tskills/demo/SKILL.md\0'), 'skills/demo'),
    ).toEqual([
      {
        repositoryPath: 'skills/demo/SKILL.md',
        relativePath: 'SKILL.md',
        executable: false,
      },
    ]);
    expect(() =>
      parseGitTree(Buffer.from('120000 blob abcdef\tskills/demo/link\0'), 'skills/demo'),
    ).toThrow('unsupported entry');
  });
});

async function temporaryRoot(temporaryDirectories: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rdma26-source-'));
  temporaryDirectories.push(root);
  return root;
}

async function writeZip(
  path: string,
  files: readonly { path: string; content: string }[],
): Promise<void> {
  const zip = new ZipFile();
  for (const file of files) {
    zip.addBuffer(Buffer.from(file.content), file.path);
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
}

async function zipBuffer(files: readonly { path: string; content: string }[]): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  for (const file of files) {
    zip.addBuffer(Buffer.from(file.content), file.path);
  }
  zip.end();
  zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolvePromise, reject) => {
    zip.outputStream.on('end', resolvePromise);
    zip.outputStream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

function replaceAscii(buffer: Buffer, original: string, replacement: string): Buffer {
  if (original.length !== replacement.length) {
    throw new Error('ZIP fixture path replacements must have equal length.');
  }

  const result = Buffer.from(buffer);
  const originalBytes = Buffer.from(original);
  const replacementBytes = Buffer.from(replacement);
  let offset = 0;

  while ((offset = result.indexOf(originalBytes, offset)) >= 0) {
    replacementBytes.copy(result, offset);
    offset += replacementBytes.length;
  }

  return result;
}
