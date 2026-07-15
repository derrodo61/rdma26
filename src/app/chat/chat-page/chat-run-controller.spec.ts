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
import { ChatRunController } from './chat-run-controller';
import { ChatThreadState } from './chat-thread-state';

type ChatRunControllerApi = Pick<
  AssistantApi,
  'listThreads' | 'readThread' | 'runAgent' | 'runContext' | 'threadRunContexts'
>;

type ChatRunControllerApiMock = {
  readonly [Method in keyof ChatRunControllerApi]: MockedFunction<ChatRunControllerApi[Method]>;
};

describe('ChatRunController', () => {
  let api: ChatRunControllerApiMock;
  let controller: ChatRunController;
  let threadState: ChatThreadState;

  beforeEach(() => {
    api = createApiMock();

    TestBed.configureTestingModule({
      providers: [ChatRunController, ChatThreadState, { provide: AssistantApi, useValue: api }],
    });

    controller = TestBed.inject(ChatRunController);
    threadState = TestBed.inject(ChatThreadState);
    threadState.selectedAgentId.set('ronaldo');
  });

  it('runs an agent with optimistic UI state and applies stream updates', async () => {
    const initialThread = thread('thread-1', [message('user-1', 'user', 'Earlier')]);
    const updatedThread = thread('thread-1', [
      ...initialThread.messages,
      message('user-2', 'user', 'Hello'),
      message('assistant-1', 'assistant', 'Hi'),
    ]);

    controller.updateDraft('  Hello  ');
    threadState.activeThread.set(initialThread);
    api.listThreads.mockResolvedValueOnce([threadSummary('thread-1')]);
    api.runContext.mockResolvedValueOnce(
      runContextDetails({
        runId: 'run-1',
        threadId: 'thread-1',
        assistantMessageId: 'assistant-1',
      }),
    );
    api.runAgent.mockImplementationOnce(async (_request, onEvent) => {
      onEvent({ type: 'run-started', runId: 'run-1', threadId: 'thread-1' });
      expect(controller.isRunning()).toBe(true);
      expect(threadState.activeThread()?.messages.at(-1)).toMatchObject({
        role: 'user',
        content: 'Hello',
      });

      onEvent({ type: 'run-activity', label: 'Thinking', detail: 'Planning' });
      onEvent({ type: 'thread-updated', thread: updatedThread });
      onEvent({ type: 'run-finished', runId: 'run-1', threadId: 'thread-1' });
    });

    await controller.send({
      agentId: 'ronaldo',
      thread: initialThread,
      model: 'gpt-test',
    });
    await Promise.resolve();

    expect(api.runAgent).toHaveBeenCalledWith(
      {
        agentId: 'ronaldo',
        threadId: 'thread-1',
        prompt: 'Hello',
        model: 'gpt-test',
      },
      expect.any(Function),
    );
    expect(controller.draft()).toBe('');
    expect(controller.isRunning()).toBe(false);
    expect(controller.runActivity()).toBeNull();
    expect(controller.error()).toBeNull();
    expect(threadState.activeThread()).toEqual(updatedThread);
    expect(threadState.latestRunId()).toBe('run-1');
    expect(api.listThreads).toHaveBeenCalledWith('ronaldo');
  });

  it('reloads the thread when the stream reports an error', async () => {
    const initialThread = thread('thread-1');
    const reloadedThread = thread('thread-1', [message('user-1', 'user', 'Persisted')]);

    controller.updateDraft('Hello');
    threadState.activeThread.set(initialThread);
    api.runAgent.mockImplementationOnce(async (_request, onEvent) => {
      onEvent({ type: 'error', message: 'Model failed.' });
    });
    api.readThread.mockResolvedValueOnce(reloadedThread);
    api.threadRunContexts.mockResolvedValueOnce([]);

    await controller.send({
      agentId: 'ronaldo',
      thread: initialThread,
      model: 'gpt-test',
    });

    expect(controller.error()).toBe('Model failed.');
    expect(threadState.activeThread()).toEqual(reloadedThread);
    expect(api.readThread).toHaveBeenCalledWith('ronaldo', 'thread-1');
  });

  it('reloads the thread when the stream request throws', async () => {
    const initialThread = thread('thread-1');
    const reloadedThread = thread('thread-1', [message('user-1', 'user', 'Persisted')]);

    controller.updateDraft('Hello');
    threadState.activeThread.set(initialThread);
    api.runAgent.mockRejectedValueOnce(new Error('Network failed.'));
    api.readThread.mockResolvedValueOnce(reloadedThread);
    api.threadRunContexts.mockResolvedValueOnce([]);

    await controller.send({
      agentId: 'ronaldo',
      thread: initialThread,
      model: 'gpt-test',
    });

    expect(controller.error()).toBe('Network failed.');
    expect(controller.isRunning()).toBe(false);
    expect(controller.runActivity()).toBeNull();
    expect(threadState.activeThread()).toEqual(reloadedThread);
  });
});

function createApiMock(): ChatRunControllerApiMock {
  return {
    listThreads: vi.fn<AssistantApi['listThreads']>(),
    readThread: vi.fn<AssistantApi['readThread']>(),
    runAgent: vi.fn<AssistantApi['runAgent']>(),
    runContext: vi.fn<AssistantApi['runContext']>(),
    threadRunContexts: vi.fn<AssistantApi['threadRunContexts']>(),
  };
}

function threadSummary(id: string): ChatThreadSummary {
  return {
    id,
    agentId: 'ronaldo',
    title: id,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
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
    createdAt: '2026-07-15T00:00:00.000Z',
  };
}

function runContextDetails(overrides: Partial<RunContextDetails> = {}): RunContextDetails {
  return {
    runId: 'run',
    agentId: 'ronaldo',
    agentName: 'Ronaldo',
    threadId: 'thread',
    model: 'gpt-test',
    createdAt: '2026-07-15T00:00:00.000Z',
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
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}
