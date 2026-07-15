import { computed, inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import type {
  AgentProfile,
  AuthSessionResponse,
  HealthResponse,
  ModelOption,
  ThemePreference,
} from '../../../../shared/agent-contracts';
import { AgentSettingsStorage } from '../../settings/agent-settings-storage';
import { UserProfileSyncService } from '../../settings/user-profile-sync';
import type { SelectOption } from '../../shared/app-select/app-select';
import { AssistantApi } from '../assistant-api';
import { ChatThreadState } from './chat-thread-state';

@Injectable()
export class ChatWorkspaceController {
  private readonly api = inject(AssistantApi);
  private readonly agentSettingsStorage = inject(AgentSettingsStorage);
  private readonly route = inject(ActivatedRoute);
  private readonly threadState = inject(ChatThreadState);
  private readonly userProfileSync = inject(UserProfileSyncService);
  private defaultModelId = '';

  readonly health = signal<HealthResponse | null>(null);
  readonly session = signal<AuthSessionResponse | null>(null);
  readonly username = signal('');
  readonly password = signal('');
  readonly agents = signal<readonly AgentProfile[]>([]);
  readonly models = signal<readonly ModelOption[]>([]);
  readonly selectedModel = signal('');
  readonly isLoading = signal(true);
  readonly loginError = signal<string | null>(null);

  readonly activeAgent = computed<AgentProfile | null>(
    () => this.agents().find((agent) => agent.id === this.threadState.selectedAgentId()) ?? null,
  );
  readonly chatAgents = computed<readonly AgentProfile[]>(() =>
    this.agents().filter((agent) => agent.chatEnabled),
  );
  readonly agentOptions = computed<readonly SelectOption[]>(() =>
    this.chatAgents().map((agent) => ({
      value: agent.id,
      label: agent.name,
    })),
  );
  readonly modelOptions = computed<readonly SelectOption[]>(() =>
    this.models().map((model) => ({
      value: model.id,
      label: model.label,
    })),
  );
  readonly activeSoulPath = computed(() => {
    const dataDir = this.health()?.dataDir;
    const agentId = this.threadState.selectedAgentId();

    return dataDir && agentId ? `${dataDir}/agents/${agentId}/configuration/soul.md` : '';
  });

  updateUsername(value: string): void {
    this.username.set(value);
  }

  updatePassword(value: string): void {
    this.password.set(value);
  }

  async load(): Promise<void> {
    try {
      const session = await this.api.session();
      this.session.set(session);

      if (session.authenticated) {
        await this.loadAppData();
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  async login(): Promise<void> {
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

  async logout(): Promise<void> {
    await this.api.logout();
    this.session.set(await this.api.session());
    this.health.set(null);
    this.agents.set([]);
    this.models.set([]);
    this.selectedModel.set('');
    this.threadState.reset();
  }

  async selectAgent(agentId: string): Promise<void> {
    if (!agentId || agentId === this.threadState.selectedAgentId()) {
      return;
    }

    await this.loadAgentThreads(agentId);
    void this.userProfileSync.updateLastAgent(agentId);
  }

  updateModel(value: string): void {
    const agentId = this.threadState.selectedAgentId();
    const agent = this.agents().find((candidate) => candidate.id === agentId);

    this.selectedModel.set(value);

    if (agent && this.isAvailableModel(value)) {
      void this.api
        .updateAgent(agent.id, {
          models: {
            ...agent.models,
            chat: value,
          },
        })
        .then((updatedAgent) => {
          this.agents.update((agents) =>
            agents.map((candidate) =>
              candidate.id === updatedAgent.id ? updatedAgent : candidate,
            ),
          );
        });
      void this.userProfileSync.updateAgentModel(agentId, value);
    }
  }

  updateTheme(value: ThemePreference): void {
    void this.userProfileSync.updateTheme(value);
  }

  async renameActiveAgent(name: string): Promise<void> {
    const agent = this.activeAgent();

    if (!agent || !name || name === agent.name) {
      return;
    }

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
    const initialAgentId = this.initialAgentId(
      requestedAgentId,
      profile.lastAgentId,
      agentsResponse.defaultAgentId,
    );

    await this.loadAgentThreads(initialAgentId, requestedThreadId ?? undefined);
  }

  private async loadAgentThreads(agentId: string, preferredThreadId?: string): Promise<void> {
    this.selectedModel.set(this.modelForAgent(agentId));
    await this.threadState.loadAgentThreads(agentId, preferredThreadId);
  }

  private initialAgentId(
    requestedAgentId: string | null,
    profileAgentId: string | undefined,
    defaultAgentId: string,
  ): string {
    const chatAgents = this.chatAgents();

    return requestedAgentId && chatAgents.some((agent) => agent.id === requestedAgentId)
      ? requestedAgentId
      : profileAgentId && chatAgents.some((agent) => agent.id === profileAgentId)
        ? profileAgentId
        : (chatAgents.find((agent) => agent.id === defaultAgentId)?.id ??
          chatAgents[0]?.id ??
          defaultAgentId);
  }

  private modelForAgent(agentId: string): string {
    const agentModel = this.agents().find((agent) => agent.id === agentId)?.models.chat;

    if (agentModel && this.isAvailableModel(agentModel)) {
      return agentModel;
    }

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
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
