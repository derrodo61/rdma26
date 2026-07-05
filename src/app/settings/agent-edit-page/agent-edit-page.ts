import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import type { AgentProfile, ModelOption } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { AppSelect, type SelectOption } from '../../shared/app-select/app-select';
import { AgentSettingsStorage } from '../agent-settings-storage';

@Component({
  selector: 'app-agent-edit-page',
  imports: [FormsModule, RouterLink, AppSelect],
  templateUrl: './agent-edit-page.html',
  styleUrl: './agent-edit-page.css',
})
export class AgentEditPage {
  private readonly api = inject(AssistantApi);
  private readonly route = inject(ActivatedRoute);
  private readonly agentSettingsStorage = inject(AgentSettingsStorage);

  protected readonly agent = signal<AgentProfile | null>(null);
  protected readonly models = signal<readonly ModelOption[]>([]);
  protected readonly defaultModel = signal('');
  protected readonly draftName = signal('');
  protected readonly selectedModel = signal('');
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);

  protected readonly modelOptions = computed<readonly SelectOption[]>(() =>
    this.models().map((model) => ({
      value: model.id,
      label: model.label,
    })),
  );

  protected readonly hasChanges = computed(() => {
    const agent = this.agent();

    return Boolean(agent && this.draftName().trim() !== agent.name);
  });

  constructor() {
    void this.load();
  }

  protected updateDraftName(value: string): void {
    this.draftName.set(value);
    this.savedMessage.set(null);
  }

  protected updateModel(value: string): void {
    const agent = this.agent();

    this.selectedModel.set(value);

    if (!agent || !this.isAvailableModel(value)) {
      this.savedMessage.set(null);
      return;
    }

    this.agentSettingsStorage.update(agent.id, { model: value });
    this.savedMessage.set('Agent settings saved.');
  }

  protected async save(): Promise<void> {
    const agent = this.agent();
    const name = this.draftName().trim();

    if (!agent || !name) {
      this.error.set('Agent display name is required.');
      return;
    }

    await this.handleAsync(async () => {
      const updatedAgent =
        name === agent.name ? agent : await this.api.updateAgent(agent.id, { name });
      this.agent.set(updatedAgent);
      this.draftName.set(updatedAgent.name);
      this.savedMessage.set('Agent settings saved.');
    });
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const agentId = this.route.snapshot.paramMap.get('agentId') ?? '';

      if (!agentId) {
        throw new Error('Agent id is required.');
      }

      const [agent, models] = await Promise.all([this.api.readAgent(agentId), this.api.models()]);
      this.agent.set(agent);
      this.models.set(models.models);
      this.defaultModel.set(models.defaultModel);
      this.draftName.set(agent.name);
      this.selectedModel.set(this.initialModel(agent.id, models.defaultModel, models.models));
    });
    this.isLoading.set(false);
  }

  private initialModel(
    agentId: string,
    defaultModel: string,
    models: readonly ModelOption[],
  ): string {
    const storedModel = this.agentSettingsStorage.read(agentId).model;

    if (storedModel && models.some((model) => model.id === storedModel)) {
      return storedModel;
    }

    if (models.some((model) => model.id === defaultModel)) {
      return defaultModel;
    }

    return models[0]?.id ?? '';
  }

  private isAvailableModel(model: string): boolean {
    return this.models().some((candidate) => candidate.id === model);
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
