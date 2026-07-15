import type {
  CostSummaryGroupBy,
  CostSummaryRequest,
  CostSummaryResponse,
  LlmCallPurpose,
  LlmCallListRequest,
  LlmCallRecord,
  LlmCallStatus,
  ModelPricingRecord,
  RunContextTokenUsage,
} from '../../../shared/agent-contracts';
import { LocalDatabase } from '../storage/local-database';
import { ModelPricingStore } from './model-pricing-store';

export class LlmCallStore {
  private readonly database: LocalDatabase;
  private readonly pricingStore: ModelPricingStore;

  constructor(dataDir: string, pricingStore = new ModelPricingStore(dataDir)) {
    this.database = new LocalDatabase(dataDir);
    this.pricingStore = pricingStore;
  }

  async ensureReady(): Promise<void> {
    await this.database.ensureReady();
  }

  close(): void {
    this.database.close();
  }

  async startCall(request: StartLlmCallRequest): Promise<LlmCallRecord> {
    await this.ensureReady();
    await this.pricingStore.ensureReady();

    const startedAt = request.requestStartedAt ?? new Date().toISOString();
    const record: LlmCallRecord = {
      id: crypto.randomUUID(),
      runId: request.runId,
      provider: request.provider,
      model: request.model,
      purpose: request.purpose,
      status: 'cancelled',
      agentId: request.agentId,
      threadId: request.threadId,
      providerRunId: request.providerRunId,
      parentProviderRunId: request.parentProviderRunId,
      requestStartedAt: startedAt,
      metadata: request.metadata,
    };

    this.database
      .get()
      .prepare(
        `
          insert into llm_calls (
            id,
            run_id,
            provider,
            model,
            purpose,
            status,
            agent_id,
            thread_id,
            provider_run_id,
            parent_provider_run_id,
            request_started_at,
            metadata_json
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.id,
        record.runId,
        record.provider,
        record.model,
        record.purpose,
        record.status,
        record.agentId,
        record.threadId,
        record.providerRunId,
        record.parentProviderRunId,
        record.requestStartedAt,
        record.metadata ? JSON.stringify(record.metadata) : null,
      );

    return record;
  }

  async finishCall(
    callId: string,
    status: LlmCallStatus,
    usage?: RunContextTokenUsage,
    errorMessage?: string,
  ): Promise<LlmCallRecord | null> {
    await this.ensureReady();

    const existing = await this.readCall(callId);

    if (!existing) {
      return null;
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(
      0,
      new Date(finishedAt).getTime() - new Date(existing.requestStartedAt).getTime(),
    );
    const costEstimate = usage
      ? calculateCostEstimate(
          usage,
          await this.pricingStore.findActivePricing(existing.provider, existing.model, finishedAt),
        )
      : undefined;

    this.database
      .get()
      .prepare(
        `
          update llm_calls
          set status = ?,
              input_tokens = ?,
              output_tokens = ?,
              total_tokens = ?,
              cached_input_tokens = ?,
              reasoning_tokens = ?,
              request_finished_at = ?,
              duration_ms = ?,
              error_message = ?,
              pricing_snapshot_id = ?,
              estimated_input_cost = ?,
              estimated_output_cost = ?,
              estimated_cached_input_cost = ?,
              estimated_reasoning_cost = ?,
              estimated_total_cost = ?,
              estimated_cost_currency = ?
          where id = ?
        `,
      )
      .run(
        status,
        usage?.inputTokens,
        usage?.outputTokens,
        usage?.totalTokens,
        usage?.cachedInputTokens,
        usage?.reasoningTokens,
        finishedAt,
        durationMs,
        errorMessage,
        costEstimate?.pricingSnapshotId,
        costEstimate?.estimatedInputCost,
        costEstimate?.estimatedOutputCost,
        costEstimate?.estimatedCachedInputCost,
        costEstimate?.estimatedReasoningCost,
        costEstimate?.estimatedTotalCost,
        costEstimate?.estimatedCostCurrency,
        callId,
      );

    return await this.readCall(callId);
  }

  async readCall(callId: string): Promise<LlmCallRecord | null> {
    const row = this.database.get().prepare('select * from llm_calls where id = ?').get(callId);

    return row ? llmCallFromRow(row) : null;
  }

  async requireCall(callId: string): Promise<LlmCallRecord> {
    const call = await this.readCall(callId);

    if (!call) {
      throw new Error(`LLM call ${callId} does not exist.`);
    }

    return call;
  }

  async listCalls(request: LlmCallListRequest = {}): Promise<readonly LlmCallRecord[]> {
    await this.ensureReady();

    const { where, values } = buildCallFilter(request);
    const limit = request.limit ?? 100;
    const rows = this.database
      .get()
      .prepare(
        `
          select *
          from llm_calls
          ${where}
          order by request_started_at desc
          limit ?
        `,
      )
      .all(...values, limit);

    return rows.map((row) => llmCallFromRow(row));
  }

  async listCallsForRun(runId: string): Promise<readonly LlmCallRecord[]> {
    const rows = this.database
      .get()
      .prepare(
        `
          select *
          from llm_calls
          where run_id = ?
          order by request_started_at asc
        `,
      )
      .all(runId);

    return rows.map((row) => llmCallFromRow(row));
  }

  async summarizeCosts(request: CostSummaryRequest = {}): Promise<CostSummaryResponse> {
    await this.ensureReady();

    const groupBy = request.groupBy ?? 'day';
    const calls = await this.listCalls({
      ...request,
      limit: 10_000,
    });
    const grouped = new Map<string, MutableCostSummaryRow>();

    for (const call of calls) {
      const key = costSummaryKey(call, groupBy);
      const currency = call.estimatedCostCurrency ?? 'unpriced';
      const groupKey = `${key}\u0000${currency}`;
      const row =
        grouped.get(groupKey) ??
        ({
          key,
          currency: call.estimatedCostCurrency,
          callCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedTotalCost: 0,
        } satisfies MutableCostSummaryRow);

      row.callCount += 1;
      row.inputTokens += call.inputTokens ?? 0;
      row.outputTokens += call.outputTokens ?? 0;
      row.totalTokens += call.totalTokens ?? 0;
      row.estimatedTotalCost += call.estimatedTotalCost ?? 0;
      grouped.set(groupKey, row);
    }

    return {
      groupBy,
      rows: Array.from(grouped.values()).map((row) => ({
        ...row,
        estimatedTotalCost:
          row.currency === undefined ? undefined : roundCost(row.estimatedTotalCost ?? 0),
      })),
    };
  }

  async deleteCallsForThread(agentId: string, threadId: string): Promise<number> {
    await this.ensureReady();

    const result = this.database
      .get()
      .prepare('delete from llm_calls where agent_id = ? and thread_id = ?')
      .run(agentId, threadId);

    return result.changes;
  }

  async deleteCallsForAgent(agentId: string): Promise<number> {
    await this.ensureReady();

    const result = this.database
      .get()
      .prepare('delete from llm_calls where agent_id = ?')
      .run(agentId);

    return result.changes;
  }

  async deleteOrphanedCalls(): Promise<number> {
    await this.ensureReady();

    const result = this.database
      .get()
      .prepare(
        `
          delete from llm_calls
          where thread_id is not null
            and agent_id is not null
            and not exists (
              select 1
              from threads
              where threads.id = llm_calls.thread_id
                and threads.agent_id = llm_calls.agent_id
            )
        `,
      )
      .run();

    return result.changes;
  }
}

export interface StartLlmCallRequest {
  readonly runId?: string;
  readonly provider: string;
  readonly model: string;
  readonly purpose: LlmCallPurpose;
  readonly agentId?: string;
  readonly threadId?: string;
  readonly providerRunId?: string;
  readonly parentProviderRunId?: string;
  readonly requestStartedAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface MutableCostSummaryRow {
  key: string;
  currency?: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedTotalCost: number;
}

function buildCallFilter(request: LlmCallListRequest): {
  readonly where: string;
  readonly values: readonly unknown[];
} {
  const conditions: string[] = [];
  const values: unknown[] = [];

  addFilter(conditions, values, 'agent_id', request.agentId);
  addFilter(conditions, values, 'thread_id', request.threadId);
  addFilter(conditions, values, 'run_id', request.runId);
  addFilter(conditions, values, 'provider', request.provider);
  addFilter(conditions, values, 'model', request.model);
  addFilter(conditions, values, 'purpose', request.purpose);
  addFilter(conditions, values, 'status', request.status);

  if (request.startedFrom) {
    conditions.push('request_started_at >= ?');
    values.push(request.startedFrom);
  }

  if (request.startedTo) {
    conditions.push('request_started_at <= ?');
    values.push(request.startedTo);
  }

  return {
    where: conditions.length ? `where ${conditions.join(' and ')}` : '',
    values,
  };
}

function addFilter(
  conditions: string[],
  values: unknown[],
  column: string,
  value: string | undefined,
): void {
  if (value) {
    conditions.push(`${column} = ?`);
    values.push(value);
  }
}

function costSummaryKey(call: LlmCallRecord, groupBy: CostSummaryGroupBy): string {
  switch (groupBy) {
    case 'agent':
      return call.agentId ?? 'unknown';
    case 'model':
      return `${call.provider}/${call.model}`;
    case 'purpose':
      return call.purpose;
    case 'day':
      return call.requestStartedAt.slice(0, 10);
  }
}

function llmCallFromRow(row: unknown): LlmCallRecord {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Invalid LLM call database row.');
  }

  const record = row as Record<string, unknown>;

  return {
    id: readString(record, 'id'),
    runId: readOptionalString(record, 'run_id'),
    provider: readString(record, 'provider'),
    model: readString(record, 'model'),
    purpose: readString(record, 'purpose') as LlmCallPurpose,
    status: readString(record, 'status') as LlmCallStatus,
    agentId: readOptionalString(record, 'agent_id'),
    threadId: readOptionalString(record, 'thread_id'),
    providerRunId: readOptionalString(record, 'provider_run_id'),
    parentProviderRunId: readOptionalString(record, 'parent_provider_run_id'),
    inputTokens: readOptionalNumber(record, 'input_tokens'),
    outputTokens: readOptionalNumber(record, 'output_tokens'),
    totalTokens: readOptionalNumber(record, 'total_tokens'),
    cachedInputTokens: readOptionalNumber(record, 'cached_input_tokens'),
    reasoningTokens: readOptionalNumber(record, 'reasoning_tokens'),
    requestStartedAt: readString(record, 'request_started_at'),
    requestFinishedAt: readOptionalString(record, 'request_finished_at'),
    durationMs: readOptionalNumber(record, 'duration_ms'),
    errorMessage: readOptionalString(record, 'error_message'),
    pricingSnapshotId: readOptionalString(record, 'pricing_snapshot_id'),
    estimatedInputCost: readOptionalNumber(record, 'estimated_input_cost'),
    estimatedOutputCost: readOptionalNumber(record, 'estimated_output_cost'),
    estimatedCachedInputCost: readOptionalNumber(record, 'estimated_cached_input_cost'),
    estimatedReasoningCost: readOptionalNumber(record, 'estimated_reasoning_cost'),
    estimatedTotalCost: readOptionalNumber(record, 'estimated_total_cost'),
    estimatedCostCurrency: readOptionalString(record, 'estimated_cost_currency'),
    metadata: parseMetadata(readOptionalString(record, 'metadata_json')),
  };
}

interface CostEstimate {
  readonly pricingSnapshotId: string;
  readonly estimatedInputCost: number;
  readonly estimatedOutputCost: number;
  readonly estimatedCachedInputCost?: number;
  readonly estimatedReasoningCost?: number;
  readonly estimatedTotalCost: number;
  readonly estimatedCostCurrency: string;
}

function calculateCostEstimate(
  usage: RunContextTokenUsage,
  pricing: ModelPricingRecord | null,
): CostEstimate | undefined {
  if (!pricing) {
    return undefined;
  }

  const cachedInputTokens =
    pricing.cachedInputCostPerMillionTokens === undefined ? 0 : (usage.cachedInputTokens ?? 0);
  const standardInputTokens = Math.max(0, (usage.inputTokens ?? 0) - cachedInputTokens);
  const reasoningTokens =
    pricing.reasoningCostPerMillionTokens === undefined ? 0 : (usage.reasoningTokens ?? 0);
  const standardOutputTokens = Math.max(0, (usage.outputTokens ?? 0) - reasoningTokens);

  const estimatedInputCost = costForTokens(standardInputTokens, pricing.inputCostPerMillionTokens);
  const estimatedOutputCost = costForTokens(
    standardOutputTokens,
    pricing.outputCostPerMillionTokens,
  );
  const estimatedCachedInputCost =
    pricing.cachedInputCostPerMillionTokens === undefined
      ? undefined
      : costForTokens(cachedInputTokens, pricing.cachedInputCostPerMillionTokens);
  const estimatedReasoningCost =
    pricing.reasoningCostPerMillionTokens === undefined
      ? undefined
      : costForTokens(reasoningTokens, pricing.reasoningCostPerMillionTokens);
  const estimatedTotalCost = roundCost(
    estimatedInputCost +
      estimatedOutputCost +
      (estimatedCachedInputCost ?? 0) +
      (estimatedReasoningCost ?? 0),
  );

  return {
    pricingSnapshotId: pricing.id,
    estimatedInputCost,
    estimatedOutputCost,
    estimatedCachedInputCost,
    estimatedReasoningCost,
    estimatedTotalCost,
    estimatedCostCurrency: pricing.currency,
  };
}

function costForTokens(tokens: number, costPerMillionTokens: number): number {
  return roundCost((tokens / 1_000_000) * costPerMillionTokens);
}

function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000_000_000) / 1_000_000_000_000;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== 'string') {
    throw new Error(`Invalid LLM call database row: ${key} must be a string.`);
  }

  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];

  return typeof value === 'number' ? value : undefined;
}

function parseMetadata(json: string | undefined): Readonly<Record<string, unknown>> | undefined {
  if (!json) {
    return undefined;
  }

  try {
    const value: unknown = JSON.parse(json);

    return typeof value === 'object' && value !== null
      ? (value as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
}
