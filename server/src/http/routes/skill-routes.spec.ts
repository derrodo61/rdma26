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
});

async function writeSkill(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    '---\nname: invoice-review\ndescription: Review invoice batches.\n---\n\n# Invoice review\n',
    'utf8',
  );
}
