import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuthConfig } from '../../auth';
import { AssistantRuntime } from '../../runtime';
import { registerApiRoutes } from '../api-routes';

describe('skill routes', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('requires authentication and exposes library and attachment operations', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-skill-routes-'));
    temporaryDirectories.push(dataDir);
    await writeSkill(join(dataDir, 'skills', 'user', 'invoice-review'));
    const runtime = new AssistantRuntime({
      dataDir,
      defaultAgentId: 'scotty',
      defaultAgentName: 'Scotty',
    });
    const server = Fastify();
    const authConfig: AuthConfig = {
      enabled: true,
      username: 'tester',
      password: 'secret',
      sessionSecret: 'test-session-secret',
    };

    try {
      await runtime.ensureReady();
      await runtime.createAgent({ id: 'albert', name: 'Albert' });
      registerApiRoutes(server, { authConfig, runtime });
      await server.ready();

      await expect(server.inject({ method: 'GET', url: '/api/skills' })).resolves.toMatchObject({
        statusCode: 401,
      });

      const login = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'tester', password: 'secret' },
      });
      const setCookie = login.headers['set-cookie'];
      const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
      expect(cookie).toBeTruthy();

      const library = await server.inject({
        method: 'GET',
        url: '/api/skills',
        headers: { cookie },
      });
      expect(library.statusCode).toBe(200);
      expect(library.json()).toMatchObject({
        skills: expect.arrayContaining([expect.objectContaining({ id: 'invoice-review' })]),
      });
      expect(library.body).not.toContain(dataDir);

      const attach = await server.inject({
        method: 'POST',
        url: '/api/agents/albert/skills/invoice-review',
        headers: { cookie },
      });
      expect(attach.statusCode).toBe(200);
      expect(attach.json()).toMatchObject({
        agentId: 'albert',
        attachedSkillIds: ['invoice-review'],
      });

      const duplicateReplacement = await server.inject({
        method: 'PUT',
        url: '/api/agents/albert/skills',
        headers: { cookie },
        payload: { attachedSkillIds: ['invoice-review', 'invoice-review'] },
      });
      expect(duplicateReplacement.statusCode).toBe(400);

      const details = await server.inject({
        method: 'GET',
        url: '/api/skills/invoice-review',
        headers: { cookie },
      });
      expect(details.statusCode).toBe(200);
      expect(details.json()).toMatchObject({
        id: 'invoice-review',
        files: [{ path: 'SKILL.md', sizeBytes: expect.any(Number) }],
      });
      expect(details.body).not.toContain(dataDir);
    } finally {
      await server.close();
      runtime.close();
    }
  });

  it('installs and manages an external skill through authenticated routes', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-skill-management-routes-'));
    const sourceRoot = await mkdtemp(join(tmpdir(), 'rdma26-skill-source-'));
    const sourceDir = join(sourceRoot, 'invoice-review');
    temporaryDirectories.push(dataDir, sourceRoot);
    await writeSkill(sourceDir);
    const runtime = new AssistantRuntime({
      dataDir,
      defaultAgentId: 'scotty',
      defaultAgentName: 'Scotty',
    });
    const server = Fastify();
    const authConfig: AuthConfig = {
      enabled: false,
      username: '',
      password: '',
      sessionSecret: 'test-session-secret',
    };

    try {
      await runtime.ensureReady();
      registerApiRoutes(server, { authConfig, runtime });
      await server.ready();

      const install = await server.inject({
        method: 'POST',
        url: '/api/skill-installations',
        payload: { sourceType: 'local-directory', path: sourceDir },
      });
      expect(install.statusCode).toBe(200);
      expect(install.json()).toMatchObject({
        skillId: 'invoice-review',
        pinned: false,
        source: { type: 'local-directory' },
      });

      const installations = await server.inject({
        method: 'GET',
        url: '/api/skill-installations',
      });
      expect(installations.statusCode).toBe(200);
      expect(installations.json()).toMatchObject({
        installations: [expect.objectContaining({ skillId: 'invoice-review' })],
      });

      const details = await server.inject({ method: 'GET', url: '/api/skills/invoice-review' });
      const sourceHash = String(details.json<{ contentHash: string }>().contentHash);
      const clone = await server.inject({
        method: 'POST',
        url: '/api/skills/invoice-review/clone',
        payload: {
          targetSkillId: 'invoice-review-copy',
          expectedSourceHash: sourceHash,
        },
      });
      expect(clone.statusCode).toBe(200);
      expect(clone.json()).toMatchObject({ id: 'invoice-review-copy', ownership: 'user' });

      const cloned = clone.json<{ contentHash: string; skillMarkdown: string }>();
      const edit = await server.inject({
        method: 'PUT',
        url: '/api/skills/invoice-review-copy',
        payload: {
          skillMarkdown: cloned.skillMarkdown.replace(
            'Review invoice batches.',
            'Review copied invoice batches.',
          ),
          expectedContentHash: cloned.contentHash,
        },
      });
      expect(edit.statusCode).toBe(200);
      expect(edit.json()).toMatchObject({ description: 'Review copied invoice batches.' });

      const deleteCopy = await server.inject({
        method: 'DELETE',
        url: '/api/skills/invoice-review-copy',
        payload: { expectedContentHash: edit.json<{ contentHash: string }>().contentHash },
      });
      expect(deleteCopy.statusCode).toBe(200);
      expect(deleteCopy.json()).toEqual({ deleted: true, skillId: 'invoice-review-copy' });

      const pin = await server.inject({
        method: 'PATCH',
        url: '/api/skill-installations/invoice-review/pin',
        payload: { pinned: true },
      });
      expect(pin.statusCode).toBe(200);
      expect(pin.json()).toMatchObject({ skillId: 'invoice-review', pinned: true });

      await runtime.attachAgentSkill('scotty', 'invoice-review');
      const attachedDelete = await server.inject({
        method: 'DELETE',
        url: '/api/skills/invoice-review',
        payload: { expectedContentHash: sourceHash },
      });
      expect(attachedDelete.statusCode).toBe(400);
      expect(attachedDelete.json()).toMatchObject({ message: expect.stringContaining('attached') });
      await runtime.detachAgentSkill('scotty', 'invoice-review');

      const invalidUpdate = await server.inject({
        method: 'POST',
        url: '/api/skill-installations/invoice-review/update',
        payload: {},
      });
      expect(invalidUpdate.statusCode).toBe(400);

      const proposal = await runtime.proposeSkillCreate(
        {
          skillId: 'review-checklist',
          skillMarkdown:
            '---\nname: review-checklist\ndescription: Review a checklist.\n---\n\n# Review\n',
        },
        { agentId: 'albert', threadId: 'thread-1' },
      );
      const proposalList = await server.inject({ method: 'GET', url: '/api/skill-proposals' });
      expect(proposalList.statusCode).toBe(200);
      expect(proposalList.json()).toMatchObject({
        proposals: [expect.objectContaining({ id: proposal.id, state: 'pending' })],
      });

      const applyProposal = await server.inject({
        method: 'POST',
        url: `/api/skill-proposals/${proposal.id}/apply`,
      });
      expect(applyProposal.statusCode).toBe(200);
      expect(applyProposal.json()).toMatchObject({ id: proposal.id, state: 'applied' });
      await expect(runtime.readSkill('review-checklist')).resolves.toMatchObject({
        ownership: 'user',
      });

      const uninstall = await server.inject({
        method: 'DELETE',
        url: '/api/skills/invoice-review',
        payload: { expectedContentHash: sourceHash },
      });
      expect(uninstall.statusCode).toBe(200);
      expect(uninstall.json()).toEqual({ deleted: true, skillId: 'invoice-review' });
      await expect(runtime.listSkillInstallations()).resolves.toEqual([]);
    } finally {
      await server.close();
      runtime.close();
    }
  });
});

async function writeSkill(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    '---\nname: invoice-review\ndescription: Review invoice batches.\n---\n\n# Invoice review\n',
    'utf8',
  );
}
