import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import type { AgentProfile, ModelOption, ToolDefinition } from '../../../../shared/agent-contracts';
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
  protected readonly tools = signal<readonly ToolDefinition[]>([]);
  protected readonly defaultModel = signal('');
  protected readonly draftName = signal('');
  protected readonly selectedModel = signal('');
  protected readonly enabledToolIds = signal<readonly string[]>([]);
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

    return Boolean(
      agent &&
      (this.draftName().trim() !== agent.name ||
        !areStringArraysEqual(this.enabledToolIds(), agent.enabledTools)),
    );
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

  protected updateTool(toolId: string, isEnabled: boolean): void {
    this.enabledToolIds.update((toolIds) => {
      const nextToolIds = isEnabled
        ? [...toolIds, toolId]
        : toolIds.filter((enabledToolId) => enabledToolId !== toolId);

      return normalizeToolIds(nextToolIds);
    });
    this.savedMessage.set(null);
  }

  protected isToolEnabled(toolId: string): boolean {
    return this.enabledToolIds().includes(toolId);
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
      const updatedTools = areStringArraysEqual(this.enabledToolIds(), updatedAgent.enabledTools)
        ? {
            enabledTools: updatedAgent.enabledTools,
          }
        : await this.api.updateAgentTools(updatedAgent.id, {
            enabledTools: this.enabledToolIds(),
          });
      const nextAgent: AgentProfile = {
        ...updatedAgent,
        enabledTools: updatedTools.enabledTools,
      };

      this.agent.set(nextAgent);
      this.draftName.set(nextAgent.name);
      this.enabledToolIds.set(nextAgent.enabledTools);
      this.savedMessage.set('Agent settings saved.');
    });
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const agentId = this.route.snapshot.paramMap.get('agentId') ?? '';

      if (!agentId) {
        throw new Error('Agent id is required.');
      }

      const [agent, models, agentTools] = await Promise.all([
        this.api.readAgent(agentId),
        this.api.models(),
        this.api.agentTools(agentId),
      ]);
      this.agent.set(agent);
      this.models.set(models.models);
      this.tools.set(agentTools.tools);
      this.defaultModel.set(models.defaultModel);
      this.draftName.set(agent.name);
      this.enabledToolIds.set(agentTools.enabledTools);
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

function normalizeToolIds(toolIds: readonly string[]): readonly string[] {
  return [...new Set(toolIds)].sort();
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizeToolIds(left);
  const normalizedRight = normalizeToolIds(right);

  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
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
