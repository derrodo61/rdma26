import { inject, Injectable, signal } from '@angular/core';

import type { ChatThread } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../assistant-api';
import type { RunActivity } from './chat-page.types';
import { ChatThreadState } from './chat-thread-state';

@Injectable()
export class ChatRunController {
  private readonly api = inject(AssistantApi);
  private readonly threadState = inject(ChatThreadState);

  readonly draft = signal('');
  readonly isRunning = signal(false);
  readonly runActivity = signal<RunActivity | null>(null);
  readonly error = signal<string | null>(null);

  updateDraft(value: string): void {
    this.draft.set(value);
  }

  clearError(): void {
    this.error.set(null);
  }

  async send(request: ChatRunUiRequest): Promise<void> {
    const prompt = this.draft().trim();

    if (!request.agentId || !request.thread || !prompt || !request.model || this.isRunning()) {
      return;
    }

    this.draft.set('');
    this.isRunning.set(true);
    this.runActivity.set({
      label: 'Starting run',
    });
    this.error.set(null);
    this.threadState.activeThread.set(optimisticThread(request.thread, prompt));

    try {
      let runFailed = false;

      await this.api.runAgent(
        {
          agentId: request.agentId,
          threadId: request.thread.id,
          prompt,
          model: request.model,
        },
        (event) => {
          if (event.type === 'thread-updated') {
            this.threadState.activeThread.set(event.thread);
            void this.threadState.refreshThreads();
          }

          if (event.type === 'run-started') {
            this.threadState.latestRunId.set(event.runId);
          }

          if (event.type === 'run-activity') {
            this.runActivity.set({
              label: event.label,
              detail: event.detail,
            });
          }

          if (event.type === 'run-finished') {
            this.threadState.latestRunId.set(event.runId);
            void this.threadState.loadMessageSourcesFromRun(event.runId);
          }

          if (event.type === 'error') {
            runFailed = true;
            this.error.set(event.message);
          }
        },
      );

      if (runFailed) {
        await this.threadState.selectThread(request.thread.id);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Agent request failed.');
      await this.threadState.selectThread(request.thread.id);
    } finally {
      this.isRunning.set(false);
      this.runActivity.set(null);
    }
  }
}

export interface ChatRunUiRequest {
  readonly agentId: string;
  readonly thread: ChatThread | null;
  readonly model: string;
}

function optimisticThread(thread: ChatThread, prompt: string): ChatThread {
  return {
    ...thread,
    messages: [
      ...thread.messages,
      {
        id: `optimistic-${Date.now()}`,
        role: 'user',
        content: prompt,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
