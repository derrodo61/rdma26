import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalDatabase } from './storage/local-database';
import { AssistantRuntime } from './runtime';

describe('AssistantRuntime memory behavior', () => {
  it('enables normal chat for the protected Cost Analyst agent', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();

      const response = await runtime.agentsResponse();
      const costAnalyst = response.agents.find((agent) => agent.id === 'cost-analyst');

      expect(costAnalyst).toMatchObject({
        id: 'cost-analyst',
        kind: 'internal',
        chatEnabled: true,
        memory: {
          canRead: false,
          canWrite: false,
        },
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('writes the Cost Analyst pricing-source-analysis skill for Deep Agents', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();

      const skillPath = join(
        dataDir,
        'agents',
        'cost-analyst',
        'deepagent',
        'skills',
        'pricing-source-analysis',
        'SKILL.md',
      );
      const skill = await readFile(skillPath, 'utf8');

      expect(skill).toContain('name: pricing-source-analysis');
      expect(skill).toContain('extract_web_content');
      expect(skill).toContain('admin_read_pricing_source_page');
      expect(skill).toContain('Do not start with general research');
      expect(skill).toContain('Use the narrowest useful mode');
      expect(skill).toContain('mode: "tables"');
      expect(skill).toContain('short-context cached input');
      expect(skill).toContain('long-context cached input');
      expect(skill).toContain('Never say a cached-input price is absent');
      expect(skill).toContain('Do not confuse long-context cached input');
      expect(skill).toContain('$6.25` is the short-context cache-write price');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

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
      expect(context.memoryReadsEnabled).toBe(true);
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
        label: 'Set memory settings',
        description: 'Enable or disable long-term memory reads and writes for an agent.',
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

  it('skips retrieved long-term memories when memory reads are disabled', async () => {
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
      await runtime.createMemory({
        scope: 'agent',
        agentId: 'scotty',
        type: 'preference',
        content: 'The user prefers pricing answers in concise bullet points.',
        tags: ['format'],
      });
      await runtime.updateAgent('scotty', {
        memory: {
          canRead: false,
          canWrite: true,
        },
      });
      const thread = await runtime.createThread('scotty', {
        title: 'Memory reads disabled',
      });
      const result = await runtime.runAgent({
        agentId: 'scotty',
        threadId: thread.id,
        model: 'gpt-4.1-mini',
        prompt: 'How should you format pricing answers?',
      });
      const context = await runtime.readRunContext(result.runId);

      expect(context.memoryReadsEnabled).toBe(false);
      expect(context.memoryWritesEnabled).toBe(true);
      expect(context.memories).toHaveLength(0);
      expect(context.tools.map((tool) => tool.id)).toContain('save_memory');
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

  it('returns an existing thread summary without creating a duplicate or calling an LLM', async () => {
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
        title: 'Already summarized',
      });
      await runtime.runAgent({
        agentId: 'scotty',
        threadId: thread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This thread already has one summary.',
      });
      const existingSummary = await runtime.createMemory({
        scope: 'agent',
        agentId: 'scotty',
        type: 'conversation_summary',
        content: 'Existing summary content.',
        tags: ['thread-summary'],
        source: {
          agentId: 'scotty',
          threadId: thread.id,
        },
      });

      await expect(runtime.consolidateThreadSummary('scotty', thread.id)).resolves.toMatchObject({
        agentId: 'scotty',
        threadId: thread.id,
        memory: {
          id: existingSummary.id,
          content: 'Existing summary content.',
        },
      });
      await expect(
        runtime.listMemories({
          agentId: 'scotty',
          type: 'conversation_summary',
        }),
      ).resolves.toMatchObject({
        memories: [
          {
            id: existingSummary.id,
          },
        ],
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

  it('does not fail new thread creation when previous-thread summary creation is unavailable', async () => {
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
      const previousThread = await runtime.createThread('scotty', {
        title: 'Previous conversation',
      });
      await runtime.runAgent({
        agentId: 'scotty',
        threadId: previousThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This previous thread has messages.',
      });
      const nextThread = await runtime.createThread('scotty', {
        title: 'Next conversation',
      });

      expect(nextThread.title).toBe('Next conversation');
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

  it('does not create a duplicate previous-thread summary when starting a new thread', async () => {
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
      const previousThread = await runtime.createThread('scotty', {
        title: 'Already summarized before leaving',
      });
      await runtime.runAgent({
        agentId: 'scotty',
        threadId: previousThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This thread already has a summary.',
      });
      const existingSummary = await runtime.createMemory({
        scope: 'agent',
        agentId: 'scotty',
        type: 'conversation_summary',
        content: 'Existing summary content.',
        tags: ['thread-summary'],
        source: {
          agentId: 'scotty',
          threadId: previousThread.id,
        },
      });

      process.env['OPENAI_API_KEY'] = 'test-key';
      await runtime.createThread('scotty', {
        title: 'New thread after summary',
      });

      await expect(
        runtime.listMemories({
          agentId: 'scotty',
          type: 'conversation_summary',
        }),
      ).resolves.toMatchObject({
        memories: [
          {
            id: existingSummary.id,
            content: 'Existing summary content.',
          },
        ],
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

  it('deletes run contexts when a thread is deleted', async () => {
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
      const deletedThread = await runtime.createThread('scotty', {
        title: 'Delete run context',
      });
      const keptThread = await runtime.createThread('scotty', {
        title: 'Keep run context',
      });
      const deletedRun = await runtime.runAgent({
        agentId: 'scotty',
        threadId: deletedThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This run should disappear with its thread.',
      });
      const keptRun = await runtime.runAgent({
        agentId: 'scotty',
        threadId: keptThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This run should remain.',
      });

      await runtime.deleteThread('scotty', deletedThread.id);

      await expect(runtime.readRunContext(deletedRun.runId)).rejects.toThrow('does not exist');
      await expect(runtime.readRunContext(keptRun.runId)).resolves.toMatchObject({
        runId: keptRun.runId,
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

  it('deletes orphaned run contexts on startup', async () => {
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
      const orphanedThread = await runtime.createThread('scotty', {
        title: 'Orphaned run context',
      });
      const keptThread = await runtime.createThread('scotty', {
        title: 'Kept run context',
      });
      const orphanedRun = await runtime.runAgent({
        agentId: 'scotty',
        threadId: orphanedThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This run should be cleaned up on startup.',
      });
      const keptRun = await runtime.runAgent({
        agentId: 'scotty',
        threadId: keptThread.id,
        model: 'gpt-4.1-mini',
        prompt: 'This run should survive startup cleanup.',
      });

      const database = new LocalDatabase(dataDir);
      await database.ensureReady();
      database.get().prepare('delete from threads where id = ?').run(orphanedThread.id);

      const restartedRuntime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await restartedRuntime.ensureReady();

      await expect(restartedRuntime.readRunContext(orphanedRun.runId)).rejects.toThrow(
        'does not exist',
      );
      await expect(restartedRuntime.readRunContext(keptRun.runId)).resolves.toMatchObject({
        runId: keptRun.runId,
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

  it('imports legacy thread JSON into SQLite once and does not resurrect deleted threads', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));
    const threadId = crypto.randomUUID();
    const rootThreadId = crypto.randomUUID();

    try {
      const legacyThreadDir = join(dataDir, 'agents', 'scotty', 'threads');
      const legacyRootThreadDir = join(dataDir, 'threads');
      await mkdir(legacyThreadDir, { recursive: true });
      await mkdir(legacyRootThreadDir, { recursive: true });
      await writeFile(
        join(legacyThreadDir, `${threadId}.json`),
        `${JSON.stringify(
          {
            id: threadId,
            agentId: 'scotty',
            title: 'Legacy thread',
            createdAt: '2026-07-08T00:00:00.000Z',
            updatedAt: '2026-07-08T00:01:00.000Z',
            messages: [
              {
                id: crypto.randomUUID(),
                role: 'user',
                content: 'Legacy hello',
                createdAt: '2026-07-08T00:01:00.000Z',
              },
            ],
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await writeFile(
        join(legacyRootThreadDir, `${rootThreadId}.json`),
        `${JSON.stringify(
          {
            id: rootThreadId,
            title: 'Legacy root thread',
            createdAt: '2026-07-08T00:02:00.000Z',
            updatedAt: '2026-07-08T00:03:00.000Z',
            messages: [
              {
                id: crypto.randomUUID(),
                role: 'user',
                content: 'Legacy root hello',
                createdAt: '2026-07-08T00:03:00.000Z',
              },
            ],
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();

      await expect(runtime.readThread('scotty', threadId)).resolves.toMatchObject({
        id: threadId,
        messageCount: 1,
        messages: [
          {
            content: 'Legacy hello',
          },
        ],
      });
      await expect(runtime.readThread('scotty', rootThreadId)).resolves.toMatchObject({
        id: rootThreadId,
        agentId: 'scotty',
        messageCount: 1,
        messages: [
          {
            content: 'Legacy root hello',
          },
        ],
      });
      await expect(stat(join(legacyThreadDir, `${threadId}.json`))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(stat(join(legacyRootThreadDir, `${rootThreadId}.json`))).rejects.toMatchObject({
        code: 'ENOENT',
      });

      await runtime.deleteThread('scotty', threadId);

      const restartedRuntime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await restartedRuntime.ensureReady();

      await expect(restartedRuntime.readThread('scotty', threadId)).rejects.toThrow(
        'does not exist',
      );
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

  it('deletes SQLite-backed thread and memory data when deleting an agent', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-memory-'));

    try {
      const runtime = new AssistantRuntime({
        dataDir,
        defaultAgentId: 'scotty',
        defaultAgentName: 'Scotty',
      });
      await runtime.ensureReady();
      await runtime.createAgent({
        id: 'ronaldo',
        name: 'Ronaldo',
      });
      const thread = await runtime.createThread('ronaldo', {
        title: 'Delete me',
      });
      await runtime.runAgent({
        agentId: 'ronaldo',
        threadId: thread.id,
        model: 'gpt-4.1-mini',
        prompt: 'Create a run context before deletion.',
      });
      await runtime.createMemory({
        scope: 'agent',
        agentId: 'ronaldo',
        type: 'fact',
        content: 'Temporary agent memory.',
      });

      await expect(runtime.deleteAgent('ronaldo')).resolves.toEqual({
        deleted: true,
        agentId: 'ronaldo',
      });

      const database = new LocalDatabase(dataDir);
      await database.ensureReady();

      expect(
        database
          .get()
          .prepare('select count(*) as count from threads where agent_id = ?')
          .get('ronaldo'),
      ).toMatchObject({
        count: 0,
      });
      expect(
        database
          .get()
          .prepare('select count(*) as count from memory_records where agent_id = ?')
          .get('ronaldo'),
      ).toMatchObject({
        count: 0,
      });
      expect(
        database
          .get()
          .prepare('select count(*) as count from run_contexts where agent_id = ?')
          .get('ronaldo'),
      ).toMatchObject({
        count: 0,
      });
    } finally {
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
