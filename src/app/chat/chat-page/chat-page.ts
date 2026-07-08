import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  lucideArrowUp,
  lucideMonitor,
  lucideMoon,
  lucidePanelLeftClose,
  lucidePanelLeftOpen,
  lucidePlus,
  lucideSettings,
  lucideSun,
  lucideTrash2,
} from '@ng-icons/lucide';

import type {
  AgentProfile,
  AuthSessionResponse,
  ChatMessage,
  ChatThread,
  ChatThreadSummary,
  HealthResponse,
  ModelOption,
  ThemePreference,
} from '../../../../shared/agent-contracts';
import { AgentSettingsStorage } from '../../settings/agent-settings-storage';
import { ThemePreferenceService } from '../../settings/theme-preference';
import { UserProfileSyncService } from '../../settings/user-profile-sync';
import type { SelectOption } from '../../shared/app-select/app-select';
import { renderMarkdown } from '../../shared/markdown/render-markdown';
import { AssistantApi } from '../assistant-api';
import { ChatComposer } from '../components/chat-composer/chat-composer';
import { ChatLogin } from '../components/chat-login/chat-login';
import { ChatMessageList } from '../components/chat-message-list/chat-message-list';
import { ChatSidebar } from '../components/chat-sidebar/chat-sidebar';
import { buildMessageResearchSources, mergeMessageResearchSources } from './chat-message-sources';
import type { RenderedChatMessage, ResearchSourceSummary, RunActivity } from './chat-page.types';

@Component({
  selector: 'app-chat-page',
  imports: [ChatComposer, ChatLogin, ChatMessageList, ChatSidebar],
  providers: [
    provideIcons({
      lucideArrowUp,
      lucideMonitor,
      lucideMoon,
      lucidePanelLeftClose,
      lucidePanelLeftOpen,
      lucidePlus,
      lucideSettings,
      lucideSun,
      lucideTrash2,
    }),
  ],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.css',
})
export class ChatPage {
  private readonly api = inject(AssistantApi);
  private readonly agentSettingsStorage = inject(AgentSettingsStorage);
  private readonly route = inject(ActivatedRoute);
  private readonly themePreference = inject(ThemePreferenceService);
  private readonly userProfileSync = inject(UserProfileSyncService);
  private defaultModelId = '';

  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly session = signal<AuthSessionResponse | null>(null);
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly selectedAgentId = signal('');
  protected readonly models = signal<readonly ModelOption[]>([]);
  protected readonly selectedModel = signal('');
  protected readonly threads = signal<readonly ChatThreadSummary[]>([]);
  protected readonly activeThread = signal<ChatThread | null>(null);
  protected readonly latestRunId = signal<string | null>(null);
  protected readonly messageResearchSources = signal<
    Readonly<Record<string, readonly ResearchSourceSummary[]>>
  >({});
  protected readonly summaryMessage = signal<string | null>(null);
  protected readonly runActivity = signal<RunActivity | null>(null);
  protected readonly draft = signal('');
  protected readonly isLoading = signal(true);
  protected readonly isRunning = signal(false);
  protected readonly isConsolidatingSummary = signal(false);
  protected readonly isSidebarCollapsed = signal(false);
  protected readonly isSettingsMenuOpen = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loginError = signal<string | null>(null);
  protected readonly theme = this.themePreference.theme;

