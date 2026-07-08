import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import type { RunContextDetails } from '../../shared/agent-contracts';
import { LocalDatabase } from './local-database';
import { RunContextStore } from './run-context-store';

describe('RunContextStore', () => {
  it('stores new run contexts under the owning agent', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runs-'));

    try {
      const store = new RunContextStore(dataDir);
      const context = testRunContext({
        agentId: 'ronaldo',
      });

      await store.writeRunContext(context);

      await expect(store.readRunContext(context.runId)).resolves.toMatchObject({
        runId: context.runId,
        agentId: 'ronaldo',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('migrates legacy global runs to their owning agent and removes the global folder', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runs-'));

    try {
      const runId = crypto.randomUUID();
      const context = testRunContext({
        runId,
        agentId: 'ronaldo',
      });
      await mkdir(join(dataDir, 'runs'), { recursive: true });
      await writeFile(join(dataDir, 'runs', `${runId}.json`), JSON.stringify(context), 'utf8');

      const store = new RunContextStore(dataDir);
      await store.ensureReady();

      await expect(store.readRunContext(runId)).resolves.toMatchObject({
        runId,
        agentId: 'ronaldo',
      });
      await expect(stat(join(dataDir, 'runs'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes all run contexts for a deleted thread without touching other runs', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runs-'));

    try {
      const store = new RunContextStore(dataDir);
      const threadId = crypto.randomUUID();
      const deletedRun = testRunContext({
        agentId: 'ronaldo',
        threadId,
      });
      const keptRun = testRunContext({
        agentId: 'ronaldo',
        threadId: crypto.randomUUID(),
      });
      await store.writeRunContext(deletedRun);
      await store.writeRunContext(keptRun);

      await expect(store.deleteRunsForThread('ronaldo', threadId)).resolves.toBe(1);
      await expect(store.readRunContext(deletedRun.runId)).resolves.toBeNull();
      await expect(store.readRunContext(keptRun.runId)).resolves.toMatchObject({
        runId: keptRun.runId,
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('reads the latest run context for one thread', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runs-'));

    try {
      const store = new RunContextStore(dataDir);
      const threadId = crypto.randomUUID();
      const olderRun = testRunContext({
        agentId: 'ronaldo',
        threadId,
        createdAt: '2026-07-08T10:00:00.000Z',
      });
      const latestRun = testRunContext({
        agentId: 'ronaldo',
        threadId,
        createdAt: '2026-07-08T11:00:00.000Z',
      });
      const otherThreadRun = testRunContext({
        agentId: 'ronaldo',
        threadId: crypto.randomUUID(),
        createdAt: '2026-07-08T12:00:00.000Z',
      });

      await store.writeRunContext(olderRun);
      await store.writeRunContext(latestRun);
      await store.writeRunContext(otherThreadRun);

      await expect(store.readLatestRunContextForThread('ronaldo', threadId)).resolves.toMatchObject(
        {
          runId: latestRun.runId,
        },
      );
      await expect(store.listRunContextsForThread('ronaldo', threadId)).resolves.toEqual([
        latestRun,
        olderRun,
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes orphaned run contexts whose threads no longer exist', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runs-'));

    try {
      const store = new RunContextStore(dataDir);
      const existingThreadId = crypto.randomUUID();
      const keptRun = testRunContext({
        agentId: 'ronaldo',
        threadId: existingThreadId,
      });
      const deletedRun = testRunContext({
        agentId: 'ronaldo',
        threadId: crypto.randomUUID(),
      });
      const database = new LocalDatabase(dataDir);
      await database.ensureReady();
      database
        .get()
        .prepare(
          `
            insert into threads (id, agent_id, title, created_at, updated_at)
            values (?, ?, ?, ?, ?)
          `,
        )
        .run(
          existingThreadId,
          'ronaldo',
          'Existing thread',
          new Date().toISOString(),
          new Date().toISOString(),
        );
      await store.writeRunContext(keptRun);
      await store.writeRunContext(deletedRun);

      await expect(store.deleteOrphanedRuns()).resolves.toBe(1);
      await expect(store.readRunContext(deletedRun.runId)).resolves.toBeNull();
      await expect(store.readRunContext(keptRun.runId)).resolves.toMatchObject({
        runId: keptRun.runId,
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

function testRunContext(overrides: Partial<RunContextDetails> = {}): RunContextDetails {
  const now = new Date().toISOString();

  return {
    runId: crypto.randomUUID(),
    agentId: 'scotty',
    agentName: 'Scotty',
    threadId: crypto.randomUUID(),
    threadTitle: 'Test thread',
    model: 'gpt-5.4-mini',
    createdAt: now,
    prompt: 'Hello',
    assistantResponse: 'Hi',
    soulVirtualPath: '/configuration/soul.md',
    soulContent: '# soul',
    userProfile: {
      name: '',
      timeZone: 'Europe/Berlin',
      language: 'en',
      locale: 'en-US',
      dateStyle: 'medium',
      timeStyle: 'short',
      theme: 'system',
      agentSettings: {},
      createdAt: now,
      updatedAt: now,
    },
    memories: [],
    messages: [],
    tools: [],
    memoryWritesEnabled: true,
    ...overrides,
  };
}
