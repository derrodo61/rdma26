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
import { marked } from 'marked';

import type { AgentProfile, ModelOption, ToolDefinition } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { AppSelect, type SelectOption } from '../../shared/app-select/app-select';
import { AgentSettingsStorage } from '../agent-settings-storage';
import { UserProfileSyncService } from '../user-profile-sync';

type MarkdownAction = 'bold' | 'italic' | 'bulletList' | 'numberedList' | 'quote' | 'code' | 'link';

type MarkdownHeadingLevel = 1 | 2 | 3;

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
  protected readonly tools = signal<readonly ToolDefinition[]>([]);
  protected readonly controlledTools = signal<readonly ToolDefinition[]>([]);
  protected readonly defaultModel = signal('');
  protected readonly draftName = signal('');
  protected readonly soulContent = signal('');
  protected readonly draftSoulContent = signal('');
  protected readonly selectedModel = signal('');
  protected readonly enabledToolIds = signal<readonly string[]>([]);
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
        !areStringArraysEqual(this.enabledToolIds(), agent.enabledTools) ||
        this.draftSoulContent() !== this.soulContent()),
    );
  });

  protected readonly renderedSoulPreview = computed(() => renderMarkdown(this.draftSoulContent()));

  constructor() {
    void this.load();
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
      const updatedSoul =
        this.draftSoulContent() === this.soulContent()
          ? {
              content: this.soulContent(),
            }
          : await this.api.updateAgentSoul(updatedAgent.id, {
              content: this.draftSoulContent(),
            });
      const nextAgent: AgentProfile = {
        ...updatedAgent,
        enabledTools: updatedTools.enabledTools,
      };

      this.agent.set(nextAgent);
      this.draftName.set(nextAgent.name);
      this.enabledToolIds.set(nextAgent.enabledTools);
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

      const [agent, models, agentTools, soul, profile] = await Promise.all([
        this.api.readAgent(agentId),
        this.api.models(),
        this.api.agentTools(agentId),
        this.api.readAgentSoul(agentId),
        this.userProfileSync.loadProfile(),
      ]);
      this.agent.set(agent);
      this.models.set(models.models);
      this.tools.set(agentTools.tools);
      this.controlledTools.set(agentTools.controlledTools);
      this.defaultModel.set(models.defaultModel);
      this.draftName.set(agent.name);
      this.soulContent.set(soul.content);
      this.draftSoulContent.set(soul.content);
      this.enabledToolIds.set(agentTools.enabledTools);
      this.agentSettingsStorage.replaceAll(profile.agentSettings);
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

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false, breaks: true, gfm: true });
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
