import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type {
  AgentProfile,
  ChatMessage,
  ChatThread,
  ChatThreadSummary,
  HealthResponse,
  ModelOption,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../assistant-api';

@Component({
  selector: 'app-chat-page',
  imports: [FormsModule],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.css',
})
export class ChatPage {
  private readonly api = inject(AssistantApi);

  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly selectedAgentId = signal('');
  protected readonly models = signal<readonly ModelOption[]>([]);
  protected readonly selectedModel = signal('');
  protected readonly threads = signal<readonly ChatThreadSummary[]>([]);
  protected readonly activeThread = signal<ChatThread | null>(null);
  protected readonly draft = signal('');
  protected readonly isLoading = signal(true);
  protected readonly isRunning = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly messages = computed<readonly ChatMessage[]>(
    () => this.activeThread()?.messages ?? [],
  );
  protected readonly canSend = computed(
    () =>
      Boolean(
        this.selectedAgentId() &&
        this.activeThread() &&
        this.selectedModel() &&
        this.draft().trim(),
      ) && !this.isRunning(),
  );
  protected readonly activeAgent = computed<AgentProfile | null>(
    () => this.agents().find((agent) => agent.id === this.selectedAgentId()) ?? null,
  );
  protected readonly activeSoulPath = computed(() => {
    const dataDir = this.health()?.dataDir;
    const agentId = this.selectedAgentId();

    return dataDir && agentId ? `${dataDir}/agents/${agentId}/deepagent/memories/soul.md` : '';
  });

  constructor() {
    void this.load();
  }

  protected async createThread(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    await this.handleAsync(async () => {
      const thread = await this.api.createThread(agentId);
      this.activeThread.set(thread);
      await this.refreshThreads();
    });
  }

  protected async selectThread(threadId: string): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    await this.handleAsync(async () => {
      this.activeThread.set(await this.api.readThread(agentId, threadId));
    });
  }

  protected async deleteThread(threadId: string): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId || this.isRunning()) {
      return;
    }

    const thread = this.threads().find((candidate) => candidate.id === threadId);
    const label = thread?.title ?? 'this thread';

    if (!globalThis.confirm(`Delete "${label}"? This removes the conversation history.`)) {
      return;
    }

    await this.handleAsync(async () => {
      await this.api.deleteThread(agentId, threadId);
      const threads = await this.api.listThreads(agentId);
      this.threads.set(threads);

      if (this.activeThread()?.id !== threadId) {
        return;
      }

      if (threads.length) {
        this.activeThread.set(await this.api.readThread(agentId, threads[0].id));
      } else {
        this.activeThread.set(await this.api.createThread(agentId));
        await this.refreshThreads();
      }
    });
  }

  protected async selectAgent(agentId: string): Promise<void> {
    if (!agentId || agentId === this.selectedAgentId()) {
      return;
    }

    await this.loadAgentThreads(agentId);
  }

  protected async renameSelectedAgent(): Promise<void> {
    const agent = this.activeAgent();

    if (!agent) {
      return;
    }

    const name = globalThis.prompt('Agent display name', agent.name)?.trim();

    if (!name || name === agent.name) {
      return;
    }

    await this.handleAsync(async () => {
      const updatedAgent = await this.api.updateAgent(agent.id, { name });
      const agentsResponse = await this.api.agents();
      this.agents.set(
        agentsResponse.agents.map((candidate) =>
          candidate.id === updatedAgent.id ? updatedAgent : candidate,
        ),
      );
      this.health.update((health) =>
        health
          ? {
              ...health,
              agents: health.agents.map((candidate) =>
                candidate.id === updatedAgent.id ? updatedAgent : candidate,
              ),
            }
          : health,
      );
    });
  }

  protected async send(): Promise<void> {
    const thread = this.activeThread();
    const prompt = this.draft().trim();
    const model = this.selectedModel();

    if (!thread || !prompt || !model || this.isRunning()) {
      return;
    }
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    this.draft.set('');
    this.isRunning.set(true);
    this.error.set(null);

    const optimistic: ChatThread = {
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
    this.activeThread.set(optimistic);

    try {
      await this.api.runAgent(
        {
          agentId,
          threadId: thread.id,
          prompt,
          model,
        },
        (event) => {
          if (event.type === 'thread-updated') {
            this.activeThread.set(event.thread);
            void this.refreshThreads();
          }

          if (event.type === 'error') {
            this.error.set(event.message);
          }
        },
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Agent request failed.');
    } finally {
      this.isRunning.set(false);
    }
  }

  protected updateDraft(value: string): void {
    this.draft.set(value);
  }

  protected updateModel(value: string): void {
    this.selectedModel.set(value);
  }

  protected updateAgent(value: string): void {
    void this.selectAgent(value);
  }

  protected stopThreadClick(event: Event): void {
    event.stopPropagation();
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const [health, models, agentsResponse] = await Promise.all([
        this.api.health(),
        this.api.models(),
        this.api.agents(),
      ]);
      this.health.set(health);
      this.agents.set(agentsResponse.agents);
      this.models.set(models.models);
      this.selectedModel.set(models.defaultModel);
      await this.loadAgentThreads(agentsResponse.defaultAgentId);
    });
    this.isLoading.set(false);
  }

  private async refreshThreads(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    this.threads.set(await this.api.listThreads(agentId));
  }

  private async loadAgentThreads(agentId: string): Promise<void> {
    const threads = await this.api.listThreads(agentId);
    this.selectedAgentId.set(agentId);
    this.threads.set(threads);

    if (threads.length) {
      this.activeThread.set(await this.api.readThread(agentId, threads[0].id));
    } else {
      this.activeThread.set(await this.api.createThread(agentId));
      await this.refreshThreads();
    }
  }

  private async handleAsync(work: () => Promise<void>): Promise<void> {
    try {
      this.error.set(null);
      await work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Request failed.');
    }
  }
}
