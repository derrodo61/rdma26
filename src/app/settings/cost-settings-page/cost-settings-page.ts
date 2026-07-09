import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import type {
  AgentProfile,
  CostSummaryGroupBy,
  CostSummaryRow,
  LlmCallPurpose,
  LlmCallRecord,
  ModelPricingRecord,
  ModelPricingStatus,
  OptimizerRunResponse,
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

  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly summaryRows = signal<readonly CostSummaryRow[]>([]);
  protected readonly llmCalls = signal<readonly LlmCallRecord[]>([]);
  protected readonly pricing = signal<readonly ModelPricingRecord[]>([]);
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
  protected readonly draftReasoningCost = signal('');
  protected readonly draftCurrency = signal('USD');
  protected readonly draftSourceUrl = signal('');
  protected readonly draftSourceName = signal('');
  protected readonly draftStatus = signal<ModelPricingStatus>('unverified');
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
  protected readonly pricingStatusOptions: readonly SelectOption[] = [
    { value: 'unverified', label: 'Unverified' },
    { value: 'active', label: 'Active' },
    { value: 'superseded', label: 'Superseded' },
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
  protected readonly canAskOptimizer = computed(
    () => Boolean(this.optimizerPrompt().trim()) && !this.isSaving(),
  );

  constructor() {
    void this.load();
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

  protected updateDraftReasoningCost(value: string): void {
    this.draftReasoningCost.set(value);
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

  protected updateDraftStatus(value: string): void {
    this.draftStatus.set(value as ModelPricingStatus);
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

  protected async createPricing(): Promise<void> {
    const inputCost = parseOptionalNonNegativeNumber(this.draftInputCost());
    const outputCost = parseOptionalNonNegativeNumber(this.draftOutputCost());

    if (inputCost === undefined || outputCost === undefined) {
      this.error.set('Input and output cost must be numbers.');
      return;
    }

    await this.handleAsync(async () => {
      await this.api.createModelPricing({
        provider: this.draftProvider().trim(),
        model: this.draftModel().trim(),
        inputCostPerMillionTokens: inputCost,
        outputCostPerMillionTokens: outputCost,
        cachedInputCostPerMillionTokens: parseOptionalNonNegativeNumber(
          this.draftCachedInputCost(),
        ),
        reasoningCostPerMillionTokens: parseOptionalNonNegativeNumber(this.draftReasoningCost()),
        currency: this.draftCurrency().trim() || 'USD',
        sourceUrl: this.draftSourceUrl().trim(),
        sourceName: this.draftSourceName().trim() || undefined,
        status: this.draftStatus(),
      });
      this.draftModel.set('');
      this.draftInputCost.set('');
      this.draftOutputCost.set('');
      this.draftCachedInputCost.set('');
      this.draftReasoningCost.set('');
      this.draftSourceUrl.set('');
      this.draftSourceName.set('');
      this.savedMessage.set('Pricing record created.');
      await this.loadPricing();
    });
  }

  protected async activatePricing(record: ModelPricingRecord): Promise<void> {
    await this.handleAsync(async () => {
      await this.api.updateModelPricing(record.id, { status: 'active' });
      this.savedMessage.set('Pricing record activated.');
      await this.loadPricing();
    });
  }

  protected async supersedePricing(record: ModelPricingRecord): Promise<void> {
    await this.handleAsync(async () => {
      await this.api.updateModelPricing(record.id, { status: 'superseded' });
      this.savedMessage.set('Pricing record superseded.');
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
    const response = await this.api.modelPricing();
    this.pricing.set(response.pricing);
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
