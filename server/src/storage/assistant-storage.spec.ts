import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '../../../shared/agent-contracts';
import { createAssistantStorage } from './assistant-storage';

describe('AssistantStorage built-in skills', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('removes the obsolete web-research skill from existing agents', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-storage-'));
    temporaryDirectories.push(dataDir);
    const staleSkillDir = join(dataDir, 'agents', 'albert', 'deepagent', 'skills', 'web-research');
    await mkdir(staleSkillDir, { recursive: true });
    await writeFile(join(staleSkillDir, 'SKILL.md'), 'obsolete', 'utf8');
    const storage = createAssistantStorage(dataDir, agentProfile());

    try {
      await storage.ensureReady();
      await expect(readFile(join(staleSkillDir, 'SKILL.md'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      storage.close();
    }
  });
});

function agentProfile(): AgentProfile {
  const now = '2026-07-17T00:00:00.000Z';
  return {
    id: 'albert',
    name: 'Albert',
    kind: 'chat',
    chatEnabled: true,
    enabledCapabilities: ['web_search'],
    memory: { canRead: true, canWrite: true },
    models: { chat: 'chatgpt:gpt-5.4' },
    soulVirtualPath: '/configuration/soul.md',
    createdAt: now,
    updatedAt: now,
  };
}