  protected readonly messages = computed<readonly ChatMessage[]>(
    () => this.activeThread()?.messages ?? [],
  );
  protected readonly renderedMessages = computed<readonly RenderedChatMessage[]>(() =>
    this.messages().map((message) => ({
      ...message,
      renderedContent: message.role === 'assistant' ? renderMarkdown(message.content) : '',
    })),
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
  protected readonly canConsolidateSummary = computed(
    () =>
      Boolean(this.selectedAgentId() && this.activeThread()?.messages.length) &&
      !this.isRunning() &&
      !this.isConsolidatingSummary(),
  );
  protected readonly activeAgent = computed<AgentProfile | null>(
    () => this.agents().find((agent) => agent.id === this.selectedAgentId()) ?? null,
  );
  protected readonly chatAgents = computed<readonly AgentProfile[]>(() =>
    this.agents().filter((agent) => agent.chatEnabled),
  );
  protected readonly agentOptions = computed<readonly SelectOption[]>(() =>
    this.chatAgents().map((agent) => ({
      value: agent.id,
      label: agent.name,
    })),
  );
  protected readonly modelOptions = computed<readonly SelectOption[]>(() =>
    this.models().map((model) => ({
      value: model.id,
      label: model.label,
    })),
  );
  protected readonly activeSoulPath = computed(() => {
    const dataDir = this.health()?.dataDir;
    const agentId = this.selectedAgentId();

    return dataDir && agentId ? `${dataDir}/agents/${agentId}/configuration/soul.md` : '';
  });

  constructor() {
    void this.load();
  }

  protected async login(): Promise<void> {
    const username = this.username().trim();
    const password = this.password();

    if (!username || !password) {
      this.loginError.set('Username and password are required.');
      return;
    }

    try {
      this.loginError.set(null);
      this.session.set(await this.api.login(username, password));
      this.password.set('');
      await this.loadAppData();
    } catch (error) {
      this.loginError.set(getErrorMessage(error, 'Login failed.'));
    }
  }

  protected async logout(): Promise<void> {
    this.closeSettingsMenu();
    await this.api.logout();
    this.session.set(await this.api.session());
    this.health.set(null);
    this.agents.set([]);
    this.threads.set([]);
    this.activeThread.set(null);
  }

  protected async createThread(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    await this.handleAsync(async () => {
      const thread = await this.api.createThread(agentId);
      this.activeThread.set(thread);
      this.latestRunId.set(null);
      this.messageResearchSources.set({});
      await this.refreshThreads();
    });
  }

  protected async selectThread(threadId: string): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    await this.handleAsync(async () => {
      const thread = await this.api.readThread(agentId, threadId);
      this.activeThread.set(thread);
      await this.loadLatestThreadRunContext(agentId, thread.id);
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
        const thread = await this.api.readThread(agentId, threads[0].id);
        this.activeThread.set(thread);
        await this.loadLatestThreadRunContext(agentId, thread.id);
      } else {
        this.activeThread.set(await this.api.createThread(agentId));
        this.latestRunId.set(null);
        this.messageResearchSources.set({});
        await this.refreshThreads();
      }
    });
  }

  protected async selectAgent(agentId: string): Promise<void> {
    if (!agentId || agentId === this.selectedAgentId()) {
      return;
    }

    await this.loadAgentThreads(agentId);
    void this.userProfileSync.updateLastAgent(agentId);
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
    this.runActivity.set({
      label: 'Starting run',
    });
    this.error.set(null);
    this.summaryMessage.set(null);

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

          if (event.type === 'run-started') {
            this.latestRunId.set(event.runId);
          }

          if (event.type === 'run-activity') {
            this.runActivity.set({
              label: event.label,
              detail: event.detail,
            });
          }

          if (event.type === 'run-finished') {
            this.latestRunId.set(event.runId);
            void this.loadMessageSourcesFromRun(event.runId);
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
      this.runActivity.set(null);
    }
  }

  protected async consolidateActiveThreadSummary(): Promise<void> {
    const agentId = this.selectedAgentId();
    const thread = this.activeThread();

    if (!agentId || !thread || !this.canConsolidateSummary()) {
      return;
    }

    try {
      this.isConsolidatingSummary.set(true);
      const response = await this.api.consolidateThreadSummary(agentId, thread.id, {
        model: this.selectedModel() || undefined,
      });
      const model = response.model ? ` using ${response.model}` : '';
      this.summaryMessage.set(`Thread memory updated${model}: ${response.memory.id}`);
    } catch (error) {
      this.error.set(getErrorMessage(error, 'Could not consolidate thread summary.'));
    } finally {
      this.isConsolidatingSummary.set(false);
    }
  }

  protected updateDraft(value: string): void {
    this.draft.set(value);
  }

  protected updateUsername(value: string): void {
    this.username.set(value);
  }

  protected updatePassword(value: string): void {
    this.password.set(value);
  }

  protected updateModel(value: string): void {
    const agentId = this.selectedAgentId();

    this.selectedModel.set(value);

    if (agentId && this.isAvailableModel(value)) {
      void this.userProfileSync.updateAgentModel(agentId, value);
    }
  }

  protected updateTheme(value: ThemePreference): void {
    void this.userProfileSync.updateTheme(value);
  }

  protected updateAgent(value: string): void {
    this.isSettingsMenuOpen.set(false);
    void this.selectAgent(value);
  }

  protected toggleSidebar(): void {
    this.isSidebarCollapsed.update((isCollapsed) => !isCollapsed);
    this.isSettingsMenuOpen.set(false);
  }

  protected toggleSettingsMenu(): void {
    if (this.isSidebarCollapsed()) {
      this.isSidebarCollapsed.set(false);
    }

    this.isSettingsMenuOpen.update((isOpen) => !isOpen);
  }

  protected closeSettingsMenu(): void {
    this.isSettingsMenuOpen.set(false);
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const session = await this.api.session();
      this.session.set(session);

      if (session.authenticated) {
        await this.loadAppData();
      }
    });
    this.isLoading.set(false);
  }

  private async loadAppData(): Promise<void> {
    const [health, models, agentsResponse] = await Promise.all([
      this.api.health(),
      this.api.models(),
      this.api.agents(),
    ]);
    this.health.set(health);
    this.agents.set(agentsResponse.agents);
    this.models.set(models.models);
    this.defaultModelId = models.defaultModel;
    const profile = await this.userProfileSync.loadAndHydrate(agentsResponse.agents);
    const requestedAgentId = this.route.snapshot.queryParamMap.get('agentId');
    const requestedThreadId = this.route.snapshot.queryParamMap.get('threadId');
    const chatAgents = agentsResponse.agents.filter((agent) => agent.chatEnabled);
    const initialAgentId =
      requestedAgentId && chatAgents.some((agent) => agent.id === requestedAgentId)
        ? requestedAgentId
        : profile.lastAgentId && chatAgents.some((agent) => agent.id === profile.lastAgentId)
          ? profile.lastAgentId
          : (chatAgents.find((agent) => agent.id === agentsResponse.defaultAgentId)?.id ??
            chatAgents[0]?.id ??
            agentsResponse.defaultAgentId);

    await this.loadAgentThreads(initialAgentId, requestedThreadId ?? undefined);
  }

  private async refreshThreads(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    this.threads.set(await this.api.listThreads(agentId));
  }

  private async loadAgentThreads(agentId: string, preferredThreadId?: string): Promise<void> {
    const threads = await this.api.listThreads(agentId);
    this.selectedAgentId.set(agentId);
    this.selectedModel.set(this.modelForAgent(agentId));
    this.threads.set(threads);
    this.latestRunId.set(null);
    this.messageResearchSources.set({});

    if (threads.length) {
      const threadId =
        preferredThreadId && threads.some((thread) => thread.id === preferredThreadId)
          ? preferredThreadId
          : threads[0].id;

      const thread = await this.api.readThread(agentId, threadId);
      this.activeThread.set(thread);
      await this.loadLatestThreadRunContext(agentId, thread.id);
    } else {
      this.activeThread.set(await this.api.createThread(agentId));
      this.latestRunId.set(null);
      this.messageResearchSources.set({});
      await this.refreshThreads();
    }
  }

  private async loadLatestThreadRunContext(agentId: string, threadId: string): Promise<void> {
    try {
      const runContexts = await this.api.threadRunContexts(agentId, threadId);
      this.latestRunId.set(runContexts[0]?.runId ?? null);
      this.messageResearchSources.set(
        buildMessageResearchSources(this.activeThread(), runContexts),
      );
    } catch {
      this.latestRunId.set(null);
      this.messageResearchSources.set({});
    }
  }

  private async loadMessageSourcesFromRun(runId: string): Promise<void> {
    try {
      const runContext = await this.api.runContext(runId);
      this.latestRunId.set(runContext.runId);
      this.messageResearchSources.set(
        mergeMessageResearchSources(this.messageResearchSources(), this.activeThread(), runContext),
      );
    } catch {
      return;
    }
  }

  private modelForAgent(agentId: string): string {
    const storedModel = this.agentSettingsStorage.read(agentId).model;

    if (storedModel && this.isAvailableModel(storedModel)) {
      return storedModel;
    }

    if (this.isAvailableModel(this.defaultModelId)) {
      return this.defaultModelId;
    }

    return this.models()[0]?.id ?? '';
  }

  private isAvailableModel(model: string): boolean {
    return this.models().some((candidate) => candidate.id === model);
  }

  private async handleAsync(work: () => Promise<void>): Promise<void> {
    try {
      this.error.set(null);
      await work();
    } catch (error) {
      this.error.set(getErrorMessage(error, 'Request failed.'));
    }
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as unknown;

    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
    ) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : fallback;
}
