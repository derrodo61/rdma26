import type {
  CreateModelPricingRequest,
  DeleteModelPricingResponse,
  ModelPricingListRequest,
  ModelPricingRecord,
  ModelPricingStatus,
  UpdateModelPricingRequest,
} from '../../../shared/agent-contracts';
import { LocalDatabase } from '../storage/local-database';

export class ModelPricingStore {
  private readonly database: LocalDatabase;

  constructor(dataDir: string) {
    this.database = new LocalDatabase(dataDir);
  }

  async ensureReady(): Promise<void> {
    await this.database.ensureReady();
  }

  async listPricing(request: ModelPricingListRequest = {}): Promise<readonly ModelPricingRecord[]> {
    await this.ensureReady();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (request.provider) {
      conditions.push('provider = ?');
      values.push(request.provider);
    }

    if (request.model) {
      conditions.push('model = ?');
      values.push(request.model);
    }

    if (request.status) {
      conditions.push('status = ?');
      values.push(request.status);
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const rows = this.database
      .get()
      .prepare(
        `
          select *
          from model_pricing
          ${where}
          order by provider asc, model asc, updated_at desc
        `,
      )
      .all(...values);

    return rows.map((row) => modelPricingFromRow(row));
  }

  async createPricing(request: CreateModelPricingRequest): Promise<ModelPricingRecord> {
    await this.ensureReady();

    const provider = request.provider.trim();
    const model = request.model.trim();
    const existing = this.database
      .get()
      .prepare('select id from model_pricing where provider = ? and model = ?')
      .get(provider, model);

    if (existing) {
      throw new Error(
        `Pricing for ${provider} / ${model} already exists. Update that record instead.`,
      );
    }

    const now = new Date().toISOString();
    const record: ModelPricingRecord = {
      id: crypto.randomUUID(),
      provider,
      model,
      inputCostPerMillionTokens: request.inputCostPerMillionTokens,
      outputCostPerMillionTokens: request.outputCostPerMillionTokens,
      cachedInputCostPerMillionTokens: request.cachedInputCostPerMillionTokens,
      reasoningCostPerMillionTokens: request.reasoningCostPerMillionTokens,
      currency: request.currency?.trim() || 'USD',
      sourceUrl: request.sourceUrl.trim(),
      sourceName: request.sourceName?.trim() || undefined,
      sourceRetrievedAt: request.sourceRetrievedAt ?? now,
      status: 'active',
      notes: request.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .get()
      .prepare(
        `
            insert into model_pricing (
              id,
              provider,
              model,
              input_cost_per_million_tokens,
              output_cost_per_million_tokens,
              cached_input_cost_per_million_tokens,
              reasoning_cost_per_million_tokens,
              currency,
              source_url,
              source_name,
              source_retrieved_at,
              valid_from,
              valid_until,
              status,
              notes,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
      )
      .run(
        record.id,
        record.provider,
        record.model,
        record.inputCostPerMillionTokens,
        record.outputCostPerMillionTokens,
        record.cachedInputCostPerMillionTokens,
        record.reasoningCostPerMillionTokens,
        record.currency,
        record.sourceUrl,
        record.sourceName,
        record.sourceRetrievedAt,
        undefined,
        undefined,
        record.status,
        record.notes,
        record.createdAt,
        record.updatedAt,
      );

    return await this.requirePricing(record.id);
  }

  async updatePricing(
    pricingId: string,
    request: UpdateModelPricingRequest,
  ): Promise<ModelPricingRecord> {
    await this.ensureReady();

    const existing = await this.requirePricing(pricingId);
    const now = new Date().toISOString();
    const provider = request.provider?.trim() ?? existing.provider;
    const model = request.model?.trim() ?? existing.model;
    const inputCostPerMillionTokens =
      request.inputCostPerMillionTokens ?? existing.inputCostPerMillionTokens;
    const outputCostPerMillionTokens =
      request.outputCostPerMillionTokens ?? existing.outputCostPerMillionTokens;
    const cachedInputCostPerMillionTokens =
      request.cachedInputCostPerMillionTokens === undefined
        ? existing.cachedInputCostPerMillionTokens
        : (request.cachedInputCostPerMillionTokens ?? undefined);
    const reasoningCostPerMillionTokens =
      request.reasoningCostPerMillionTokens === undefined
        ? existing.reasoningCostPerMillionTokens
        : (request.reasoningCostPerMillionTokens ?? undefined);
    const currency = request.currency?.trim() ?? existing.currency;
    const sourceUrl = request.sourceUrl?.trim() ?? existing.sourceUrl;
    const sourceName =
      request.sourceName === undefined
        ? existing.sourceName
        : request.sourceName?.trim() || undefined;
    const sourceRetrievedAt = request.sourceRetrievedAt ?? existing.sourceRetrievedAt;
    const notes = request.notes === undefined ? existing.notes : request.notes?.trim() || undefined;

    this.database
      .get()
      .prepare(
        `
            update model_pricing
            set provider = ?,
                model = ?,
                input_cost_per_million_tokens = ?,
                output_cost_per_million_tokens = ?,
                cached_input_cost_per_million_tokens = ?,
                reasoning_cost_per_million_tokens = ?,
                currency = ?,
                source_url = ?,
                source_name = ?,
                source_retrieved_at = ?,
                valid_from = null,
                status = 'active',
                valid_until = null,
                notes = ?,
                updated_at = ?
            where id = ?
          `,
      )
      .run(
        provider,
        model,
        inputCostPerMillionTokens,
        outputCostPerMillionTokens,
        cachedInputCostPerMillionTokens,
        reasoningCostPerMillionTokens,
        currency,
        sourceUrl,
        sourceName,
        sourceRetrievedAt,
        notes,
        now,
        pricingId,
      );

    return await this.requirePricing(pricingId);
  }

  async setPricingActive(pricingId: string, active: boolean): Promise<ModelPricingRecord> {
    await this.ensureReady();
    await this.requirePricing(pricingId);

    this.database
      .get()
      .prepare(
        `
          update model_pricing
          set status = ?,
              updated_at = ?
          where id = ?
        `,
      )
      .run(active ? 'active' : 'inactive', new Date().toISOString(), pricingId);

    return await this.requirePricing(pricingId);
  }

  async deletePricing(pricingId: string): Promise<DeleteModelPricingResponse> {
    await this.ensureReady();
    await this.requirePricing(pricingId);

    this.database.get().prepare('delete from model_pricing where id = ?').run(pricingId);

    return {
      deleted: true,
      pricingId,
    };
  }

  async requirePricing(pricingId: string): Promise<ModelPricingRecord> {
    const pricing = await this.readPricing(pricingId);

    if (!pricing) {
      throw new Error(`Pricing record ${pricingId} does not exist.`);
    }

    return pricing;
  }

  async readPricing(pricingId: string): Promise<ModelPricingRecord | null> {
    await this.ensureReady();

    const row = this.database
      .get()
      .prepare('select * from model_pricing where id = ?')
      .get(pricingId);

    return row ? modelPricingFromRow(row) : null;
  }

  async findActivePricing(
    provider: string,
    model: string,
    _at: string,
  ): Promise<ModelPricingRecord | null> {
    await this.ensureReady();

    const row = this.database
      .get()
      .prepare(
        `
          select *
          from model_pricing
          where provider = ?
            and model = ?
            and status = 'active'
          limit 1
        `,
      )
      .get(provider, model);

    return row ? modelPricingFromRow(row) : null;
  }
}

function modelPricingFromRow(row: unknown): ModelPricingRecord {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Invalid model-pricing database row.');
  }

  const record = row as Record<string, unknown>;

  return {
    id: readString(record, 'id'),
    provider: readString(record, 'provider'),
    model: readString(record, 'model'),
    inputCostPerMillionTokens: readNumber(record, 'input_cost_per_million_tokens'),
    outputCostPerMillionTokens: readNumber(record, 'output_cost_per_million_tokens'),
    cachedInputCostPerMillionTokens: readOptionalNumber(
      record,
      'cached_input_cost_per_million_tokens',
    ),
    reasoningCostPerMillionTokens: readOptionalNumber(record, 'reasoning_cost_per_million_tokens'),
    currency: readString(record, 'currency'),
    sourceUrl: readString(record, 'source_url'),
    sourceName: readOptionalString(record, 'source_name'),
    sourceRetrievedAt: readString(record, 'source_retrieved_at'),
    status: readString(record, 'status') as ModelPricingStatus,
    notes: readOptionalString(record, 'notes'),
    createdAt: readString(record, 'created_at'),
    updatedAt: readString(record, 'updated_at'),
  };
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== 'string') {
    throw new Error(`Invalid model-pricing database row: ${key} must be a string.`);
  }

  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];

  if (typeof value !== 'number') {
    throw new Error(`Invalid model-pricing database row: ${key} must be a number.`);
  }

  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];

  return typeof value === 'number' ? value : undefined;
}
