import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssistantRuntime } from './runtime';

describe('AssistantRuntime memory behavior', () => {
  it('respects per-agent memory write permissions and persists run context', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));
    const previousApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();
      await runtime.updateAgent('scotty', {
        memory: {
          canWrite: false,
        },
      });
      const thread = await runtime.createThread('scotty', {
        title: 'Memory disabled',
      });
      const result = await runtime.runAgent({
        agentId: 'scotty',
        threadId: thread.id,
        model: 'gpt-4.1-mini',
        prompt: 'Remember that I prefer short answers.',
      });
      const memories = await runtime.listMemories({
        agentId: 'scotty',
        type: 'conversation_summary',
      });
      const context = await runtime.readRunContext(result.runId);

      expect(memories.memories).toHaveLength(0);
      expect(context.memoryWritesEnabled).toBe(false);
      expect(context.tools.map((tool) => tool.id)).not.toContain('save_memory');
      expect(context.tools).toContainEqual({
        id: 'admin_list_memories',
        label: 'List memories',
        description: 'List memories across scopes or for a specific agent.',
        provider: 'rdma26-admin',
        controlled: true,
      });
      expect(context.tools).toContainEqual({
        id: 'admin_set_agent_memory_writes',
        label: 'Set memory writes',
        description: 'Enable or disable memory writes for an agent.',
        provider: 'rdma26-admin',
        controlled: true,
      });
      expect(context.threadTitle).toBe('Memory disabled');
      expect(context.prompt).toBe('Remember that I prefer short answers.');
      expect(context.assistantResponse).toBeTruthy();
      expect(context.messages.at(-1)?.content).toBe('Remember that I prefer short answers.');
    } finally {
      if (previousApiKey === undefined) {
        delete process.env['OPENAI_API_KEY'];
      } else {
        process.env['OPENAI_API_KEY'] = previousApiKey;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('retrieves the previous thread summary for recall questions in a new thread', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));
    const previousApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();
      const firstThread = await runtime.createThread('scotty', {
        title: 'Brazil Norway tracking',
      });
      await runtime.runAgent({
        agentId: 'scotty',
        threadId: firstThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'Please track the Brazil versus Norway game for me.',
      });
      const summary = await runtime.createMemory({
        scope: 'agent',
        agentId: 'scotty',
        type: 'conversation_summary',
        content: 'The user asked Scotty to track the Brazil versus Norway game.',
        tags: ['thread-summary'],
        source: {
          agentId: 'scotty',
          threadId: firstThread.id,
        },
      });
      const secondThread = await runtime.createThread('scotty', {
        title: 'Recall',
      });
      const recallRun = await runtime.runAgent({
        agentId: 'scotty',
        threadId: secondThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'What did we talk about last time?',
      });
      const context = await runtime.readRunContext(recallRun.runId);

      expect(context.memories.some((memory) => memory.type === 'conversation_summary')).toBe(true);
      expect(context.memories.map((memory) => memory.content).join('\n')).toContain(
        'Brazil versus Norway',
      );
      const summaryMemory = context.memories.find(
        (memory) => memory.type === 'conversation_summary',
      );
      expect(summaryMemory?.lifetime).toBe('active');
      expect(summaryMemory?.status).toBe('active');
      expect(summaryMemory?.tags).toContain('thread-summary');
      expect(summaryMemory?.source?.threadId).toBe(firstThread.id);
      expect(summaryMemory?.memoryId).toBe(summary.id);
    } finally {
      if (previousApiKey === undefined) {
        delete process.env['OPENAI_API_KEY'];
      } else {
        process.env['OPENAI_API_KEY'] = previousApiKey;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('does not create thread summaries when no LLM is configured', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));
    const previousApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();
      const thread = await runtime.createThread('scotty', {
        title: 'Manual summary',
      });
      await runtime.runAgent({
        agentId: 'scotty',
        threadId: thread.id,
        model: 'gpt-4.1-mini',
        prompt: 'Remember that this thread should be summarized manually.',
      });
      await expect(runtime.consolidateThreadSummary('scotty', thread.id)).rejects.toThrow(
        'OPENAI_API_KEY is not configured',
      );
      await expect(
        runtime.listMemories({
          agentId: 'scotty',
          type: 'conversation_summary',
        }),
      ).resolves.toEqual({
        memories: [],
      });
    } finally {
      if (previousApiKey === undefined) {
        delete process.env['OPENAI_API_KEY'];
      } else {
        process.env['OPENAI_API_KEY'] = previousApiKey;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes thread summary memories when a thread is deleted', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();
      const thread = await runtime.createThread('scotty', {
        title: 'Delete summary',
      });
      const unrelatedThread = await runtime.createThread('scotty', {
        title: 'Keep summary',
      });
      const summary = await runtime.createMemory({
        scope: 'agent',
        agentId: 'scotty',
        type: 'conversation_summary',
        content: 'This summary should be deleted with its source thread.',
        tags: ['thread-summary'],
        source: {
          agentId: 'scotty',
          threadId: thread.id,
        },
      });
      const unrelatedSummary = await runtime.createMemory({
        scope: 'agent',
        agentId: 'scotty',
        type: 'conversation_summary',
        content: 'This summary belongs to another thread.',
        tags: ['thread-summary'],
        source: {
          agentId: 'scotty',
          threadId: unrelatedThread.id,
        },
      });

      await expect(runtime.deleteThread('scotty', thread.id)).resolves.toEqual({
        deleted: true,
        agentId: 'scotty',
        threadId: thread.id,
      });

      await expect(runtime.readMemory(summary.id)).rejects.toThrow('does not exist');
      await expect(runtime.readMemory(unrelatedSummary.id)).resolves.toMatchObject({
        id: unrelatedSummary.id,
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('bulk consolidation requires an LLM for non-empty threads', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));
    const previousApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();
      const firstThread = await runtime.createThread('scotty', {
        title: 'Bulk summary one',
      });
      const emptyThread = await runtime.createThread('scotty', {
        title: 'Bulk summary empty',
      });
      await runtime.runAgent({
        agentId: 'scotty',
        threadId: firstThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This non-empty thread should be bulk summarized.',
      });
      await expect(runtime.consolidateAgentThreadSummaries('scotty')).rejects.toThrow(
        'OPENAI_API_KEY is not configured',
      );
    } finally {
      if (previousApiKey === undefined) {
        delete process.env['OPENAI_API_KEY'];
      } else {
        process.env['OPENAI_API_KEY'] = previousApiKey;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('runs visible memory maintenance and skips agents with memory writes disabled', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));
    const previousApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();
      await runtime.createAgent({
        id: 'readonly',
        name: 'Readonly',
      });
      await runtime.updateAgent('readonly', {
        memory: {
          canWrite: false,
        },
      });
      const readonlyThread = await runtime.createThread('readonly', {
        title: 'Skipped maintenance thread',
      });
      await runtime.runAgent({
        agentId: 'readonly',
        threadId: readonlyThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This thread should not produce memory maintenance output.',
      });

      const result = await runtime.runMemoryMaintenance({
        agentId: 'readonly',
        limitPerAgent: 5,
      });

      expect(result.mode).toBe('manual');
      expect(result.startedAt).toBeTruthy();
      expect(result.finishedAt).toBeTruthy();
      expect(result.agents.find((agentResult) => agentResult.agentId === 'readonly')).toEqual({
        agentId: 'readonly',
        summaries: [],
        skippedEmptyThreads: [],
        skippedReason: 'memory_writes_disabled',
      });
    } finally {
      if (previousApiKey === undefined) {
        delete process.env['OPENAI_API_KEY'];
      } else {
        process.env['OPENAI_API_KEY'] = previousApiKey;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('persists memory maintenance scheduler settings', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();

      await expect(runtime.readMemoryMaintenanceSettings()).resolves.toMatchObject({
        enabled: false,
        intervalMinutes: 1440,
        limitPerAgent: 25,
      });

      const updated = await runtime.updateMemoryMaintenanceSettings({
        enabled: true,
        intervalMinutes: 60,
        agentId: 'scotty',
        limitPerAgent: 10,
      });
      const reloaded = await new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      }).readMemoryMaintenanceSettings();

      expect(updated).toMatchObject({
        enabled: true,
        intervalMinutes: 60,
        agentId: 'scotty',
        limitPerAgent: 10,
      });
      expect(reloaded).toMatchObject({
        enabled: true,
        intervalMinutes: 60,
        agentId: 'scotty',
        limitPerAgent: 10,
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
