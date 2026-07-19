import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { AgentRegistry } from './agent-registry';

describe('AgentRegistry', () => {
  it('stores agent visibility metadata for operator, chat, and internal agents', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-agents-'));
    const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty');

    await registry.ensureReady();
    const operator = await registry.readAgent('scotty');
    const chatAgent = await registry.createAgent({
      id: 'ronaldo',
      name: 'Ronaldo',
    });
    const internalAgent = await registry.createAgent({
      id: 'research',
      name: 'Research Agent',
      kind: 'internal',
      chatEnabled: false,
    });

    expect(operator).toMatchObject({
      id: 'scotty',
      kind: 'operator',
      chatEnabled: true,
    });
    expect(chatAgent).toMatchObject({
      id: 'ronaldo',
      kind: 'chat',
      chatEnabled: true,
    });
    expect(internalAgent).toMatchObject({
      id: 'research',
      kind: 'internal',
      chatEnabled: false,
    });
    expect(chatAgent.attachedSkills).toEqual([]);
  });

  it('migrates legacy tool grants to capability grants', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-agents-'));
    const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty');

    await registry.ensureReady();
    await registry.createAgent({ id: 'ronaldo', name: 'Ronaldo' });
    const profilePath = join(dataDir, 'agents', 'ronaldo', 'agent.json');
    const legacyProfile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<
      string,
      unknown
    >;
    delete legacyProfile['enabledCapabilities'];
    legacyProfile['enabledTools'] = ['read_web_page', 'read_web_page_structure', 'web_search'];
    await writeFile(profilePath, `${JSON.stringify(legacyProfile, null, 2)}\n`, 'utf8');

    await expect(registry.readAgent('ronaldo')).resolves.toMatchObject({
      enabledCapabilities: ['web_page_access', 'web_search'],
    });
    const migratedProfile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(migratedProfile['enabledCapabilities']).toEqual(['web_page_access', 'web_search']);
    expect(migratedProfile).not.toHaveProperty('enabledTools');
  });

  it('migrates agent-local skills into shared attachments', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-agents-'));
    const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty');
    await registry.ensureReady();
    await registry.createAgent({ id: 'ronaldo', name: 'Ronaldo' });
    const legacySkillDir = join(
      dataDir,
      'agents',
      'ronaldo',
      'deepagent',
      'skills',
      'match-review',
    );
    await mkdir(legacySkillDir, { recursive: true });
    await writeFile(
      join(legacySkillDir, 'SKILL.md'),
      '---\nname: match-review\ndescription: Review a football match.\n---\n',
      'utf8',
    );

    await registry.ensureReady();

    await expect(registry.readAgent('ronaldo')).resolves.toMatchObject({
      attachedSkills: ['match-review'],
    });
    await expect(
      readFile(join(dataDir, 'skills', 'user', 'match-review', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: match-review');
    await expect(
      readFile(
        join(
          dataDir,
          'agents',
          'ronaldo',
          'migration-backups',
          'agent-local-skills',
          'match-review',
          'SKILL.md',
        ),
        'utf8',
      ),
    ).resolves.toContain('name: match-review');
  });

  it('gives new Cost Analyst profiles the bundled pricing skill attachment', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-agents-'));
    const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty');
    await registry.ensureReady();

    await expect(
      registry.createAgent({
        id: 'cost-analyst',
        name: 'Cost Analyst',
        kind: 'internal',
        chatEnabled: true,
      }),
    ).resolves.toMatchObject({
      attachedSkills: ['pricing-source-analysis'],
    });
  });
});
