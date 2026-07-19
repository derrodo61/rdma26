import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SkillLibrary } from './skill-library';

describe('SkillLibrary', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('materializes the bundled pricing skill once in the shared library', async () => {
    const { dataDir, library } = await createLibrary(temporaryDirectories);

    await expect(library.listPackages()).resolves.toEqual([
      expect.objectContaining({
        id: 'pricing-source-analysis',
        ownership: 'bundled',
        directory: join(dataDir, 'skills', 'bundled', 'pricing-source-analysis'),
      }),
    ]);
  });

  it('resolves only explicitly attached packages to virtual skill paths', async () => {
    const { dataDir, library } = await createLibrary(temporaryDirectories);
    await writeSkill(
      join(dataDir, 'skills', 'user', 'invoice-review'),
      'invoice-review',
      'Review invoice batches.',
    );

    await expect(library.resolveAttachedSkills(['invoice-review'])).resolves.toEqual([
      {
        id: 'invoice-review',
        virtualPath: '/skills/invoice-review/',
        directory: join(dataDir, 'skills', 'user', 'invoice-review'),
      },
    ]);
    await expect(library.resolveAttachedSkills([])).resolves.toEqual([]);
    await expect(library.resolveAttachedSkills(['missing-skill'])).rejects.toThrow(
      'Attached skill missing-skill is not installed.',
    );
  });

  it('migrates a valid agent-local skill without deleting its source', async () => {
    const { dataDir, library } = await createLibrary(temporaryDirectories);
    const legacyDir = join(dataDir, 'agents', 'albert', 'deepagent', 'skills');
    const legacySkillDir = join(legacyDir, 'invoice-review');
    await writeSkill(legacySkillDir, 'invoice-review', 'Review invoice batches.');
    await writeFile(join(legacyDir, 'README.md'), 'legacy note', 'utf8');

    const backupDir = join(dataDir, 'agents', 'albert', 'migration-backups', 'skills');
    await expect(
      library.migrateAgentLocalSkills('albert', legacyDir, backupDir, []),
    ).resolves.toEqual(['invoice-review']);
    await expect(
      readFile(join(dataDir, 'skills', 'user', 'invoice-review', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: invoice-review');
    await expect(
      readFile(join(backupDir, 'invoice-review', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: invoice-review');
    await expect(readFile(join(backupDir, 'README.md'), 'utf8')).resolves.toBe('legacy note');
    await expect(access(legacySkillDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reuses identical legacy packages for several agents', async () => {
    const { dataDir, library } = await createLibrary(temporaryDirectories);
    const albertSkills = join(dataDir, 'agents', 'albert', 'deepagent', 'skills');
    const ronaldoSkills = join(dataDir, 'agents', 'ronaldo', 'deepagent', 'skills');
    await writeSkill(
      join(albertSkills, 'invoice-review'),
      'invoice-review',
      'Review invoice batches.',
    );
    await writeSkill(
      join(ronaldoSkills, 'invoice-review'),
      'invoice-review',
      'Review invoice batches.',
    );

    await expect(
      library.migrateAgentLocalSkills(
        'albert',
        albertSkills,
        join(dataDir, 'agents', 'albert', 'migration-backups', 'skills'),
        [],
      ),
    ).resolves.toEqual(['invoice-review']);
    await expect(
      library.migrateAgentLocalSkills(
        'ronaldo',
        ronaldoSkills,
        join(dataDir, 'agents', 'ronaldo', 'migration-backups', 'skills'),
        [],
      ),
    ).resolves.toEqual(['invoice-review']);
  });

  it('rejects a migration collision without overwriting either package', async () => {
    const { dataDir, library } = await createLibrary(temporaryDirectories);
    const installedDir = join(dataDir, 'skills', 'user', 'invoice-review');
    const legacyDir = join(dataDir, 'agents', 'albert', 'deepagent', 'skills');
    await writeSkill(installedDir, 'invoice-review', 'Installed content.');
    await writeSkill(join(legacyDir, 'invoice-review'), 'invoice-review', 'Different content.');

    await expect(
      library.migrateAgentLocalSkills(
        'albert',
        legacyDir,
        join(dataDir, 'agents', 'albert', 'migration-backups', 'skills'),
        [],
      ),
    ).rejects.toThrow('an installed package with different content already exists');
    await expect(readFile(join(installedDir, 'SKILL.md'), 'utf8')).resolves.toContain(
      'Installed content.',
    );
    await expect(
      readFile(join(legacyDir, 'invoice-review', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('Different content.');
  });

  it('rejects invalid package metadata', async () => {
    const { dataDir, library } = await createLibrary(temporaryDirectories);
    const invalidDir = join(dataDir, 'skills', 'user', 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'SKILL.md'), '# Missing frontmatter\n', 'utf8');

    await expect(library.listPackages()).rejects.toThrow('must start with YAML frontmatter');
  });

  it('removes the obsolete web-research package during migration', async () => {
    const { dataDir, library } = await createLibrary(temporaryDirectories);
    const legacyDir = join(dataDir, 'agents', 'albert', 'deepagent', 'skills');
    const obsoleteDir = join(legacyDir, 'web-research');
    await writeSkill(obsoleteDir, 'web-research', 'Obsolete research instructions.');

    await expect(
      library.migrateAgentLocalSkills(
        'albert',
        legacyDir,
        join(dataDir, 'agents', 'albert', 'migration-backups', 'skills'),
        [],
      ),
    ).resolves.toEqual([]);
    await expect(access(obsoleteDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createLibrary(
  temporaryDirectories: string[],
): Promise<{ dataDir: string; library: SkillLibrary }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-skills-'));
  temporaryDirectories.push(dataDir);
  const library = new SkillLibrary(dataDir);
  await library.ensureReady();
  return { dataDir, library };
}

async function writeSkill(directory: string, name: string, description: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    'utf8',
  );
}
