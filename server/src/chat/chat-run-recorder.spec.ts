import { describe, expect, it, vi } from 'vitest';

import type { LlmCallRecord, RunContextDetails } from '../../../shared/agent-contracts';
import type { FileMemoryStore } from '../memory/file-memory-store';
import type { RunContextStore } from '../runs/run-context-store';
import type { AssistantStorage } from '../storage/assistant-storage';
import { ChatRunRecorder, type ChatRunRecordingContext } from './chat-run-recorder';

describe('ChatRunRecorder', () => {
  it('records successful runs with response, message id, memory context, and token totals', async () => {
    const writeRunContext = vi.fn(async (context: RunContextDetails) => context);
    const recorder = new ChatRunRecorder(
      { writeRunContext } as unknown as RunContextStore,
      { virtualPath: (memory) => `/memory/${memory.id}.md` } as FileMemoryStore,
    );
    const context = recordingContext();

    const recorded = await recorder.recordSuccess(
      context,
      {
        content: 'Answer',
        usedFallback: false,
        toolCalls: [{ name: 'read_file', args: { file_path: '/skills/web/SKILL.md' } }],
        skillsUsed: [{ name: 'web', path: '/skills/web/SKILL.md' }],
      },
      {
        ...context.userThread,
        title: 'Answered thread',
        messages: [
          ...context.userThread.messages,
          {
            id: 'assistant-message',
            role: 'assistant',
            content: 'Answer',
            createdAt: '2026-07-15T08:00:01.000Z',
          },
        ],
      },
      [llmCall({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 3 })],
    );

    expect(recorded).toMatchObject({
      status: 'success',
      runId: 'run-1',
      threadTitle: 'Answered thread',
      assistantResponse: 'Answer',
      assistantMessageId: 'assistant-message',
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 3,
      },
      memories: [
        {
          memoryId: 'memory-1',
          virtualPath: '/memory/memory-1.md',
          access: 'startup',
        },
      ],
    });
    expect(writeRunContext).toHaveBeenCalledWith(recorded);
  });

  it('records failed runs without assistant output', async () => {
    const writeRunContext = vi.fn(async (context: RunContextDetails) => context);
    const recorder = new ChatRunRecorder(
      { writeRunContext } as unknown as RunContextStore,
      { virtualPath: (memory) => `/memory/${memory.id}.md` } as FileMemoryStore,
    );

    const recorded = await recorder.recordFailure(
      recordingContext(),
      new Error('model failed'),
      [llmCall({ inputTokens: 7 })],
      'error',
    );

    expect(recorded).toMatchObject({
      status: 'error',
      errorMessage: 'model failed',
      tokenUsage: {
        inputTokens: 7,
        outputTokens: 0,
        totalTokens: 7,
      },
    });
    expect(recorded.assistantResponse).toBeUndefined();
    expect(recorded.assistantMessageId).toBeUndefined();
  });
});

function recordingContext(): ChatRunRecordingContext {
  const now = '2026-07-15T08:00:00.000Z';

  return {
    runId: 'run-1',
    storage: {
      agent: {
        id: 'scotty',
        name: 'Scotty',
        soulVirtualPath: '/configuration/soul.md',
      },
    } as AssistantStorage,
    request: {
      agentId: 'scotty',
      threadId: 'thread-1',
      prompt: 'Question?',
      model: 'gpt-test',
    },
    userThread: {
      id: 'thread-1',
      agentId: 'scotty',
      title: 'Question?',
      createdAt: now,
      updatedAt: now,
      messageCount: 1,
      messages: [
        {
          id: 'user-message',
          role: 'user',
          content: 'Question?',
          createdAt: now,
        },
      ],
    },
    model: 'gpt-test',
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
    pinnedMemories: [
      {
        id: 'memory-1',
        scope: 'agent',
        agentId: 'scotty',
        pinned: true,
        content: 'Remember this.',
        tags: ['test'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    tools: [],
    memoryReadsEnabled: true,
    memoryWritesEnabled: true,
  };
}

function llmCall(overrides: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return {
    id: crypto.randomUUID(),
    runId: 'run-1',
    provider: 'openai',
    model: 'gpt-test',
    purpose: 'chat',
    status: 'success',
    requestStartedAt: '2026-07-15T08:00:00.000Z',
    ...overrides,
  };
}
