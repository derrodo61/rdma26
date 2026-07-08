import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArchive,
  lucideExternalLink,
  lucidePencil,
  lucideRefreshCcw,
  lucideSave,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';

import type {
  AgentProfile,
  MemoryLifetime,
  MemoryMaintenanceSettings,
  MemoryRecord,
  MemoryScope,
  MemoryStatus,
  MemoryType,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { AppSelect, type SelectOption } from '../../shared/app-select/app-select';

@Component({
  selector: 'app-memory-settings-page',
  imports: [FormsModule, RouterLink, NgIcon, AppSelect],
  providers: [
    provideIcons({
      lucideArchive,
      lucideExternalLink,
      lucidePencil,
      lucideRefreshCcw,
      lucideSave,
      lucideTrash2,
      lucideX,
    }),
  ],
  templateUrl: './memory-settings-page.html',
  styleUrl: './memory-settings-page.css',
})
export class MemorySettingsPage {
  private readonly api = inject(AssistantApi);

  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly memories = signal<readonly MemoryRecord[]>([]);
  protected readonly selectedAgentId = signal('');
  protected readonly selectedScope = signal<MemoryScope>('agent');
  protected readonly selectedStatus = signal<MemoryStatus>('active');
  protected readonly selectedType = signal<MemoryType | ''>('');
  protected readonly selectedLifetime = signal<MemoryLifetime | ''>('');
  protected readonly selectedTag = signal('');
  protected readonly createdFrom = signal('');
  protected readonly createdTo = signal('');
  protected readonly updatedFrom = signal('');
  protected readonly updatedTo = signal('');
  protected readonly query = signal('');
  protected readonly draftContent = signal('');
  protected readonly draftType = signal<MemoryType>('fact');
  protected readonly draftLifetime = signal<MemoryLifetime>('active');
  protected readonly draftTags = signal('');
  protected readonly bulkSummaryLimit = signal('25');
  protected readonly schedulerEnabled = signal(false);
  protected readonly schedulerIntervalMinutes = signal('1440');
  protected readonly schedulerAgentId = signal('');
  protected readonly schedulerLimit = signal('25');
  protected readonly schedulerLastStartedAt = signal<string | undefined>(undefined);
  protected readonly schedulerLastFinishedAt = signal<string | undefined>(undefined);
  protected readonly schedulerLastError = signal<string | undefined>(undefined);
  protected readonly editMemoryId = signal<string | null>(null);
  protected readonly editContent = signal('');
  protected readonly editType = signal<MemoryType>('fact');
  protected readonly editStatus = signal<MemoryStatus>('active');
  protected readonly editLifetime = signal<MemoryLifetime>('active');
  protected readonly editTags = signal('');
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);

  protected readonly scopes: readonly MemoryScope[] = ['agent', 'agent_user', 'user'];
  protected readonly statuses: readonly MemoryStatus[] = ['active', 'archived', 'superseded'];
  protected readonly types: readonly MemoryType[] = [
    'fact',
    'preference',
    'conversation_summary',
    'open_task',
    'tracked_topic',
  ];
  protected readonly lifetimes: readonly MemoryLifetime[] = ['permanent', 'active', 'temporary'];
  protected readonly agentOptions = computed<readonly SelectOption[]>(() =>
    this.agents().map((agent) => ({
      value: agent.id,
      label: agent.name,
    })),
  );
  protected readonly schedulerAgentOptions = computed<readonly SelectOption[]>(() => [
    {
      value: '',
      label: 'All agents',
    },
    ...this.agentOptions(),
  ]);
  protected readonly canCreate = computed(
    () =>
      Boolean(this.draftContent().trim()) &&
      (this.selectedScope() === 'user' || Boolean(this.selectedAgentId())) &&
      !this.isSaving(),
  );
  protected readonly canUpdate = computed(
    () => Boolean(this.editMemoryId()) && Boolean(this.editContent().trim()) && !this.isSaving(),
  );

  constructor() {
    void this.load();
  }

  protected updateAgent(agentId: string): void {
    this.selectedAgentId.set(agentId);
    void this.loadMemories();
  }

  protected updateScope(scope: MemoryScope): void {
    this.selectedScope.set(scope);
    void this.loadMemories();
  }

  protected updateStatus(status: MemoryStatus): void {
    this.selectedStatus.set(status);
    void this.loadMemories();
  }

  protected updateType(type: MemoryType | ''): void {
    this.selectedType.set(type);
    void this.loadMemories();
  }

  protected updateLifetime(lifetime: MemoryLifetime | ''): void {
    this.selectedLifetime.set(lifetime);
    void this.loadMemories();
  }

  protected updateSelectedTag(tag: string): void {
    this.selectedTag.set(tag);
  }

  protected updateCreatedFrom(value: string): void {
    this.createdFrom.set(value);
  }

  protected updateCreatedTo(value: string): void {
    this.createdTo.set(value);
  }

  protected updateUpdatedFrom(value: string): void {
    this.updatedFrom.set(value);
  }

  protected updateUpdatedTo(value: string): void {
    this.updatedTo.set(value);
  }

  protected updateQuery(query: string): void {
    this.query.set(query);
  }

  protected clearFilters(): void {
    this.selectedType.set('');
    this.selectedLifetime.set('');
    this.selectedTag.set('');
    this.createdFrom.set('');
    this.createdTo.set('');
    this.updatedFrom.set('');
    this.updatedTo.set('');
    this.query.set('');
    void this.loadMemories();
  }

  protected updateDraftType(type: MemoryType): void {
    this.draftType.set(type);
  }

  protected updateDraftLifetime(lifetime: MemoryLifetime): void {
    this.draftLifetime.set(lifetime);
  }

  protected updateDraftContent(content: string): void {
    this.draftContent.set(content);
  }

  protected updateDraftTags(tags: string): void {
    this.draftTags.set(tags);
  }

  protected updateBulkSummaryLimit(limit: string): void {
    this.bulkSummaryLimit.set(limit);
  }

  protected updateSchedulerEnabled(enabled: boolean): void {
    this.schedulerEnabled.set(enabled);
  }

  protected updateSchedulerIntervalMinutes(intervalMinutes: string): void {
    this.schedulerIntervalMinutes.set(intervalMinutes);
  }

  protected updateSchedulerAgent(agentId: string): void {
    this.schedulerAgentId.set(agentId);
  }

  protected updateSchedulerLimit(limit: string): void {
    this.schedulerLimit.set(limit);
  }

  protected async saveSchedulerSettings(): Promise<void> {
    await this.handleAsync(async () => {
      const settings = await this.api.updateMemoryMaintenanceSettings({
        enabled: this.schedulerEnabled(),
        intervalMinutes: parseOptionalPositiveInteger(this.schedulerIntervalMinutes()),
        agentId: this.schedulerAgentId() || undefined,
        limitPerAgent: parseOptionalPositiveInteger(this.schedulerLimit()),
      });
      this.applySchedulerSettings(settings);
      this.savedMessage.set('Memory maintenance schedule saved.');
    });
  }

  protected async refreshAgentThreadMemories(): Promise<void> {
    const agentId = this.selectedAgentId();

    if (!agentId) {
      this.error.set('Select an agent first.');
      return;
    }

    await this.handleAsync(async () => {
      const response = await this.api.runMemoryMaintenance({
        agentId,
        limitPerAgent: parseOptionalPositiveInteger(this.bulkSummaryLimit()),
      });
      const agentResult = response.agents.find((result) => result.agentId === agentId);
      const summaryCount = agentResult?.summaries.length ?? 0;
      const emptyCount = agentResult?.skippedEmptyThreads.length ?? 0;
      const skippedReason =
        agentResult?.skippedReason === 'memory_writes_disabled'
          ? ' Memory writes are disabled for this agent.'
          : '';
      this.savedMessage.set(
        `Updated ${summaryCount} thread memories. Skipped ${emptyCount} empty threads.${skippedReason}`,
      );
      await this.loadMemories();
    });
  }

  protected startEdit(memory: MemoryRecord): void {
    this.editMemoryId.set(memory.id);
    this.editContent.set(memory.content);
    this.editType.set(memory.type);
    this.editStatus.set(memory.status);
    this.editLifetime.set(memory.lifetime);
    this.editTags.set(memory.tags.join(', '));
    this.error.set(null);
    this.savedMessage.set(null);
  }

  protected cancelEdit(): void {
    this.editMemoryId.set(null);
    this.editContent.set('');
    this.editType.set('fact');
    this.editStatus.set('active');
    this.editLifetime.set('active');
    this.editTags.set('');
  }

  protected updateEditType(type: MemoryType): void {
    this.editType.set(type);
  }

  protected updateEditStatus(status: MemoryStatus): void {
    this.editStatus.set(status);
  }

  protected updateEditLifetime(lifetime: MemoryLifetime): void {
    this.editLifetime.set(lifetime);
  }

  protected updateEditContent(content: string): void {
    this.editContent.set(content);
  }

  protected updateEditTags(tags: string): void {
    this.editTags.set(tags);
  }

  protected async search(): Promise<void> {
    await this.loadMemories();
  }

  protected async createMemory(): Promise<void> {
    const content = this.draftContent().trim();

    if (!content) {
      this.error.set('Memory content is required.');
      return;
    }

    await this.handleAsync(async () => {
      await this.api.createMemory({
        scope: this.selectedScope(),
        agentId: this.selectedScope() === 'user' ? undefined : this.selectedAgentId(),
        type: this.draftType(),
        lifetime: this.draftLifetime(),
        content,
        tags: parseTags(this.draftTags()),
        source: {
          agentId: this.selectedScope() === 'user' ? undefined : this.selectedAgentId(),
          note: 'Created from UI.',
        },
      });
      this.draftContent.set('');
      this.draftTags.set('');
      this.savedMessage.set('Memory saved.');
      await this.loadMemories();
    });
  }

  protected async saveEdit(memory: MemoryRecord): Promise<void> {
    const content = this.editContent().trim();

    if (!content) {
      this.error.set('Memory content is required.');
      return;
    }

    await this.handleAsync(async () => {
      await this.api.updateMemory(memory.id, {
        type: this.editType(),
        status: this.editStatus(),
        lifetime: this.editLifetime(),
        content,
        tags: parseTags(this.editTags()),
      });
      this.cancelEdit();
      this.savedMessage.set('Memory updated.');
      await this.loadMemories();
    });
  }

  protected async archiveMemory(memory: MemoryRecord): Promise<void> {
    await this.handleAsync(async () => {
      await this.api.updateMemory(memory.id, { status: 'archived' });
      this.savedMessage.set('Memory archived.');
      await this.loadMemories();
    });
  }

  protected async restoreMemory(memory: MemoryRecord): Promise<void> {
    await this.handleAsync(async () => {
      await this.api.updateMemory(memory.id, { status: 'active' });
      this.savedMessage.set('Memory restored.');
      await this.loadMemories();
    });
  }

  protected async deleteMemory(memory: MemoryRecord): Promise<void> {
    if (!globalThis.confirm('Delete this memory? This cannot be undone.')) {
      return;
    }

    await this.handleAsync(async () => {
      await this.api.deleteMemory(memory.id);
      this.savedMessage.set('Memory deleted.');
      await this.loadMemories();
    });
  }

  protected sourceThreadQueryParams(memory: MemoryRecord): Record<string, string> | null {
    const agentId = memory.source?.agentId ?? memory.agentId;
    const threadId = memory.source?.threadId;

    if (!agentId || !threadId) {
      return null;
    }

    return {
      agentId,
      threadId,
    };
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const response = await this.api.agents();
      const settings = await this.api.memoryMaintenanceSettings();
      this.agents.set(response.agents);
      this.selectedAgentId.set(response.defaultAgentId);
      this.applySchedulerSettings(settings);
      await this.loadMemories();
    });
    this.isLoading.set(false);
  }

  private async loadMemories(): Promise<void> {
    const response = await this.api.memories({
      agentId: this.selectedScope() === 'user' ? undefined : this.selectedAgentId(),
      scope: this.selectedScope(),
      type: this.selectedType() || undefined,
      lifetime: this.selectedLifetime() || undefined,
      status: this.selectedStatus(),
      tag: this.selectedTag().trim() || undefined,
      createdFrom: this.createdFrom() || undefined,
      createdTo: this.createdTo() || undefined,
      updatedFrom: this.updatedFrom() || undefined,
      updatedTo: this.updatedTo() || undefined,
      query: this.query().trim() || undefined,
    });

    this.memories.set(response.memories);
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

  private applySchedulerSettings(settings: MemoryMaintenanceSettings): void {
    this.schedulerEnabled.set(settings.enabled);
    this.schedulerIntervalMinutes.set(String(settings.intervalMinutes));
    this.schedulerAgentId.set(settings.agentId ?? '');
    this.schedulerLimit.set(String(settings.limitPerAgent));
    this.schedulerLastStartedAt.set(settings.lastStartedAt);
    this.schedulerLastFinishedAt.set(settings.lastFinishedAt);
    this.schedulerLastError.set(settings.lastError);
  }
}

function parseTags(input: string): readonly string[] {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseOptionalPositiveInteger(input: string): number | undefined {
  const normalized = input.trim();

  if (!normalized) {
    return undefined;
  }

  const value = Number(normalized);

  return Number.isInteger(value) && value > 0 ? value : undefined;
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
