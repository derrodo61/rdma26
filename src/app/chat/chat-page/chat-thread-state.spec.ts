import { TestBed } from '@angular/core/testing';
import { vi, type MockedFunction } from 'vitest';

import type {
  ChatMessage,
  ChatThread,
  ChatThreadSummary,
  RunContextDetails,
  UserProfile,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../assistant-api';
import { ChatThreadState } from './chat-thread-state';

type ChatThreadStateApi = Pick<
  AssistantApi,
  | 'createThread'
  | 'deleteThread'
  | 'listThreads'
  | 'readThread'
  | 'runContext'
  | 'threadRunContexts'
  | 'updateThread'
>;

type ChatThreadStateApiMock = {
  readonly [Method in keyof ChatThreadStateApi]: MockedFunction<ChatThreadStateApi[Method]>;
};

describe('ChatThreadState', () => {
  let api: ChatThreadStateApiMock;
  let state: ChatThreadState;

  beforeEach(() => {
    api = createApiMock();

    TestBed.configureTestingModule({
      providers: [ChatThreadState, { provide: AssistantApi, useValue: api }],
    });

    state = TestBed.inject(ChatThreadState);
  });

  it('loads the preferred thread when it belongs to the selected agent', async () => {
    const firstSummary = threadSummary('first');
    const preferredSummary = threadSummary('preferred');
    const preferredThread = thread('preferred');

    api.listThreads.mockResolvedValueOnce([firstSummary, preferredSummary]);
    api.readThread.mockResolvedValueOnce(preferredThread);
    api.threadRunContexts.mockResolvedValueOnce([]);

    await state.loadAgentThreads('ronaldo', 'preferred');

    expect(state.selectedAgentId()).toBe('ronaldo');
    expect(state.threads()).toEqual([firstSummary, preferredSummary]);
    expect(state.activeThread()).toEqual(preferredThread);
    expect(state.latestRunId()).toBeNull();
    expect(api.readThread).toHaveBeenCalledWith('ronaldo', 'preferred');
  });

  it('creates an initial thread when an agent has no threads yet', async () => {
    const createdThread = thread('created');
    const createdSummary = threadSummary('created');

    api.listThreads.mockResolvedValueOnce([]).mockResolvedValueOnce([createdSummary]);
    api.createThread.mockResolvedValueOnce(createdThread);

    await state.loadAgentThreads('ronaldo');

    expect(state.selectedAgentId()).toBe('ronaldo');
    expect(state.activeThread()).toEqual(createdThread);
    expect(state.threads()).toEqual([createdSummary]);
    expect(state.latestRunId()).toBeNull();
    expect(state.messageResearchSources()).toEqual({});
    expect(state.messageRunSummaries()).toEqual({});
    expect(api.createThread).toHaveBeenCalledWith('ronaldo');
  });

  it('selects the next thread after deleting the active thread', async () => {
    const remainingSummary = threadSummary('remaining');
    const remainingThread = thread('remaining');

    state.selectedAgentId.set('ronaldo');
    state.activeThread.set(thread('deleted'));

    api.deleteThread.mockResolvedValueOnce({
      deleted: true,
      agentId: 'ronaldo',
      threadId: 'deleted',
    });
    api.listThreads.mockResolvedValueOnce([remainingSummary]);
    api.readThread.mockResolvedValueOnce(remainingThread);
    api.threadRunContexts.mockResolvedValueOnce([]);

    await state.deleteThread('deleted');

    expect(api.deleteThread).toHaveBeenCalledWith('ronaldo', 'deleted');
    expect(state.threads()).toEqual([remainingSummary]);
    expect(state.activeThread()).toEqual(remainingThread);
    expect(api.readThread).toHaveBeenCalledWith('ronaldo', 'remaining');
  });

  it('creates a replacement thread after deleting the last active thread', async () => {
    const replacementThread = thread('replacement');
    const replacementSummary = threadSummary('replacement');

    state.selectedAgentId.set('ronaldo');
    state.activeThread.set(thread('deleted'));
    state.latestRunId.set('old-run');
    state.messageResearchSources.set({
      old: [{ url: 'https://old.example/source', title: 'Old source', domain: 'old.example' }],
    });
    state.messageRunSummaries.set({
      old: { model: 'gpt-old', costs: [{ amount: 0.01, currency: 'USD' }] },
    });

    api.deleteThread.mockResolvedValueOnce({
      deleted: true,
      agentId: 'ronaldo',
      threadId: 'deleted',
    });
    api.listThreads.mockResolvedValueOnce([]).mockResolvedValueOnce([replacementSummary]);
    api.createThread.mockResolvedValueOnce(replacementThread);

    await state.deleteThread('deleted');

    expect(state.activeThread()).toEqual(replacementThread);
    expect(state.threads()).toEqual([replacementSummary]);
    expect(state.latestRunId()).toBeNull();
    expect(state.messageResearchSources()).toEqual({});
    expect(state.messageRunSummaries()).toEqual({});
  });

  it('renames a thread in the list and active conversation', async () => {
    const originalThread = thread('thread-1');
    const renamedThread = { ...originalThread, title: 'Project planning' };
    state.selectedAgentId.set('ronaldo');
    state.threads.set([originalThread]);
    state.activeThread.set(originalThread);
    api.updateThread.mockResolvedValueOnce(renamedThread);

    await state.renameThread(originalThread.id, renamedThread.title);

    expect(api.updateThread).toHaveBeenCalledWith('ronaldo', 'thread-1', 'Project planning');
    expect(state.threads()).toEqual([renamedThread]);
    expect(state.activeThread()).toEqual(renamedThread);
  });

  it('attaches research sources from a run to the matching assistant message', async () => {
    const assistantMessage = message('assistant-1', 'assistant', 'The answer.');
    const activeThread = thread('thread-1', [
      message('user-1', 'user', 'Question?'),
      assistantMessage,
    ]);
    const runContext = runContextDetails({
      runId: 'run-1',
      assistantMessageId: assistantMessage.id,
      threadId: activeThread.id,
      assistantResponse: assistantMessage.content,
      toolCalls: [
        {
          name: 'web_search',
          result: JSON.stringify({
            answerSourceUrls: ['https://example.com/article'],
            sources: [{ url: 'https://example.com/article', title: 'Example article' }],
          }),
        },
      ],
      llmCalls: [
        {
          id: 'call-1',
          runId: 'run-1',
          provider: 'openai-chatgpt',
          model: 'gpt-5.4',
          purpose: 'chat',
          status: 'success',
          requestStartedAt: '2026-07-08T00:00:00.000Z',
          estimatedTotalCost: 0.125,
          estimatedCostCurrency: 'USD',
        },
        {
          id: 'call-2',
          runId: 'run-1',
          provider: 'openai-chatgpt',
          model: 'gpt-5.4',
          purpose: 'chat',
          status: 'success',
          requestStartedAt: '2026-07-08T00:00:00.000Z',
          estimatedTotalCost: 0.25,
          estimatedCostCurrency: 'USD',
        },
      ],
    });

    state.activeThread.set(activeThread);
    api.runContext.mockResolvedValueOnce(runContext);

    await state.loadMessageSourcesFromRun('run-1');

    expect(state.latestRunId()).toBe('run-1');
    expect(state.messageResearchSources()).toEqual({
      [assistantMessage.id]: [
        {
          url: 'https://example.com/article',
          title: 'Example article',
          domain: 'example.com',
        },
      ],
    });
    expect(state.messageRunSummaries()).toEqual({
      [assistantMessage.id]: {
        model: 'gpt-5.4-mini',
        costs: [{ amount: 0.375, currency: 'USD' }],
      },
    });
  });
});

function createApiMock(): ChatThreadStateApiMock {
  return {
    createThread: vi.fn<AssistantApi['createThread']>(),
    deleteThread: vi.fn<AssistantApi['deleteThread']>(),
    listThreads: vi.fn<AssistantApi['listThreads']>(),
    readThread: vi.fn<AssistantApi['readThread']>(),
    runContext: vi.fn<AssistantApi['runContext']>(),
    threadRunContexts: vi.fn<AssistantApi['threadRunContexts']>(),
    updateThread: vi.fn<AssistantApi['updateThread']>(),
  };
}

function threadSummary(id: string): ChatThreadSummary {
  return {
    id,
    agentId: 'ronaldo',
    title: id,
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    messageCount: 0,
  };
}

function thread(id: string, messages: readonly ChatMessage[] = []): ChatThread {
  return {
    ...threadSummary(id),
    messageCount: messages.length,
    messages,
  };
}

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: '2026-07-08T00:00:00.000Z',
  };
}

function runContextDetails(overrides: Partial<RunContextDetails> = {}): RunContextDetails {
  return {
    runId: 'run',
    agentId: 'ronaldo',
    agentName: 'Ronaldo',
    threadId: 'thread',
    model: 'gpt-5.4-mini',
    createdAt: '2026-07-08T00:00:00.000Z',
    soulVirtualPath: '/configuration/soul.md',
    soulContent: '',
    userProfile: userProfile(),
    memories: [],
    messages: [],
    tools: [],
    memoryReadsEnabled: true,
    memoryWritesEnabled: true,
    ...overrides,
  };
}

function userProfile(): UserProfile {
  return {
    name: '',
    timeZone: 'Europe/Berlin',
    language: 'de',
    locale: 'de-DE',
    dateStyle: 'medium',
    timeStyle: 'short',
    theme: 'system',
    agentSettings: {},
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  };
}
