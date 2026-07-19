import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SkillLibrary } from './skill-library';
import { SkillPackageInstaller } from './skill-package-installer';

describe('SkillPackageInstaller', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('installs a content-addressed external package with provenance', async () => {
    const { dataDir, source, library, installer } = await createInstaller(temporaryDirectories);

    const record = await installer.install({
      sourceType: 'local-directory',
      path: source,
    });

    expect(record).toMatchObject({
      skillId: 'external-skill',
      source: { type: 'local-directory', path: source },
      activeContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      pinned: false,
      versions: [
        expect.objectContaining({
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          version: '1.0.0',
          author: 'Test Author',
          license: 'MIT',
          compatibility: expect.objectContaining({ status: 'compatible' }),
        }),
      ],
    });
    await expect(library.listPackages()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'external-skill', ownership: 'external' }),
      ]),
    );
    await expect(
      readFile(
        join(dataDir, 'skills', 'external', 'external-skill', record.activeContentHash, 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toContain('# Version 1');
  });

  it('previews, applies, pins, and rolls back immutable updates', async () => {
    const { dataDir, source, library, installer } = await createInstaller(temporaryDirectories);
    const initial = await installer.install({ sourceType: 'local-directory', path: source });
    await writeSkill(source, '2.0.0', '# Version 2\nNew workflow.');

    const preview = await installer.inspectUpdate('external-skill');
    expect(preview).toMatchObject({
      currentContentHash: initial.activeContentHash,
      updateAvailable: true,
      candidate: { version: '2.0.0' },
      changes: [{ path: 'SKILL.md', kind: 'modified' }],
    });

    await expect(installer.applyUpdate('external-skill', '0'.repeat(64))).rejects.toThrow(
      'changed after inspection',
    );

    const updated = await installer.applyUpdate('external-skill', preview.candidate.contentHash);
    expect(updated.activeContentHash).toBe(preview.candidate.contentHash);
    expect(updated.versions).toHaveLength(2);
    await expect(library.inspectPackage('external-skill')).resolves.toMatchObject({
      skillMarkdown: expect.stringContaining('# Version 2'),
    });

    await installer.setPinned('external-skill', true);
    await writeSkill(source, '3.0.0', '# Version 3');
    const pinnedPreview = await installer.inspectUpdate('external-skill');
    await expect(
      installer.applyUpdate('external-skill', pinnedPreview.candidate.contentHash),
    ).rejects.toThrow('is pinned');

    const rolledBack = await installer.rollback('external-skill');
    expect(rolledBack.activeContentHash).toBe(initial.activeContentHash);
    await expect(library.inspectPackage('external-skill')).resolves.toMatchObject({
      skillMarkdown: expect.stringContaining('# Version 1'),
    });
    await expect(
      access(
        join(
          dataDir,
          'skills',
          'external',
          'external-skill',
          updated.activeContentHash,
          'SKILL.md',
        ),
      ),
    ).resolves.toBeUndefined();

    await installer.setPinned('external-skill', false);
    await writeSkill(source, '2.0.0', '# Version 2\nNew workflow.');
    const reinstallPreview = await installer.inspectUpdate('external-skill');
    await expect(
      installer.applyUpdate('external-skill', reinstallPreview.candidate.contentHash),
    ).resolves.toMatchObject({ activeContentHash: updated.activeContentHash });
  });

  it('does not install a package that collides with a bundled skill', async () => {
    const { source, installer } = await createInstaller(temporaryDirectories);
    await rm(source, { recursive: true, force: true });
    const bundledCollision = join(source, '..', 'pricing-source-analysis');
    await mkdir(bundledCollision);
    await writeFile(
      join(bundledCollision, 'SKILL.md'),
      '---\nname: pricing-source-analysis\ndescription: Collision.\n---\n',
      'utf8',
    );

    await expect(
      installer.install({ sourceType: 'local-directory', path: bundledCollision }),
    ).rejects.toThrow('already installed');
  });

  it('refuses to expose a tampered immutable package version', async () => {
    const { dataDir, source, library, installer } = await createInstaller(temporaryDirectories);
    const record = await installer.install({ sourceType: 'local-directory', path: source });
    await writeFile(
      join(dataDir, 'skills', 'external', 'external-skill', record.activeContentHash, 'SKILL.md'),
      'tampered',
      'utf8',
    );

    await expect(library.listPackages()).rejects.toThrow('failed its content hash check');
  });
});

async function createInstaller(temporaryDirectories: string[]): Promise<{
  dataDir: string;
  source: string;
  library: SkillLibrary;
  installer: SkillPackageInstaller;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-installer-data-'));
  const sourceRoot = await mkdtemp(join(tmpdir(), 'rdma26-installer-source-'));
  temporaryDirectories.push(dataDir, sourceRoot);
  const source = join(sourceRoot, 'external-skill');
  await mkdir(source);
  await writeSkill(source, '1.0.0', '# Version 1');
  const library = new SkillLibrary(dataDir);
  await library.ensureReady();
  return {
    dataDir,
    source,
    library,
    installer: new SkillPackageInstaller(dataDir, library, []),
  };
}

async function writeSkill(directory: string, version: string, body: string): Promise<void> {
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: external-skill\ndescription: External test skill.\nversion: ${version}\nauthor: Test Author\nlicense: MIT\n---\n\n${body}\n`,
    'utf8',
  );
}
