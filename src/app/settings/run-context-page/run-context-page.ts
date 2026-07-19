import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import type { LlmCallRecord, RunContextDetails } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { formatCost } from '../../shared/cost-format';

type RunContextTab = 'overview' | 'timeline' | 'context' | 'raw';

@Component({
  selector: 'app-run-context-page',
  imports: [RouterLink],
  templateUrl: './run-context-page.html',
  styleUrl: './run-context-page.css',
})
export class RunContextPage {
  private readonly api = inject(AssistantApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly context = signal<RunContextDetails | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedTab = signal<RunContextTab>('overview');
  protected readonly runIdCopied = signal(false);

  protected readonly chatQueryParams = computed(() => {
    const context = this.context();

    return context
      ? {
          agentId: context.agentId,
          threadId: context.threadId,
        }
      : {};
  });
  protected readonly profileLines = computed(() => {
    const profile = this.context()?.userProfile;

    if (!profile) {
      return [];
    }

    return [
      ['Name', profile.name || 'not configured'],
      ['Time zone', profile.timeZone],
      ['Language', profile.language],
      ['Locale', profile.locale],
      ['Date style', profile.dateStyle],
      ['Time style', profile.timeStyle],
      ['Theme', profile.theme],
    ] as const;
  });
  protected readonly createdAt = computed(() => {
    const createdAt = this.context()?.createdAt;

    return createdAt ? formatDateTime(createdAt) : 'not captured';
  });
  protected readonly compactRunId = computed(() => {
    const runId = this.context()?.runId ?? '';

    return runId.length > 14 ? `${runId.slice(0, 8)}...${runId.slice(-6)}` : runId;
  });
  protected readonly runStatus = computed(() => this.context()?.status ?? 'success');
  protected readonly runStatusLabel = computed(() => {
    const status = this.runStatus();

    return status.charAt(0).toUpperCase() + status.slice(1);
  });
  protected readonly llmCallTotals = computed(() => {
    const calls = this.context()?.llmCalls ?? [];

    return calls.reduce(
      (totals, call) => ({
        inputTokens: totals.inputTokens + (call.inputTokens ?? 0),
        outputTokens: totals.outputTokens + (call.outputTokens ?? 0),
        totalTokens: totals.totalTokens + (call.totalTokens ?? 0),
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    );
  });
  protected readonly formattedLlmCallTotals = computed(() => {
    const totals = this.llmCallTotals();

    return {
      inputTokens: formatNumber(totals.inputTokens),
      outputTokens: formatNumber(totals.outputTokens),
      totalTokens: formatNumber(totals.totalTokens),
    };
  });
  protected readonly llmCostTotals = computed(() => {
    const calls = this.context()?.llmCalls ?? [];
    const totals = new Map<string, number>();

    for (const call of calls) {
      if (call.estimatedTotalCost === undefined || !call.estimatedCostCurrency) {
        continue;
      }

      totals.set(
        call.estimatedCostCurrency,
        (totals.get(call.estimatedCostCurrency) ?? 0) + call.estimatedTotalCost,
      );
    }

    return Array.from(totals.entries()).map(([currency, amount]) => ({
      currency,
      amount,
      formatted: formatCost(amount, currency),
    }));
  });
  protected readonly totalCostLabel = computed(() => {
    const totals = this.llmCostTotals();

    return totals.length ? totals.map((total) => total.formatted).join(' + ') : 'unpriced';
  });
  protected readonly durationLabel = computed(() => {
    const calls = this.context()?.llmCalls ?? [];
    const started = calls
      .map((call) => new Date(call.requestStartedAt).getTime())
      .filter((time) => Number.isFinite(time));
    const finished = calls
      .map((call) =>
        call.requestFinishedAt ? new Date(call.requestFinishedAt).getTime() : undefined,
      )
      .filter((time): time is number => typeof time === 'number' && Number.isFinite(time));

    if (started.length && finished.length) {
      return formatDuration(Math.max(...finished) - Math.min(...started));
    }

    const durationMs = calls.reduce((total, call) => total + (call.durationMs ?? 0), 0);

    return durationMs ? formatDuration(durationMs) : 'not reported';
  });
  protected readonly sources = computed(() => extractSources(this.context()?.toolCalls ?? []));
  protected readonly timelineItems = computed(() => buildTimelineItems(this.context()));
  protected readonly rawJson = computed(() => JSON.stringify(this.context(), null, 2));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const runId = this.route.snapshot.paramMap.get('runId');

    if (!runId) {
      this.error.set('Run id is required.');
      this.isLoading.set(false);
      return;
    }

    try {
      this.context.set(await this.api.runContext(runId));
    } catch (error) {
      this.error.set(getErrorMessage(error, 'Could not load run context.'));
    } finally {
      this.isLoading.set(false);
    }
  }

  protected formatCallCost(amount: number | undefined, currency: string | undefined): string {
    return amount === undefined || !currency ? 'unpriced' : formatCost(amount, currency);
  }

  protected selectTab(tab: RunContextTab): void {
    this.selectedTab.set(tab);
  }

  protected async copyRunId(): Promise<void> {
    const runId = this.context()?.runId;

    if (!runId) return;

    try {
      await navigator.clipboard.writeText(runId);
      this.runIdCopied.set(true);
      window.setTimeout(() => this.runIdCopied.set(false), 2000);
    } catch {
      this.runIdCopied.set(false);
    }
  }

  protected embeddingOperation(call: LlmCallRecord): string | null {
    return getEmbeddingOperation(call);
  }

  protected embeddingCacheDetails(call: LlmCallRecord): string | null {
    return getEmbeddingCacheDetails(call);
  }

  protected shortHash(hash: string): string {
    return hash.slice(0, 12);
  }
}

interface SourceSummary {
  readonly url: string;
  readonly title: string;
  readonly domain: string;
}

interface TimelineItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly time: string;
  readonly status: string;
  readonly duration: string;
}

interface ResearchToolResult extends Record<string, unknown> {
  readonly answerSourceUrls?: readonly unknown[];
  readonly sources?: readonly {
    readonly url?: unknown;
    readonly title?: unknown;
  }[];
}

function buildTimelineItems(context: RunContextDetails | null): readonly TimelineItem[] {
  if (!context) return [];

  const items: TimelineItem[] = [
    {
      id: `${context.runId}-started`,
      label: 'Run started',
      detail: context.prompt || 'Prompt not captured.',
      time: formatDateTime(context.createdAt),
      status: context.status ?? 'success',
      duration: '',
    },
  ];

  for (const call of context.llmCalls ?? []) {
    items.push({
      id: call.id,
      label: `${call.provider} / ${call.model}`,
      detail: `${call.purpose} · ${formatNumber(call.inputTokens ?? 0)} in / ${formatNumber(call.outputTokens ?? 0)} out`,
      time: formatDateTime(call.requestStartedAt),
      status: call.status,
      duration: call.durationMs === undefined ? '' : formatDuration(call.durationMs),
    });
  }

  for (const [index, toolCall] of (context.toolCalls ?? []).entries()) {
    items.push({
      id: toolCall.id ?? `${context.runId}-tool-${index}`,
      label: toolCall.name ?? 'Tool call',
      detail: toolCall.agentName ? `Agent ${toolCall.agentName}` : 'Tool metadata captured',
      time: '',
      status: 'observed',
      duration: '',
    });
  }

  return items;
}

function extractSources(
  toolCalls: readonly NonNullable<RunContextDetails['toolCalls']>[number][],
): readonly SourceSummary[] {
  const sources = new Map<string, SourceSummary>();

  for (const toolCall of toolCalls) {
    if (toolCall.name !== 'web_search') continue;

    for (const result of parseStructuredPayloads(toolCall.result).filter(isResearchToolResult)) {
      const answerSourceUrls = new Set(
        (result.answerSourceUrls ?? []).filter((url): url is string => typeof url === 'string'),
      );

      for (const url of answerSourceUrls) {
        sources.set(url, {
          url,
          title: readUrlDomain(url),
          domain: readUrlDomain(url),
        });
      }

      for (const source of result.sources ?? []) {
        if (typeof source.url !== 'string' || !source.url) continue;
        if (answerSourceUrls.size && !answerSourceUrls.has(source.url)) continue;

        sources.set(source.url, {
          url: source.url,
          title:
            typeof source.title === 'string' && source.title.trim() ? source.title : source.url,
          domain: readUrlDomain(source.url),
        });
      }
    }
  }

  return [...sources.values()];
}

function parseStructuredPayloads(result: string | undefined): readonly Record<string, unknown>[] {
  if (!result) return [];

  const payloads: Record<string, unknown>[] = [];
  visitStructuredPayload(result, payloads, 0);

  return payloads;
}

function visitStructuredPayload(
  value: unknown,
  payloads: Record<string, unknown>[],
  depth: number,
): void {
  if (depth > 10 || value === null || value === undefined) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;

    try {
      visitStructuredPayload(JSON.parse(trimmed) as unknown, payloads, depth + 1);
    } catch {
      return;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) visitStructuredPayload(item, payloads, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  payloads.push(record);
  for (const candidate of Object.values(record)) {
    visitStructuredPayload(candidate, payloads, depth + 1);
  }
}

function isResearchToolResult(value: Record<string, unknown>): value is ResearchToolResult {
  return 'answerSourceUrls' in value || 'sources' in value;
}

function readUrlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: value >= 10_000 ? 'compact' : 'standard',
  }).format(value);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;

  return `${Math.round((durationMs / 1000) * 10) / 10}s`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function getEmbeddingOperation(call: LlmCallRecord): string | null {
  if (call.metadata?.['requestKind'] !== 'embedding') return null;

  return call.metadata['operation'] === 'memory_index' ? 'Memory index' : 'Memory query';
}

function getEmbeddingCacheDetails(call: LlmCallRecord): string | null {
  if (call.metadata?.['requestKind'] !== 'embedding') return null;
  const indexed = readNonNegativeNumber(call.metadata, 'indexedMemoryCount');
  const cached = readNonNegativeNumber(call.metadata, 'cachedMemoryCount');
  const candidates = readNonNegativeNumber(call.metadata, 'candidateMemoryCount');
  const details: string[] = [];

  if (indexed !== null) details.push(`${indexed} newly indexed`);
  if (cached !== null) details.push(`${cached} reused from cache`);
  if (candidates !== null) details.push(`${candidates} candidates searched`);

  return details.length ? details.join(' · ') : null;
}

function readNonNegativeNumber(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
