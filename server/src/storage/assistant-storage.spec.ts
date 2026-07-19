import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '../../../shared/agent-contracts';
import { createAssistantStorage } from './assistant-storage';

describe('AssistantStorage skill ownership', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('does not materialize bundled skills inside an agent filesystem', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-storage-'));
    temporaryDirectories.push(dataDir);
    const storage = createAssistantStorage(dataDir, {
      ...agentProfile(),
      id: 'cost-analyst',
      name: 'Cost Analyst',
      attachedSkills: ['pricing-source-analysis'],
    });

    try {
      await storage.ensureReady();
      await expect(
        access(
          join(dataDir, 'agents', 'cost-analyst', 'deepagent', 'skills', 'pricing-source-analysis'),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });
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
    attachedSkills: [],
    memory: { canRead: true, canWrite: true },
    models: { chat: 'chatgpt:gpt-5.4' },
    soulVirtualPath: '/configuration/soul.md',
    createdAt: now,
    updatedAt: now,
  };
}
