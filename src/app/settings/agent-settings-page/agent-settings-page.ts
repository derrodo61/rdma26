import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import type { AgentProfile } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';

@Component({
  selector: 'app-agent-settings-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './agent-settings-page.html',
  styleUrl: './agent-settings-page.css',
})
export class AgentSettingsPage {
  private readonly api = inject(AssistantApi);
  private readonly selectedModelStoragePrefix = 'rdma26:selected-model';

  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly defaultAgentId = signal('');
  protected readonly newAgentId = signal('');
  protected readonly newAgentName = signal('');
  protected readonly draftNames = signal<Record<string, string>>({});
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canCreate = computed(
    () => Boolean(this.newAgentName().trim()) && !this.isSaving(),
  );

  constructor() {
    void this.load();
  }

  protected updateNewAgentId(value: string): void {
    this.newAgentId.set(value);
  }

  protected updateNewAgentName(value: string): void {
    this.newAgentName.set(value);
  }

  protected updateDraftName(agentId: string, value: string): void {
    this.draftNames.update((draftNames) => ({
      ...draftNames,
      [agentId]: value,
    }));
  }

  protected draftName(agentId: string): string {
    return this.draftNames()[agentId] ?? '';
  }

  protected hasNameChanges(agent: AgentProfile): boolean {
    return this.draftName(agent.id).trim() !== agent.name;
  }

  protected isDefaultAgent(agent: AgentProfile): boolean {
    return agent.id === this.defaultAgentId();
  }

  protected async createAgent(): Promise<void> {
    const name = this.newAgentName().trim();
    const id = this.newAgentId().trim();

    if (!name) {
      this.error.set('Agent name is required.');
      return;
    }

    await this.handleAsync(async () => {
      await this.api.createAgent({
        name,
        id: id || undefined,
      });
      this.newAgentId.set('');
      this.newAgentName.set('');
      await this.loadAgents();
    });
  }

  protected async saveAgent(agent: AgentProfile): Promise<void> {
    const name = this.draftName(agent.id).trim();

    if (!name || name === agent.name) {
      return;
    }

    await this.handleAsync(async () => {
      await this.api.updateAgent(agent.id, { name });
      await this.loadAgents();
    });
  }

  protected async deleteAgent(agent: AgentProfile): Promise<void> {
    if (this.isDefaultAgent(agent)) {
      this.error.set('The default agent cannot be deleted.');
      return;
    }

    const confirmed = globalThis.confirm(
      `Delete "${agent.name}"? This removes the agent, all threads, and its soul.md data.`,
    );

    if (!confirmed) {
      return;
    }

    await this.handleAsync(async () => {
      await this.api.deleteAgent(agent.id);
      this.removeSelectedModel(agent.id);
      await this.loadAgents();
    });
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      await this.loadAgents();
    });
    this.isLoading.set(false);
  }

  private async loadAgents(): Promise<void> {
    const response = await this.api.agents();
    this.defaultAgentId.set(response.defaultAgentId);
    this.agents.set(response.agents);
    this.draftNames.set(Object.fromEntries(response.agents.map((agent) => [agent.id, agent.name])));
  }

  private removeSelectedModel(agentId: string): void {
    try {
      globalThis.localStorage.removeItem(`${this.selectedModelStoragePrefix}:${agentId}`);
    } catch {
      return;
    }
  }

  private async handleAsync(work: () => Promise<void>): Promise<void> {
    try {
      this.isSaving.set(true);
      this.error.set(null);
      await work();
    } catch (error) {
      this.error.set(getErrorMessage(error, 'Request failed.'));
    } finally {
      this.isSaving.set(false);
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
