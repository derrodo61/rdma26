import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
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

import type { ChatMessage, ThemePreference } from '../../../../shared/agent-contracts';
import { ThemePreferenceService } from '../../settings/theme-preference';
import { renderMarkdown } from '../../shared/markdown/render-markdown';
import { ChatComposer } from '../components/chat-composer/chat-composer';
import { ChatLogin } from '../components/chat-login/chat-login';
import { ChatMessageList } from '../components/chat-message-list/chat-message-list';
import { ChatSidebar } from '../components/chat-sidebar/chat-sidebar';
import { ChatRunController } from './chat-run-controller';
import type { RenderedChatMessage } from './chat-page.types';
import { ChatThreadState } from './chat-thread-state';
import { ChatWorkspaceController } from './chat-workspace-controller';

@Component({
  selector: 'app-chat-page',
  imports: [ChatComposer, ChatLogin, ChatMessageList, ChatSidebar],
  providers: [
    ChatThreadState,
    ChatRunController,
    ChatWorkspaceController,
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
  private readonly themePreference = inject(ThemePreferenceService);
  private readonly chatRun = inject(ChatRunController);
  private readonly threadState = inject(ChatThreadState);
  private readonly workspace = inject(ChatWorkspaceController);

  protected readonly session = this.workspace.session;
  protected readonly username = this.workspace.username;
  protected readonly password = this.workspace.password;
  protected readonly selectedModel = this.workspace.selectedModel;
  protected readonly selectedAgentId = this.threadState.selectedAgentId;
  protected readonly threads = this.threadState.threads;
  protected readonly activeThread = this.threadState.activeThread;
  protected readonly latestRunId = this.threadState.latestRunId;
  protected readonly messageResearchSources = this.threadState.messageResearchSources;
  protected readonly messageRunCosts = this.threadState.messageRunCosts;
  protected readonly runActivity = this.chatRun.runActivity;
  protected readonly draft = this.chatRun.draft;
  protected readonly isLoading = this.workspace.isLoading;
  protected readonly isRunning = this.chatRun.isRunning;
  protected readonly isSidebarCollapsed = signal(false);
  protected readonly isSettingsMenuOpen = signal(false);
  protected readonly error = this.chatRun.error;
  protected readonly loginError = this.workspace.loginError;
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
  protected readonly activeAgent = this.workspace.activeAgent;
  protected readonly agentOptions = this.workspace.agentOptions;
  protected readonly modelOptions = this.workspace.modelOptions;
  protected readonly activeSoulPath = this.workspace.activeSoulPath;

  constructor() {
    void this.load();
  }

  protected async login(): Promise<void> {
    await this.workspace.login();
  }

  protected async logout(): Promise<void> {
    this.closeSettingsMenu();
    await this.workspace.logout();
  }

  protected async createThread(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    await this.handleAsync(async () => this.threadState.createThread());
  }

  protected async selectThread(threadId: string): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    await this.handleAsync(async () => this.threadState.selectThread(threadId));
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

    await this.handleAsync(async () => this.threadState.deleteThread(threadId));
  }

  protected async selectAgent(agentId: string): Promise<void> {
    if (!agentId || agentId === this.selectedAgentId()) {
      return;
    }

    await this.workspace.selectAgent(agentId);
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
      await this.workspace.renameActiveAgent(name);
    });
  }

  protected async send(): Promise<void> {
    await this.chatRun.send({
      agentId: this.selectedAgentId(),
      thread: this.activeThread(),
      model: this.selectedModel(),
    });
  }

  protected updateDraft(value: string): void {
    this.chatRun.updateDraft(value);
  }

  protected updateUsername(value: string): void {
    this.workspace.updateUsername(value);
  }

  protected updatePassword(value: string): void {
    this.workspace.updatePassword(value);
  }

  protected updateModel(value: string): void {
    this.workspace.updateModel(value);
  }

  protected updateTheme(value: ThemePreference): void {
    this.workspace.updateTheme(value);
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
    await this.handleAsync(async () => this.workspace.load());
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
