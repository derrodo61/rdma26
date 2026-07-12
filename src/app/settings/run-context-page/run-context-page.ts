import { HttpErrorResponse } from '@angular/common/http';
import { JsonPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import type { LlmCallRecord, RunContextDetails } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';

@Component({
  selector: 'app-run-context-page',
  imports: [JsonPipe, RouterLink],
  templateUrl: './run-context-page.html',
  styleUrl: './run-context-page.css',
})
export class RunContextPage {
  private readonly api = inject(AssistantApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly context = signal<RunContextDetails | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly error = signal<string | null>(null);

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

  protected embeddingOperation(call: LlmCallRecord): string | null {
    return getEmbeddingOperation(call);
  }

  protected embeddingCacheDetails(call: LlmCallRecord): string | null {
    return getEmbeddingCacheDetails(call);
  }
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

function formatCost(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
    style: 'currency',
  }).format(amount);
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
