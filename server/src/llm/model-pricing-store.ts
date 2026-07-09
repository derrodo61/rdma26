import type {
  CreateModelPricingRequest,
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

    const now = new Date().toISOString();
    const status = request.status ?? 'unverified';
    const record: ModelPricingRecord = {
      id: crypto.randomUUID(),
      provider: request.provider.trim(),
      model: request.model.trim(),
      inputCostPerMillionTokens: request.inputCostPerMillionTokens,
      outputCostPerMillionTokens: request.outputCostPerMillionTokens,
      cachedInputCostPerMillionTokens: request.cachedInputCostPerMillionTokens,
      reasoningCostPerMillionTokens: request.reasoningCostPerMillionTokens,
      currency: request.currency?.trim() || 'USD',
      sourceUrl: request.sourceUrl.trim(),
      sourceName: request.sourceName?.trim() || undefined,
      sourceRetrievedAt: request.sourceRetrievedAt ?? now,
      validFrom: request.validFrom,
      validUntil: request.validUntil,
      status,
      notes: request.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.database.get().transaction(() => {
      if (record.status === 'active') {
        this.supersedeActivePricing(record.provider, record.model, record.id, now);
      }

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
          record.validFrom,
          record.validUntil,
          record.status,
          record.notes,
          record.createdAt,
          record.updatedAt,
        );
    })();

    return await this.requirePricing(record.id);
  }

  async updatePricing(
    pricingId: string,
    request: UpdateModelPricingRequest,
  ): Promise<ModelPricingRecord> {
    await this.ensureReady();

    const existing = await this.requirePricing(pricingId);
    const now = new Date().toISOString();
    const status = request.status ?? existing.status;
    const validUntil = request.validUntil ?? existing.validUntil;
    const notes = request.notes ?? existing.notes;

    this.database.get().transaction(() => {
      if (status === 'active') {
        this.supersedeActivePricing(existing.provider, existing.model, pricingId, now);
      }

      this.database
        .get()
        .prepare(
          `
            update model_pricing
            set status = ?,
                valid_until = ?,
                notes = ?,
                updated_at = ?
            where id = ?
          `,
        )
        .run(status, validUntil, notes, now, pricingId);
    })();

    return await this.requirePricing(pricingId);
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
    at: string,
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
            and (valid_from is null or valid_from <= ?)
            and (valid_until is null or valid_until >= ?)
          order by valid_from desc, updated_at desc
          limit 1
        `,
      )
      .get(provider, model, at, at);

    return row ? modelPricingFromRow(row) : null;
  }

  private supersedeActivePricing(
    provider: string,
    model: string,
    exceptPricingId: string,
    updatedAt: string,
  ): void {
    this.database
      .get()
      .prepare(
        `
          update model_pricing
          set status = 'superseded',
              valid_until = coalesce(valid_until, ?),
              updated_at = ?
          where provider = ?
            and model = ?
            and status = 'active'
            and id <> ?
        `,
      )
      .run(updatedAt, updatedAt, provider, model, exceptPricingId);
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
    validFrom: readOptionalString(record, 'valid_from'),
    validUntil: readOptionalString(record, 'valid_until'),
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
