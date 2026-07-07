import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import type { AgentProfile } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { AgentSettingsStorage } from '../agent-settings-storage';

@Component({
  selector: 'app-agent-settings-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './agent-settings-page.html',
  styleUrl: './agent-settings-page.css',
})
export class AgentSettingsPage {
  private readonly api = inject(AssistantApi);
  private readonly agentSettingsStorage = inject(AgentSettingsStorage);

  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly defaultAgentId = signal('');
  protected readonly newAgentId = signal('');
  protected readonly newAgentName = signal('');
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

  protected async deleteAgent(agent: AgentProfile): Promise<void> {
    if (this.isDefaultAgent(agent)) {
      this.error.set('The protected operator agent cannot be deleted.');
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
      this.agentSettingsStorage.remove(agent.id);
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
