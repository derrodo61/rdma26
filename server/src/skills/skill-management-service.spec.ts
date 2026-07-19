import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '../agents/agent-registry';
import { SkillLibrary } from './skill-library';
import { SkillManagementService } from './skill-management-service';

describe('SkillManagementService', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('lists and inspects skills without exposing physical directories', async () => {
    const { dataDir, service } = await createService(temporaryDirectories);
    await writeSkill(join(dataDir, 'skills', 'user', 'invoice-review'));

    const response = await service.listSkills();
    expect(response.skills).toContainEqual({
      id: 'invoice-review',
      name: 'invoice-review',
      description: 'Review invoice batches.',
      ownership: 'user',
    });
    expect(JSON.stringify(response)).not.toContain(dataDir);

    await expect(service.readSkill('invoice-review')).resolves.toMatchObject({
      id: 'invoice-review',
      skillMarkdown: expect.stringContaining('# Invoice review'),
      files: expect.arrayContaining([
        { path: 'SKILL.md', sizeBytes: expect.any(Number) },
        { path: 'references/checklist.md', sizeBytes: expect.any(Number) },
      ]),
    });
  });

  it('persists validated attachments and detaches without deleting the package', async () => {
    const { dataDir, registry, service } = await createService(temporaryDirectories);
    await writeSkill(join(dataDir, 'skills', 'user', 'invoice-review'));
    await registry.createAgent({ id: 'albert', name: 'Albert' });

    await expect(service.attachSkill('albert', 'invoice-review')).resolves.toMatchObject({
      agentId: 'albert',
      attachedSkillIds: ['invoice-review'],
    });
    await expect(service.attachSkill('albert', 'invoice-review')).resolves.toMatchObject({
      attachedSkillIds: ['invoice-review'],
    });
    await expect(registry.readAgent('albert')).resolves.toMatchObject({
      attachedSkills: ['invoice-review'],
    });

    await expect(service.detachSkill('albert', 'invoice-review')).resolves.toMatchObject({
      attachedSkillIds: [],
    });
    await expect(
      readFile(join(dataDir, 'skills', 'user', 'invoice-review', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: invoice-review');
  });

  it('rejects an invalid replacement without changing existing attachments', async () => {
    const { dataDir, registry, service } = await createService(temporaryDirectories);
    await writeSkill(join(dataDir, 'skills', 'user', 'invoice-review'));
    await registry.createAgent({ id: 'albert', name: 'Albert' });
    await service.attachSkill('albert', 'invoice-review');

    await expect(
      service.updateAgentSkills('albert', { attachedSkillIds: ['missing-skill'] }),
    ).rejects.toThrow('Attached skill missing-skill is not installed.');
    await expect(
      service.updateAgentSkills('albert', {
        attachedSkillIds: ['invoice-review', 'invoice-review'],
      }),
    ).rejects.toThrow('must be unique');
    await expect(registry.readAgent('albert')).resolves.toMatchObject({
      attachedSkills: ['invoice-review'],
    });
  });

  it('prevents removal of a required system-agent skill', async () => {
    const { registry, service } = await createService(temporaryDirectories);
    await registry.createAgent({
      id: 'cost-analyst',
      name: 'Cost Analyst',
      kind: 'internal',
    });

    await expect(service.detachSkill('cost-analyst', 'pricing-source-analysis')).rejects.toThrow(
      'Skill pricing-source-analysis is required for agent cost-analyst.',
    );
  });

  it('clones an immutable package into a complete user-owned package', async () => {
    const { dataDir, service } = await createService(temporaryDirectories);
    const source = await service.readSkill('pricing-source-analysis');

    await expect(
      service.cloneSkill('pricing-source-analysis', 'custom-pricing', source.contentHash),
    ).resolves.toMatchObject({
      id: 'custom-pricing',
      ownership: 'user',
      skillMarkdown: expect.stringContaining('name: custom-pricing'),
    });
    await expect(
      readFile(join(dataDir, 'skills', 'user', 'custom-pricing', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: custom-pricing');
  });

  it('edits only a current user-owned skill', async () => {
    const { dataDir, service } = await createService(temporaryDirectories);
    await writeSkill(join(dataDir, 'skills', 'user', 'invoice-review'));
    const original = await service.readSkill('invoice-review');
    const updatedMarkdown = original.skillMarkdown.replace(
      'Review invoice batches.',
      'Review invoice batches carefully.',
    );

    await expect(
      service.updateUserSkill('invoice-review', updatedMarkdown, original.contentHash),
    ).resolves.toMatchObject({ description: 'Review invoice batches carefully.' });
    await expect(
      service.updateUserSkill('invoice-review', original.skillMarkdown, original.contentHash),
    ).rejects.toThrow('changed after it was inspected');
    await expect(
      service.updateUserSkill(
        'pricing-source-analysis',
        original.skillMarkdown,
        (await service.readSkill('pricing-source-analysis')).contentHash,
      ),
    ).rejects.toThrow('bundled and cannot be edited');
  });

  it('rejects unsafe direct edits without changing the installed package', async () => {
    const { dataDir, service } = await createService(temporaryDirectories);
    await writeSkill(join(dataDir, 'skills', 'user', 'invoice-review'));
    const original = await service.readSkill('invoice-review');
    const unsafeMarkdown = `${original.skillMarkdown}\nAPI key: sk-${'a'.repeat(32)}\n`;

    await expect(
      service.updateUserSkill('invoice-review', unsafeMarkdown, original.contentHash),
    ).rejects.toThrow('failed safety validation');
    await expect(service.readSkill('invoice-review')).resolves.toMatchObject({
      contentHash: original.contentHash,
      skillMarkdown: original.skillMarkdown,
    });
  });

  it('refuses attached deletion and removes an unattached user skill', async () => {
    const { dataDir, registry, service } = await createService(temporaryDirectories);
    await writeSkill(join(dataDir, 'skills', 'user', 'invoice-review'));
    await registry.createAgent({ id: 'albert', name: 'Albert' });
    await service.attachSkill('albert', 'invoice-review');
    const skill = await service.readSkill('invoice-review');

    await expect(service.deleteSkill('invoice-review', skill.contentHash)).rejects.toThrow(
      'attached to Albert',
    );
    await service.detachSkill('albert', 'invoice-review');
    await expect(service.deleteSkill('invoice-review', skill.contentHash)).resolves.toEqual({
      deleted: true,
      skillId: 'invoice-review',
    });
    await expect(access(join(dataDir, 'skills', 'user', 'invoice-review'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uninstalls an unattached external package and its provenance record', async () => {
    const { dataDir, service } = await createService(temporaryDirectories);
    const sourceDir = join(dataDir, 'external-source', 'calendar-review');
    await writeSkill(sourceDir, 'calendar-review', 'Review calendar conflicts.');
    const installation = await service.installSkill({
      sourceType: 'local-directory',
      path: sourceDir,
    });
    const skill = await service.readSkill(installation.skillId);

    await expect(service.deleteSkill(skill.id, skill.contentHash)).resolves.toMatchObject({
      deleted: true,
      skillId: 'calendar-review',
    });
    await expect(service.listInstallations()).resolves.toEqual([]);
    await expect(
      access(join(dataDir, 'skills', 'external', 'calendar-review')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

async function createService(temporaryDirectories: string[]): Promise<{
  dataDir: string;
  registry: AgentRegistry;
  service: SkillManagementService;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-skill-service-'));
  temporaryDirectories.push(dataDir);
  const library = new SkillLibrary(dataDir);
  const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty', library);
  await registry.ensureReady();
  return {
    dataDir,
    registry,
    service: new SkillManagementService(library, registry),
  };
}

async function writeSkill(
  directory: string,
  name = 'invoice-review',
  description = 'Review invoice batches.',
): Promise<void> {
  await mkdir(join(directory, 'references'), { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# Invoice review\n`,
    'utf8',
  );
  await writeFile(join(directory, 'references', 'checklist.md'), '# Checklist\n', 'utf8');
}
