import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '../agents/agent-registry';
import { SkillLibrary } from './skill-library';
import { SkillManagementService } from './skill-management-service';
import { SkillProposalService } from './skill-proposal-service';

describe('SkillProposalService', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('creates, supersedes, and explicitly applies a user-skill proposal', async () => {
    const { dataDir, proposals, library } = await createServices(temporaryDirectories);
    const first = await proposals.createAuthoringProposal(
      'create',
      authoringRequest('invoice-review', '# First workflow'),
      { agentId: 'albert', threadId: 'thread-1' },
    );
    const second = await proposals.createAuthoringProposal(
      'create',
      authoringRequest('invoice-review', '# Better workflow'),
      { agentId: 'albert', threadId: 'thread-1' },
    );

    await expect(proposals.read(first.id)).resolves.toMatchObject({ state: 'superseded' });
    await expect(proposals.apply(second.id)).resolves.toMatchObject({ state: 'applied' });
    await expect(library.inspectPackage('invoice-review')).resolves.toMatchObject({
      ownership: 'user',
      skillMarkdown: expect.stringContaining('# Better workflow'),
    });
    await expect(
      readFile(
        join(dataDir, 'skills', 'proposals', second.id, 'invoice-review', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toContain('# Better workflow');
  });

  it('marks an update stale when its user-owned target changes', async () => {
    const { dataDir, proposals } = await createServices(temporaryDirectories);
    const target = join(dataDir, 'skills', 'user', 'invoice-review');
    await mkdir(target, { recursive: true });
    await writeFile(target + '/SKILL.md', skillMarkdown('invoice-review', '# Initial'), 'utf8');
    const proposal = await proposals.createAuthoringProposal(
      'update',
      authoringRequest('invoice-review', '# Proposed'),
      { agentId: 'albert' },
    );
    await writeFile(target + '/SKILL.md', skillMarkdown('invoice-review', '# Other edit'), 'utf8');

    await expect(proposals.read(proposal.id)).resolves.toMatchObject({
      state: 'stale',
      stateReason: expect.stringContaining('changed after proposal creation'),
    });
    await expect(proposals.apply(proposal.id)).rejects.toThrow('Only a pending');
  });

  it('quarantines suspicious authoring proposals and never applies them', async () => {
    const { proposals } = await createServices(temporaryDirectories);
    const proposal = await proposals.createAuthoringProposal(
      'create',
      authoringRequest('unsafe-workflow', '# Workflow\nRun sudo before continuing.'),
      { agentId: 'albert' },
    );

    expect(proposal).toMatchObject({
      state: 'quarantined',
      compatibility: {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'privilege_escalation' }),
        ]),
      },
    });
    await expect(proposals.apply(proposal.id)).rejects.toThrow('Only a pending');
    await expect(proposals.reject(proposal.id, 'Unsafe instructions.')).resolves.toMatchObject({
      state: 'rejected',
      stateReason: 'Unsafe instructions.',
    });
  });

  it('records scanner rejection without retaining credential-bearing files', async () => {
    const { dataDir, proposals } = await createServices(temporaryDirectories);
    const proposal = await proposals.createAuthoringProposal(
      'create',
      authoringRequest(
        'credential-workflow',
        '# Workflow\nUse sk-abcdefghijklmnopqrstuvwxyz123456 directly.',
      ),
      { agentId: 'albert' },
    );

    expect(proposal).toMatchObject({
      state: 'rejected',
      compatibility: {
        status: 'unsafe_or_invalid',
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'embedded_openai_key' }),
        ]),
      },
    });
    await expect(
      access(join(dataDir, 'skills', 'proposals', proposal.id, 'credential-workflow', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('binds an installation proposal to the inspected source hash', async () => {
    const { proposals, library } = await createServices(temporaryDirectories);
    const sourceRoot = await mkdtemp(join(tmpdir(), 'rdma26-proposal-source-'));
    temporaryDirectories.push(sourceRoot);
    const source = join(sourceRoot, 'external-workflow');
    await mkdir(source);
    await writeFile(
      source + '/SKILL.md',
      skillMarkdown('external-workflow', '# Version 1'),
      'utf8',
    );
    const proposal = await proposals.createInstallProposal(
      { installation: { sourceType: 'local-directory', path: source } },
      { agentId: 'albert' },
    );
    await writeFile(
      source + '/SKILL.md',
      skillMarkdown('external-workflow', '# Version 2'),
      'utf8',
    );

    await expect(proposals.apply(proposal.id)).rejects.toThrow('changed after inspection');
    await expect(proposals.read(proposal.id)).resolves.toMatchObject({ state: 'stale' });
    await expect(library.listPackages()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'external-workflow' })]),
    );
  });
});

async function createServices(temporaryDirectories: string[]) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-proposals-'));
  temporaryDirectories.push(dataDir);
  const library = new SkillLibrary(dataDir);
  const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty', library);
  await registry.ensureReady();
  const skills = new SkillManagementService(library, registry);
  const proposals = new SkillProposalService(dataDir, library, skills);
  await proposals.ensureReady();
  return { dataDir, library, proposals };
}

function authoringRequest(skillId: string, body: string) {
  return {
    skillId,
    skillMarkdown: skillMarkdown(skillId, body),
    evidence: 'The user requested a reusable workflow.',
  };
}

function skillMarkdown(skillId: string, body: string): string {
  return `---\nname: ${skillId}\ndescription: Test workflow.\n---\n\n${body}\n`;
}
