import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import type {
  AgentProfile,
  CostSummaryGroupBy,
  CostSummaryRow,
  LlmCallPurpose,
  LlmCallRecord,
  ModelPricingRecord,
  OptimizerRunResponse,
  PricingSourceRecord,
  SyncOpenAiModelPricingResult,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { AppSelect, type SelectOption } from '../../shared/app-select/app-select';

@Component({
  selector: 'app-cost-settings-page',
  imports: [FormsModule, RouterLink, AppSelect],
  templateUrl: './cost-settings-page.html',
  styleUrl: './cost-settings-page.css',
})
export class CostSettingsPage {
  private readonly api = inject(AssistantApi);
  private readonly pricingDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('pricingDialog');

  protected readonly selectedTab = signal<'usage' | 'pricing'>('usage');
  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly summaryRows = signal<readonly CostSummaryRow[]>([]);
  protected readonly llmCalls = signal<readonly LlmCallRecord[]>([]);
  protected readonly pricing = signal<readonly ModelPricingRecord[]>([]);
  protected readonly pricingSources = signal<readonly PricingSourceRecord[]>([]);
  protected readonly selectedAgentId = signal('');
  protected readonly selectedGroupBy = signal<CostSummaryGroupBy>('day');
  protected readonly selectedPurpose = signal<LlmCallPurpose | ''>('');
  protected readonly startedFrom = signal('');
  protected readonly startedTo = signal('');
  protected readonly draftProvider = signal('openai');
  protected readonly draftModel = signal('');
  protected readonly draftInputCost = signal('');
  protected readonly draftOutputCost = signal('');
  protected readonly draftCachedInputCost = signal('');
  protected readonly draftCurrency = signal('USD');
  protected readonly draftSourceUrl = signal('');
  protected readonly draftSourceName = signal('');
  protected readonly editingPricingId = signal<string | null>(null);
  protected readonly pricingSyncResult = signal<SyncOpenAiModelPricingResult | null>(null);
  protected readonly optimizerPrompt = signal('');
  protected readonly optimizerResult = signal<OptimizerRunResponse | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);

  protected readonly groupOptions: readonly SelectOption[] = [
    { value: 'day', label: 'Day' },
    { value: 'agent', label: 'Agent' },
    { value: 'model', label: 'Model' },
    { value: 'purpose', label: 'Purpose' },
  ];
  protected readonly purposeOptions: readonly SelectOption[] = [
    { value: '', label: 'All purposes' },
    { value: 'chat', label: 'Chat' },
    { value: 'operator', label: 'Operator' },
    { value: 'research_parent', label: 'Research parent' },
    { value: 'research_subagent', label: 'Research subagent' },
    { value: 'research_verification', label: 'Research verification' },
    { value: 'thread_summary', label: 'Thread summary' },
    { value: 'memory_retrieval', label: 'Memory retrieval' },
    { value: 'memory_maintenance', label: 'Memory maintenance' },
    { value: 'unknown', label: 'Unknown' },
  ];
  protected readonly agentOptions = computed<readonly SelectOption[]>(() => [
    { value: '', label: 'All agents' },
    ...this.agents().map((agent) => ({
      value: agent.id,
      label: agent.name,
    })),
  ]);
  protected readonly totalCalls = computed(() =>
    this.summaryRows().reduce((total, row) => total + row.callCount, 0),
  );
  protected readonly totalTokens = computed(() =>
    this.summaryRows().reduce((total, row) => total + row.totalTokens, 0),
  );
  protected readonly totalCosts = computed(() => {
    const totals = new Map<string, number>();

    for (const row of this.summaryRows()) {
      if (row.currency && row.estimatedTotalCost !== undefined) {
        totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.estimatedTotalCost);
      }
    }

    return Array.from(totals.entries()).map(([currency, amount]) => ({
      currency,
      formatted: formatCost(amount, currency),
    }));
  });
  protected readonly canCreatePricing = computed(
    () =>
      Boolean(this.draftProvider().trim()) &&
      Boolean(this.draftModel().trim()) &&
      parseOptionalNonNegativeNumber(this.draftInputCost()) !== undefined &&
      parseOptionalNonNegativeNumber(this.draftOutputCost()) !== undefined &&
      Boolean(this.draftSourceUrl().trim()) &&
      !this.isSaving(),
  );
  protected readonly pricingFormTitle = computed(() =>
    this.editingPricingId() ? 'Edit pricing record' : 'Create pricing record',
  );
  protected readonly pricingFormAction = computed(() =>
    this.editingPricingId() ? 'Save pricing' : 'Create pricing',
  );
  protected readonly canAskOptimizer = computed(
    () => Boolean(this.optimizerPrompt().trim()) && !this.isSaving(),
  );
  protected readonly openAiPricingSource = computed(() =>
    this.pricingSources().find(
      (source) => source.provider === 'openai' && source.trustLevel === 'official' && source.active,
    ),
  );
  protected readonly latestOpenAiSourceRetrieval = computed(
    () =>
      this.pricingSyncResult()?.source.retrievedAt ??
      this.openAiPricingSource()?.lastSuccessAt ??
      this.openAiPricingSource()?.lastCheckedAt,
  );

  constructor() {
    void this.load();
  }

  protected selectTab(tab: 'usage' | 'pricing'): void {
    this.selectedTab.set(tab);
  }

  protected updateAgent(agentId: string): void {
    this.selectedAgentId.set(agentId);
    void this.loadObservability();
  }

  protected updateGroupBy(groupBy: string): void {
    this.selectedGroupBy.set(groupBy as CostSummaryGroupBy);
    void this.loadSummary();
  }

  protected updatePurpose(purpose: string): void {
    this.selectedPurpose.set(purpose as LlmCallPurpose | '');
    void this.loadObservability();
  }

  protected updateStartedFrom(value: string): void {
    this.startedFrom.set(value);
  }

  protected updateStartedTo(value: string): void {
    this.startedTo.set(value);
  }

  protected clearFilters(): void {
    this.selectedAgentId.set('');
    this.selectedGroupBy.set('day');
    this.selectedPurpose.set('');
    this.startedFrom.set('');
    this.startedTo.set('');
    void this.loadObservability();
  }

  protected async refresh(): Promise<void> {
    await this.loadObservability();
  }

  protected updateDraftProvider(value: string): void {
    this.draftProvider.set(value);
  }

  protected updateDraftModel(value: string): void {
    this.draftModel.set(value);
  }

  protected updateDraftInputCost(value: string): void {
    this.draftInputCost.set(value);
  }

  protected updateDraftOutputCost(value: string): void {
    this.draftOutputCost.set(value);
  }

  protected updateDraftCachedInputCost(value: string): void {
    this.draftCachedInputCost.set(value);
  }

  protected updateDraftCurrency(value: string): void {
    this.draftCurrency.set(value);
  }

  protected updateDraftSourceUrl(value: string): void {
    this.draftSourceUrl.set(value);
  }

  protected updateDraftSourceName(value: string): void {
    this.draftSourceName.set(value);
  }

  protected updateOptimizerPrompt(value: string): void {
    this.optimizerPrompt.set(value);
  }

  protected async askOptimizer(): Promise<void> {
    const prompt = this.optimizerPrompt().trim();

    if (!prompt) {
      this.error.set('A question for the Cost Analyst is required.');
      return;
    }

    await this.handleAsync(async () => {
      const result = await this.api.runOptimizer({
        prompt,
        title: 'Cost dashboard',
      });
      this.optimizerResult.set(result);
      this.savedMessage.set('Cost Analyst finished.');
      await this.loadObservability();
    });
  }

  protected async savePricing(): Promise<void> {
    const inputCost = parseOptionalNonNegativeNumber(this.draftInputCost());
    const outputCost = parseOptionalNonNegativeNumber(this.draftOutputCost());

    if (inputCost === undefined || outputCost === undefined) {
      this.error.set('Input and output cost must be numbers.');
      return;
    }

    await this.handleAsync(async () => {
      const request = {
        provider: this.draftProvider().trim(),
        model: this.draftModel().trim(),
        inputCostPerMillionTokens: inputCost,
        outputCostPerMillionTokens: outputCost,
        cachedInputCostPerMillionTokens: parseOptionalNullableNumber(this.draftCachedInputCost()),
        currency: this.draftCurrency().trim() || 'USD',
        sourceUrl: this.draftSourceUrl().trim(),
        sourceName: this.draftSourceName().trim() || null,
      };
      const editingPricingId = this.editingPricingId();

      if (editingPricingId) {
        await this.api.updateModelPricing(editingPricingId, request);
        this.savedMessage.set('Pricing record updated.');
      } else {
        await this.api.createModelPricing({
          ...request,
          sourceName: request.sourceName ?? undefined,
          cachedInputCostPerMillionTokens: request.cachedInputCostPerMillionTokens ?? undefined,
        });
        this.savedMessage.set('Pricing record created.');
      }

      this.pricingDialog().nativeElement.close();
      this.resetPricingDraft();
      await this.loadPricing();
    });
  }

  protected addPricing(): void {
    this.resetPricingDraft();
    this.pricingDialog().nativeElement.showModal();
  }

  protected editPricing(record: ModelPricingRecord): void {
    this.editingPricingId.set(record.id);
    this.draftProvider.set(record.provider);
    this.draftModel.set(record.model);
    this.draftInputCost.set(String(record.inputCostPerMillionTokens));
    this.draftOutputCost.set(String(record.outputCostPerMillionTokens));
    this.draftCachedInputCost.set(
      formatOptionalDraftNumber(record.cachedInputCostPerMillionTokens),
    );
    this.draftCurrency.set(record.currency);
    this.draftSourceUrl.set(record.sourceUrl);
    this.draftSourceName.set(record.sourceName ?? '');
    this.selectedTab.set('pricing');
    this.pricingDialog().nativeElement.showModal();
  }

  protected cancelPricingEdit(): void {
    this.pricingDialog().nativeElement.close();
    this.resetPricingDraft();
  }

  protected pricingDialogClosed(): void {
    this.resetPricingDraft();
  }

  protected async deletePricing(record: ModelPricingRecord): Promise<void> {
    const confirmed = window.confirm(
      `Delete pricing record for ${record.provider} / ${record.model}?`,
    );

    if (!confirmed) {
      return;
    }

    await this.handleAsync(async () => {
      await this.api.deleteModelPricing(record.id);
      if (this.editingPricingId() === record.id) {
        this.resetPricingDraft();
      }
      this.savedMessage.set('Pricing record deleted.');
      await this.loadPricing();
    });
  }

  protected async syncOpenAiPricing(): Promise<void> {
    await this.handleAsync(async () => {
      const result = await this.api.syncOpenAiModelPricing();
      this.pricingSyncResult.set(result);
      this.savedMessage.set('OpenAI pricing source checked.');
      await this.loadPricing();
    });
  }

  protected async togglePricingActive(record: ModelPricingRecord): Promise<void> {
    await this.handleAsync(async () => {
      const active = record.status !== 'active';
      await this.api.setModelPricingActive(record.id, active);
      this.savedMessage.set(active ? 'Pricing record activated.' : 'Pricing record deactivated.');
      await this.loadPricing();
    });
  }

  protected formatCallCost(call: LlmCallRecord): string {
    return call.estimatedTotalCost === undefined || !call.estimatedCostCurrency
      ? 'unpriced'
      : formatCost(call.estimatedTotalCost, call.estimatedCostCurrency);
  }

  protected formatRowCost(row: CostSummaryRow): string {
    return row.estimatedTotalCost === undefined || !row.currency
      ? 'unpriced'
      : formatCost(row.estimatedTotalCost, row.currency);
  }

  protected agentName(agentId: string | undefined): string {
    if (!agentId) {
      return 'unknown';
    }

    return this.agents().find((agent) => agent.id === agentId)?.name ?? agentId;
  }

  protected formatDateTime(value: string | undefined): string {
    if (!value) {
      return 'Not checked yet';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(date);
  }

  protected formatRelativeDate(value: string): string {
    const timestamp = Date.parse(value);

    if (!Number.isFinite(timestamp)) {
      return value;
    }

    const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

    if (Math.abs(elapsedSeconds) < 60) {
      return formatter.format(elapsedSeconds, 'second');
    }

    const elapsedMinutes = Math.round(elapsedSeconds / 60);
    if (Math.abs(elapsedMinutes) < 60) {
      return formatter.format(elapsedMinutes, 'minute');
    }

    const elapsedHours = Math.round(elapsedMinutes / 60);
    if (Math.abs(elapsedHours) < 24) {
      return formatter.format(elapsedHours, 'hour');
    }

    return formatter.format(Math.round(elapsedHours / 24), 'day');
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const [agentsResponse] = await Promise.all([this.api.agents()]);
      this.agents.set(agentsResponse.agents);
      await this.loadObservability();
    });
    this.isLoading.set(false);
  }

  private async loadObservability(): Promise<void> {
    await Promise.all([this.loadSummary(), this.loadCalls(), this.loadPricing()]);
  }

  private async loadSummary(): Promise<void> {
    const response = await this.api.costSummary({
      agentId: this.selectedAgentId() || undefined,
      purpose: this.selectedPurpose() || undefined,
      startedFrom: this.startedFrom() || undefined,
      startedTo: this.startedTo() || undefined,
      groupBy: this.selectedGroupBy(),
    });
    this.summaryRows.set(response.rows);
  }

  private async loadCalls(): Promise<void> {
    const response = await this.api.llmCalls({
      agentId: this.selectedAgentId() || undefined,
      purpose: this.selectedPurpose() || undefined,
      startedFrom: this.startedFrom() || undefined,
      startedTo: this.startedTo() || undefined,
      limit: 25,
    });
    this.llmCalls.set(response.calls);
  }

  private async loadPricing(): Promise<void> {
    const [pricingResponse, sourceResponse] = await Promise.all([
      this.api.modelPricing(),
      this.api.pricingSources('openai'),
    ]);
    this.pricing.set(pricingResponse.pricing);
    this.pricingSources.set(sourceResponse.sources);
  }

  private resetPricingDraft(): void {
    this.editingPricingId.set(null);
    this.draftProvider.set('openai');
    this.draftModel.set('');
    this.draftInputCost.set('');
    this.draftOutputCost.set('');
    this.draftCachedInputCost.set('');
    this.draftCurrency.set('USD');
    this.draftSourceUrl.set('');
    this.draftSourceName.set('');
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

function parseOptionalNonNegativeNumber(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseOptionalNullableNumber(value: string): number | null {
  return parseOptionalNonNegativeNumber(value) ?? null;
}

function formatOptionalDraftNumber(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function formatCost(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      currency,
      maximumFractionDigits: 6,
      minimumFractionDigits: 0,
      style: 'currency',
    }).format(amount);
  } catch {
    return `${amount.toFixed(6)} ${currency}`;
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
