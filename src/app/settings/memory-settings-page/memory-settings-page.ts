import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleHelp,
  lucidePencil,
  lucidePin,
  lucidePinOff,
  lucidePlus,
  lucideSave,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';

import type {
  AgentProfile,
  MemoryPinnedBudget,
  MemoryRecord,
  MemoryScope,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { AppDialog } from '../../shared/app-dialog/app-dialog';
import { AppSelect, type SelectOption } from '../../shared/app-select/app-select';

@Component({
  selector: 'app-memory-settings-page',
  imports: [FormsModule, RouterLink, NgIcon, AppSelect, AppDialog],
  providers: [
    provideIcons({
      lucideCircleHelp,
      lucidePencil,
      lucidePin,
      lucidePinOff,
      lucidePlus,
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
  private readonly createDialog = viewChild<AppDialog>('createDialog');
  private readonly helpDialog = viewChild<AppDialog>('helpDialog');

  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly memories = signal<readonly MemoryRecord[]>([]);
  protected readonly budgets = signal<readonly MemoryPinnedBudget[]>([]);
  protected readonly selectedAgentId = signal('');
  protected readonly selectedScope = signal<MemoryScope>('agent');
  protected readonly selectedPinned = signal<'' | 'true' | 'false'>('');
  protected readonly query = signal('');
  protected readonly draftContent = signal('');
  protected readonly draftPinned = signal(false);
  protected readonly draftTags = signal('');
  protected readonly editMemoryId = signal<string | null>(null);
  protected readonly editContent = signal('');
  protected readonly editPinned = signal(false);
  protected readonly editTags = signal('');
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);
  protected readonly scopes: readonly MemoryScope[] = ['agent', 'agent_user', 'user'];
  protected readonly agentOptions = computed<readonly SelectOption[]>(() =>
    this.agents().map((agent) => ({ value: agent.id, label: agent.name })),
  );
  protected readonly selectedBudget = computed(() =>
    this.budgets().find((budget) => budget.scope === this.selectedScope()),
  );
  protected readonly canCreate = computed(
    () =>
      Boolean(this.draftContent().trim()) &&
      (this.selectedScope() === 'user' || Boolean(this.selectedAgentId())) &&
      !this.isSaving(),
  );

  constructor() {
    void this.load();
  }

  protected openCreateDialog(): void {
    this.createDialog()?.open();
  }

  protected openHelpDialog(): void {
    this.helpDialog()?.open();
  }

  protected updateAgent(value: string): void {
    this.selectedAgentId.set(value);
    void this.loadMemories();
  }

  protected updateScope(value: MemoryScope): void {
    this.selectedScope.set(value);
    void this.loadMemories();
  }

  protected async search(): Promise<void> {
    await this.loadMemories();
  }

  protected startEdit(memory: MemoryRecord): void {
    this.editMemoryId.set(memory.id);
    this.editContent.set(memory.content);
    this.editPinned.set(memory.pinned);
    this.editTags.set(memory.tags.join(', '));
  }

  protected cancelEdit(): void {
    this.editMemoryId.set(null);
  }

  protected async createMemory(): Promise<void> {
    await this.handleAsync(async () => {
      await this.api.createMemory({
        scope: this.selectedScope(),
        agentId: this.selectedScope() === 'user' ? undefined : this.selectedAgentId(),
        pinned: this.draftPinned(),
        content: this.draftContent().trim(),
        tags: parseTags(this.draftTags()),
        source: { note: 'Created from UI.' },
      });
      this.draftContent.set('');
      this.draftTags.set('');
      this.draftPinned.set(false);
      this.savedMessage.set('Memory saved.');
      await this.loadMemories();
      this.createDialog()?.close();
    });
  }

  protected async saveEdit(memory: MemoryRecord): Promise<void> {
    await this.handleAsync(async () => {
      await this.api.updateMemory(memory.id, {
        pinned: this.editPinned(),
        content: this.editContent().trim(),
        tags: parseTags(this.editTags()),
      });
      this.cancelEdit();
      this.savedMessage.set('Memory updated.');
      await this.loadMemories();
    });
  }

  protected async togglePinned(memory: MemoryRecord): Promise<void> {
    await this.handleAsync(async () => {
      await this.api.updateMemory(memory.id, { pinned: !memory.pinned });
      await this.loadMemories();
    });
  }

  protected async deleteMemory(memory: MemoryRecord): Promise<void> {
    if (!globalThis.confirm('Delete this memory? This cannot be undone.')) return;
    await this.handleAsync(async () => {
      await this.api.deleteMemory(memory.id);
      await this.loadMemories();
    });
  }

  protected formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const response = await this.api.agents();
      this.agents.set(response.agents);
      this.selectedAgentId.set(response.defaultAgentId);
      await this.loadMemories();
    });
    this.isLoading.set(false);
  }

  private async loadMemories(): Promise<void> {
    const agentId = this.selectedAgentId();
    const [response, budgetResponse] = await Promise.all([
      this.api.memories({
        agentId: this.selectedScope() === 'user' ? undefined : agentId,
        scope: this.selectedScope(),
        pinned: this.selectedPinned() === '' ? undefined : this.selectedPinned() === 'true',
        query: this.query().trim() || undefined,
      }),
      agentId ? this.api.memoryPinnedBudgets(agentId) : Promise.resolve({ budgets: [] }),
    ]);
    this.memories.set(response.memories);
    this.budgets.set(budgetResponse.budgets);
  }

  private async handleAsync(work: () => Promise<void>): Promise<void> {
    try {
      this.isSaving.set(true);
      this.error.set(null);
      await work();
    } catch (error) {
      this.error.set(getErrorMessage(error));
    } finally {
      this.isSaving.set(false);
    }
  }
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
    return error.error.message;
  }
  return error instanceof Error ? error.message : 'Request failed.';
}
