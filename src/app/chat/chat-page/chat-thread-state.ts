import { inject, Injectable, signal } from '@angular/core';

import type { ChatThread, ChatThreadSummary } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../assistant-api';
import {
  buildMessageResearchSources,
  buildMessageRunSummaries,
  mergeMessageResearchSources,
  mergeMessageRunSummary,
} from './chat-message-sources';
import type { MessageRunSummary, ResearchSourceSummary } from './chat-page.types';

@Injectable()
export class ChatThreadState {
  private readonly api = inject(AssistantApi);

  readonly selectedAgentId = signal('');
  readonly threads = signal<readonly ChatThreadSummary[]>([]);
  readonly activeThread = signal<ChatThread | null>(null);
  readonly latestRunId = signal<string | null>(null);
  readonly messageResearchSources = signal<
    Readonly<Record<string, readonly ResearchSourceSummary[]>>
  >({});
  readonly messageRunSummaries = signal<Readonly<Record<string, MessageRunSummary>>>({});

  reset(): void {
    this.selectedAgentId.set('');
    this.threads.set([]);
    this.activeThread.set(null);
    this.latestRunId.set(null);
    this.messageResearchSources.set({});
    this.messageRunSummaries.set({});
  }

  async createThread(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    const thread = await this.api.createThread(agentId);
    this.activeThread.set(thread);
    this.clearRunContext();
    await this.refreshThreads();
  }

  async selectThread(threadId: string): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    const thread = await this.api.readThread(agentId, threadId);
    this.activeThread.set(thread);
    await this.loadLatestThreadRunContext(agentId, thread.id);
  }

  async deleteThread(threadId: string): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    await this.api.deleteThread(agentId, threadId);
    const threads = await this.api.listThreads(agentId);
    this.threads.set(threads);

    if (this.activeThread()?.id !== threadId) {
      return;
    }

    if (threads.length) {
      const thread = await this.api.readThread(agentId, threads[0].id);
      this.activeThread.set(thread);
      await this.loadLatestThreadRunContext(agentId, thread.id);
      return;
    }

    this.activeThread.set(await this.api.createThread(agentId));
    this.clearRunContext();
    await this.refreshThreads();
  }

  async refreshThreads(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    this.threads.set(await this.api.listThreads(agentId));
  }

  async loadAgentThreads(agentId: string, preferredThreadId?: string): Promise<void> {
    const threads = await this.api.listThreads(agentId);
    this.selectedAgentId.set(agentId);
    this.threads.set(threads);
    this.clearRunContext();

    if (threads.length) {
      const threadId =
        preferredThreadId && threads.some((thread) => thread.id === preferredThreadId)
          ? preferredThreadId
          : threads[0].id;

      const thread = await this.api.readThread(agentId, threadId);
      this.activeThread.set(thread);
      await this.loadLatestThreadRunContext(agentId, thread.id);
      return;
    }

    this.activeThread.set(await this.api.createThread(agentId));
    this.clearRunContext();
    await this.refreshThreads();
  }

  async loadMessageSourcesFromRun(runId: string): Promise<void> {
    try {
      const runContext = await this.api.runContext(runId);
      this.latestRunId.set(runContext.runId);
      this.messageResearchSources.set(
        mergeMessageResearchSources(this.messageResearchSources(), this.activeThread(), runContext),
      );
      this.messageRunSummaries.set(
        mergeMessageRunSummary(this.messageRunSummaries(), this.activeThread(), runContext),
      );
    } catch {
      return;
    }
  }

  private async loadLatestThreadRunContext(agentId: string, threadId: string): Promise<void> {
    try {
      const runContexts = await this.api.threadRunContexts(agentId, threadId);
      this.latestRunId.set(runContexts[0]?.runId ?? null);
      this.messageResearchSources.set(
        buildMessageResearchSources(this.activeThread(), runContexts),
      );
      this.messageRunSummaries.set(buildMessageRunSummaries(this.activeThread(), runContexts));
    } catch {
      this.clearRunContext();
    }
  }

  private clearRunContext(): void {
    this.latestRunId.set(null);
    this.messageResearchSources.set({});
    this.messageRunSummaries.set({});
  }
}
