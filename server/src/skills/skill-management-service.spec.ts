import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

async function writeSkill(directory: string): Promise<void> {
  await mkdir(join(directory, 'references'), { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    '---\nname: invoice-review\ndescription: Review invoice batches.\n---\n\n# Invoice review\n',
    'utf8',
  );
  await writeFile(join(directory, 'references', 'checklist.md'), '# Checklist\n', 'utf8');
}
