import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBold,
  lucideCode,
  lucideItalic,
  lucideLink,
  lucideList,
  lucideListOrdered,
  lucideQuote,
} from '@ng-icons/lucide';

import type {
  AgentProfile,
  CapabilityDefinition,
  ModelOption,
  SkillPackageSummary,
  ToolDefinition,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { AppSelect, type SelectOption } from '../../shared/app-select/app-select';
import { renderMarkdown } from '../../shared/markdown/render-markdown';
import { AgentSettingsStorage } from '../agent-settings-storage';
import { UserProfileSyncService } from '../user-profile-sync';

type MarkdownAction = 'bold' | 'italic' | 'bulletList' | 'numberedList' | 'quote' | 'code' | 'link';

type MarkdownHeadingLevel = 1 | 2 | 3;
type AgentEditTab = 'basic' | 'capabilities' | 'skills' | 'soul';

interface MarkdownToolbarItem {
  readonly action: MarkdownAction;
  readonly icon: string;
  readonly label: string;
}

type MarkdownFormat =
  | {
      readonly action: MarkdownAction;
    }
  | {
      readonly action: 'heading';
      readonly headingLevel: MarkdownHeadingLevel;
    };

@Component({
  selector: 'app-agent-edit-page',
  imports: [FormsModule, RouterLink, NgIcon, AppSelect],
  providers: [
    provideIcons({
      lucideBold,
      lucideCode,
      lucideItalic,
      lucideLink,
      lucideList,
      lucideListOrdered,
      lucideQuote,
    }),
  ],
  templateUrl: './agent-edit-page.html',
  styleUrl: './agent-edit-page.css',
})
export class AgentEditPage {
  private readonly api = inject(AssistantApi);
  private readonly route = inject(ActivatedRoute);
  private readonly agentSettingsStorage = inject(AgentSettingsStorage);
  private readonly userProfileSync = inject(UserProfileSyncService);
  private readonly soulEditor = viewChild<ElementRef<HTMLTextAreaElement>>('soulEditor');

  protected readonly agent = signal<AgentProfile | null>(null);
  protected readonly models = signal<readonly ModelOption[]>([]);
  protected readonly capabilities = signal<readonly CapabilityDefinition[]>([]);
  protected readonly controlledTools = signal<readonly ToolDefinition[]>([]);
  protected readonly skills = signal<readonly SkillPackageSummary[]>([]);
  protected readonly attachedSkillIds = signal<readonly string[]>([]);
  protected readonly requiredSkillIds = signal<readonly string[]>([]);
  protected readonly defaultModel = signal('');
  protected readonly draftName = signal('');
  protected readonly soulContent = signal('');
  protected readonly draftSoulContent = signal('');
  protected readonly selectedModel = signal('');
  protected readonly enabledCapabilityIds = signal<readonly string[]>([]);
  protected readonly canReadMemory = signal(true);
  protected readonly canWriteMemory = signal(true);
  protected readonly activeTab = signal<AgentEditTab>('basic');
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly isHeadingMenuOpen = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);
  protected readonly leadingMarkdownToolbar: readonly MarkdownToolbarItem[] = [
    { action: 'bold', icon: 'lucideBold', label: 'Bold' },
    { action: 'italic', icon: 'lucideItalic', label: 'Italic' },
  ];
  protected readonly trailingMarkdownToolbar: readonly MarkdownToolbarItem[] = [
    { action: 'bulletList', icon: 'lucideList', label: 'Bullet list' },
    { action: 'numberedList', icon: 'lucideListOrdered', label: 'Numbered list' },
    { action: 'quote', icon: 'lucideQuote', label: 'Quote' },
    { action: 'code', icon: 'lucideCode', label: 'Code' },
    { action: 'link', icon: 'lucideLink', label: 'Link' },
  ];
  protected readonly headingLevels: readonly MarkdownHeadingLevel[] = [1, 2, 3];

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
        this.canReadMemory() !== agent.memory.canRead ||
        this.canWriteMemory() !== agent.memory.canWrite ||
        !areStringArraysEqual(this.enabledCapabilityIds(), agent.enabledCapabilities) ||
        !areStringArraysEqual(this.attachedSkillIds(), agent.attachedSkills) ||
        this.draftSoulContent() !== this.soulContent()),
    );
  });

  protected readonly renderedSoulPreview = computed(() => renderMarkdown(this.draftSoulContent()));

  constructor() {
    void this.load();
  }

  protected selectTab(tab: AgentEditTab): void {
    this.activeTab.set(tab);
    this.isHeadingMenuOpen.set(false);
  }

  protected updateDraftName(value: string): void {
    this.draftName.set(value);
    this.savedMessage.set(null);
  }

  protected updateDraftSoulContent(value: string): void {
    this.draftSoulContent.set(value);
    this.savedMessage.set(null);
  }

  protected applyMarkdownAction(action: MarkdownAction): void {
    this.isHeadingMenuOpen.set(false);
    this.applyMarkdownEdit({ action });
  }

  protected toggleHeadingMenu(): void {
    this.isHeadingMenuOpen.update((isOpen) => !isOpen);
  }

  protected applyHeadingLevel(level: MarkdownHeadingLevel): void {
    this.isHeadingMenuOpen.set(false);
    this.applyMarkdownEdit({ action: 'heading', headingLevel: level });
  }

  private applyMarkdownEdit(format: MarkdownFormat): void {
    const editor = this.soulEditor()?.nativeElement;

    if (!editor) {
      return;
    }

    const edit = createMarkdownEdit({
      ...format,
      content: this.draftSoulContent(),
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
    });

    if (!edit) {
      return;
    }

    this.updateDraftSoulContent(edit.content);
    queueMicrotask(() => {
      editor.focus();
      editor.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  protected updateModel(value: string): void {
    const agent = this.agent();

    this.selectedModel.set(value);

    if (!agent || !this.isAvailableModel(value)) {
      this.savedMessage.set(null);
      return;
    }

    this.agentSettingsStorage.update(agent.id, { model: value });
    void this.userProfileSync.updateAgentModel(agent.id, value);
    void this.saveAgentModels({
      ...agent.models,
      chat: value,
    });
  }

  protected updateCapability(capabilityId: string, isEnabled: boolean): void {
    this.enabledCapabilityIds.update((capabilityIds) => {
      const nextCapabilityIds = isEnabled
        ? [...capabilityIds, capabilityId]
        : capabilityIds.filter((enabledCapabilityId) => enabledCapabilityId !== capabilityId);

      return normalizeCapabilityIds(nextCapabilityIds);
    });
    this.savedMessage.set(null);
  }

  protected updateCanWriteMemory(canWrite: boolean): void {
    this.canWriteMemory.set(canWrite);
    this.savedMessage.set(null);
  }

  protected updateCanReadMemory(canRead: boolean): void {
    this.canReadMemory.set(canRead);
    this.savedMessage.set(null);
  }

  protected isCapabilityEnabled(capabilityId: string): boolean {
    return this.enabledCapabilityIds().includes(capabilityId);
  }

  protected isSkillAttached(skillId: string): boolean {
    return this.attachedSkillIds().includes(skillId);
  }

  protected isSkillRequired(skillId: string): boolean {
    return this.requiredSkillIds().includes(skillId);
  }

  protected updateSkill(skillId: string, isAttached: boolean): void {
    if (this.isSkillRequired(skillId)) {
      return;
    }

    this.attachedSkillIds.update((skillIds) =>
      normalizeSkillIds(
        isAttached ? [...skillIds, skillId] : skillIds.filter((id) => id !== skillId),
      ),
    );
    this.savedMessage.set(null);
  }

  protected async save(): Promise<void> {
    const agent = this.agent();
    const name = this.draftName().trim();

    if (!agent || !name) {
      this.error.set('Agent display name is required.');
      return;
    }

    await this.handleAsync(async () => {
      const shouldUpdateAgent =
        name !== agent.name ||
        this.canReadMemory() !== agent.memory.canRead ||
        this.canWriteMemory() !== agent.memory.canWrite;
      const updatedAgent = shouldUpdateAgent
        ? await this.api.updateAgent(agent.id, {
            name,
            memory: {
              canRead: this.canReadMemory(),
              canWrite: this.canWriteMemory(),
            },
          })
        : agent;
      const updatedCapabilities = areStringArraysEqual(
        this.enabledCapabilityIds(),
        updatedAgent.enabledCapabilities,
      )
        ? {
            enabledCapabilities: updatedAgent.enabledCapabilities,
          }
        : await this.api.updateAgentCapabilities(updatedAgent.id, {
            enabledCapabilities: this.enabledCapabilityIds(),
          });
      const updatedSoul =
        this.draftSoulContent() === this.soulContent()
          ? {
              content: this.soulContent(),
            }
          : await this.api.updateAgentSoul(updatedAgent.id, {
              content: this.draftSoulContent(),
            });
      const updatedSkills = areStringArraysEqual(
        this.attachedSkillIds(),
        updatedAgent.attachedSkills,
      )
        ? { attachedSkillIds: updatedAgent.attachedSkills }
        : await this.api.updateAgentSkills(updatedAgent.id, {
            attachedSkillIds: this.attachedSkillIds(),
          });
      const nextAgent: AgentProfile = {
        ...updatedAgent,
        enabledCapabilities: updatedCapabilities.enabledCapabilities,
        attachedSkills: updatedSkills.attachedSkillIds,
      };

      this.agent.set(nextAgent);
      this.draftName.set(nextAgent.name);
      this.canReadMemory.set(nextAgent.memory.canRead);
      this.canWriteMemory.set(nextAgent.memory.canWrite);
      this.enabledCapabilityIds.set(nextAgent.enabledCapabilities);
      this.attachedSkillIds.set(nextAgent.attachedSkills);
      this.soulContent.set(updatedSoul.content);
      this.draftSoulContent.set(updatedSoul.content);
      this.savedMessage.set('Agent settings saved.');
    });
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const agentId = this.route.snapshot.paramMap.get('agentId') ?? '';

      if (!agentId) {
        throw new Error('Agent id is required.');
      }

      const [agent, models, agentCapabilities, agentSkills, skills, soul, profile] =
        await Promise.all([
          this.api.readAgent(agentId),
          this.api.models(),
          this.api.agentCapabilities(agentId),
          this.api.agentSkills(agentId),
          this.api.skills(),
          this.api.readAgentSoul(agentId),
          this.userProfileSync.loadProfile(),
        ]);
      this.agent.set(agent);
      this.models.set(models.models);
      this.capabilities.set(agentCapabilities.capabilities);
      this.controlledTools.set(agentCapabilities.controlledTools);
      this.skills.set(skills.skills);
      this.attachedSkillIds.set(agentSkills.attachedSkillIds);
      this.requiredSkillIds.set(agentSkills.requiredSkillIds);
      this.defaultModel.set(models.defaultModel);
      this.draftName.set(agent.name);
      this.canReadMemory.set(agent.memory.canRead);
      this.canWriteMemory.set(agent.memory.canWrite);
      this.soulContent.set(soul.content);
      this.draftSoulContent.set(soul.content);
      this.enabledCapabilityIds.set(agentCapabilities.enabledCapabilities);
      this.agentSettingsStorage.replaceAll(profile.agentSettings);
      this.selectedModel.set(
        this.initialModel(agent.id, agent.models.chat, models.defaultModel, models.models),
      );
    });
    this.isLoading.set(false);
  }

  private initialModel(
    agentId: string,
    agentModel: string | undefined,
    defaultModel: string,
    models: readonly ModelOption[],
  ): string {
    if (agentModel && models.some((model) => model.id === agentModel)) {
      return agentModel;
    }

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

  private async saveAgentModels(models: AgentProfile['models']): Promise<void> {
    const agent = this.agent();

    if (!agent) {
      return;
    }

    try {
      const updatedAgent = await this.api.updateAgent(agent.id, { models });
      this.agent.set(updatedAgent);
      this.savedMessage.set('Agent settings saved.');
    } catch (error) {
      this.error.set(getErrorMessage(error, 'Could not save model settings.'));
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

function normalizeCapabilityIds(capabilityIds: readonly string[]): readonly string[] {
  return [...new Set(capabilityIds)].sort();
}

function normalizeSkillIds(skillIds: readonly string[]): readonly string[] {
  return [...new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))].sort();
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizeCapabilityIds(left);
  const normalizedRight = normalizeCapabilityIds(right);

  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

interface MarkdownEditRequest {
  readonly action: MarkdownAction | 'heading';
  readonly headingLevel?: MarkdownHeadingLevel;
  readonly content: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

interface MarkdownEditResult {
  readonly content: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

function createMarkdownEdit(request: MarkdownEditRequest): MarkdownEditResult | null {
  switch (request.action) {
    case 'bold':
      return wrapSelection(request, '**', '**', 'bold text');
    case 'italic':
      return wrapSelection(request, '_', '_', 'italic text');
    case 'heading':
      return prefixSelectedLines(
        request,
        (line) => `${'#'.repeat(request.headingLevel ?? 1)} ${stripLinePrefix(line, /^#{1,6}\s+/)}`,
      );
    case 'bulletList':
      return prefixSelectedLines(request, (line) => `- ${stripLinePrefix(line, /^[-*]\s+/)}`);
    case 'numberedList':
      return prefixSelectedLines(
        request,
        (line, index) => `${index + 1}. ${stripLinePrefix(line, /^\d+\.\s+/)}`,
      );
    case 'quote':
      return prefixSelectedLines(request, (line) => `> ${stripLinePrefix(line, /^>\s?/)}`);
    case 'code':
      return codeSelection(request);
    case 'link':
      return linkSelection(request);
    default:
      return null;
  }
}

function wrapSelection(
  request: MarkdownEditRequest,
  prefix: string,
  suffix: string,
  placeholder: string,
): MarkdownEditResult {
  const selectedText = request.content.slice(request.selectionStart, request.selectionEnd);
  const text = selectedText || placeholder;
  const replacement = `${prefix}${text}${suffix}`;

  return replaceSelection(request, replacement, {
    start: request.selectionStart + prefix.length,
    end: request.selectionStart + prefix.length + text.length,
  });
}

function codeSelection(request: MarkdownEditRequest): MarkdownEditResult {
  const selectedText = request.content.slice(request.selectionStart, request.selectionEnd);

  if (!selectedText.includes('\n')) {
    return wrapSelection(request, '`', '`', 'code');
  }

  return replaceSelection(request, `\`\`\`\n${selectedText}\n\`\`\``, {
    start: request.selectionStart + 4,
    end: request.selectionStart + 4 + selectedText.length,
  });
}

function linkSelection(request: MarkdownEditRequest): MarkdownEditResult | null {
  const selectedText = request.content.slice(request.selectionStart, request.selectionEnd);
  const text = selectedText || 'link text';
  const url = globalThis.prompt('Link URL', 'https://');

  if (!url) {
    return null;
  }

  return replaceSelection(request, `[${text}](${url})`, {
    start: request.selectionStart + 1,
    end: request.selectionStart + 1 + text.length,
  });
}

function prefixSelectedLines(
  request: MarkdownEditRequest,
  formatLine: (line: string, index: number) => string,
): MarkdownEditResult {
  const lineStart = request.content.lastIndexOf('\n', request.selectionStart - 1) + 1;
  const lineEnd = findLineEnd(request.content, request.selectionEnd);
  const selectedBlock = request.content.slice(lineStart, lineEnd);
  const lines = selectedBlock.split('\n');
  const replacement = lines
    .map((line, index) => (line.trim() ? formatLine(line, index) : line))
    .join('\n');

  return {
    content: `${request.content.slice(0, lineStart)}${replacement}${request.content.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

function findLineEnd(content: string, selectionEnd: number): number {
  const nextLineBreak = content.indexOf('\n', selectionEnd);

  return nextLineBreak === -1 ? content.length : nextLineBreak;
}

function stripLinePrefix(line: string, pattern: RegExp): string {
  return line.replace(pattern, '');
}

function replaceSelection(
  request: MarkdownEditRequest,
  replacement: string,
  selection: { readonly start: number; readonly end: number },
): MarkdownEditResult {
  return {
    content: `${request.content.slice(0, request.selectionStart)}${replacement}${request.content.slice(request.selectionEnd)}`,
    selectionStart: selection.start,
    selectionEnd: selection.end,
  };
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
