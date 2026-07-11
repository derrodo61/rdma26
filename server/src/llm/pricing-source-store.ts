import type {
  CreatePricingSourceRequest,
  DeletePricingSourceResponse,
  PricingSourceListRequest,
  PricingSourceRecord,
  PricingSourceTrustLevel,
  UpdatePricingSourceRequest,
} from '../../../shared/agent-contracts';
import { LocalDatabase } from '../storage/local-database';

const defaultPricingSources: readonly CreatePricingSourceRequest[] = [
  {
    provider: 'openai',
    name: 'OpenAI API pricing',
    url: 'https://developers.openai.com/api/docs/pricing',
    trustLevel: 'official',
    active: true,
    notes: 'Official OpenAI API pricing page.',
  },
];

export class PricingSourceStore {
  private readonly database: LocalDatabase;

  constructor(dataDir: string) {
    this.database = new LocalDatabase(dataDir);
  }

  async ensureReady(): Promise<void> {
    await this.database.ensureReady();
  }

  async ensureDefaultSources(): Promise<void> {
    await this.ensureReady();

    for (const source of defaultPricingSources) {
      await this.createSourceIfMissing(source);
    }
  }

  async listSources(
    request: PricingSourceListRequest = {},
  ): Promise<readonly PricingSourceRecord[]> {
    await this.ensureReady();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (request.provider) {
      conditions.push('provider = ?');
      values.push(request.provider);
    }

    if (request.trustLevel) {
      conditions.push('trust_level = ?');
      values.push(request.trustLevel);
    }

    if (request.active !== undefined) {
      conditions.push('active = ?');
      values.push(request.active ? 1 : 0);
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const rows = this.database
      .get()
      .prepare(
        `
          select *
          from pricing_sources
          ${where}
          order by provider asc, active desc, trust_level asc, name asc
        `,
      )
      .all(...values);

    return rows.map((row) => pricingSourceFromRow(row));
  }

  async createSource(request: CreatePricingSourceRequest): Promise<PricingSourceRecord> {
    await this.ensureReady();

    const record = createRecord(request);

    this.database
      .get()
      .prepare(
        `
          insert into pricing_sources (
            id,
            provider,
            name,
            url,
            trust_level,
            active,
            notes,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.id,
        record.provider,
        record.name,
        record.url,
        record.trustLevel,
        record.active ? 1 : 0,
        record.notes,
        record.createdAt,
        record.updatedAt,
      );

    return await this.requireSource(record.id);
  }

  async updateSource(
    sourceId: string,
    request: UpdatePricingSourceRequest,
  ): Promise<PricingSourceRecord> {
    await this.ensureReady();

    const existing = await this.requireSource(sourceId);
    const now = new Date().toISOString();
    const provider = request.provider?.trim() || existing.provider;
    const name = request.name?.trim() || existing.name;
    const url = request.url?.trim() || existing.url;
    const trustLevel = request.trustLevel ?? existing.trustLevel;
    const active = request.active ?? existing.active;
    const notes = request.notes === undefined ? existing.notes : request.notes.trim() || undefined;

    this.database
      .get()
      .prepare(
        `
          update pricing_sources
          set provider = ?,
              name = ?,
              url = ?,
              trust_level = ?,
              active = ?,
              notes = ?,
              updated_at = ?
          where id = ?
        `,
      )
      .run(provider, name, url, trustLevel, active ? 1 : 0, notes, now, sourceId);

    return await this.requireSource(sourceId);
  }

  async deleteSource(sourceId: string): Promise<DeletePricingSourceResponse> {
    await this.ensureReady();

    await this.requireSource(sourceId);
    this.database.get().prepare('delete from pricing_sources where id = ?').run(sourceId);

    return {
      deleted: true,
      sourceId,
    };
  }

  async checkSource(sourceId: string): Promise<PricingSourceRecord> {
    const source = await this.requireSource(sourceId);
    const checkedAt = new Date().toISOString();

    try {
      const response = await fetch(source.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      await this.recordCheck(sourceId, checkedAt, checkedAt, undefined);
    } catch (error) {
      await this.recordCheck(sourceId, checkedAt, undefined, getErrorMessage(error));
    }

    return await this.requireSource(sourceId);
  }

  async recordSourceCheck(
    sourceId: string,
    checkedAt: string,
    error?: string,
  ): Promise<PricingSourceRecord> {
    await this.requireSource(sourceId);
    await this.recordCheck(sourceId, checkedAt, error ? undefined : checkedAt, error);
    return await this.requireSource(sourceId);
  }

  async requireSource(sourceId: string): Promise<PricingSourceRecord> {
    const source = await this.readSource(sourceId);

    if (!source) {
      throw new Error(`Pricing source ${sourceId} does not exist.`);
    }

    return source;
  }

  private async readSource(sourceId: string): Promise<PricingSourceRecord | null> {
    await this.ensureReady();

    const row = this.database
      .get()
      .prepare('select * from pricing_sources where id = ?')
      .get(sourceId);

    return row ? pricingSourceFromRow(row) : null;
  }

  private async createSourceIfMissing(request: CreatePricingSourceRequest): Promise<void> {
    const provider = request.provider.trim();
    const url = request.url.trim();
    const existing = this.database
      .get()
      .prepare('select id from pricing_sources where provider = ? and url = ?')
      .get(provider, url);

    if (existing) {
      return;
    }

    await this.createSource(request);
  }

  private async recordCheck(
    sourceId: string,
    checkedAt: string,
    successAt: string | undefined,
    error: string | undefined,
  ): Promise<void> {
    await this.ensureReady();

    this.database
      .get()
      .prepare(
        `
          update pricing_sources
          set last_checked_at = ?,
              last_success_at = coalesce(?, last_success_at),
              last_error = ?,
              updated_at = ?
          where id = ?
        `,
      )
      .run(checkedAt, successAt, error, checkedAt, sourceId);
  }
}

function createRecord(request: CreatePricingSourceRequest): PricingSourceRecord {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    provider: request.provider.trim(),
    name: request.name.trim(),
    url: request.url.trim(),
    trustLevel: request.trustLevel ?? 'user_added',
    active: request.active ?? true,
    notes: request.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function pricingSourceFromRow(row: unknown): PricingSourceRecord {
  if (!row || typeof row !== 'object') {
    throw new Error('Invalid pricing-source database row.');
  }

  return {
    id: readString(row, 'id'),
    provider: readString(row, 'provider'),
    name: readString(row, 'name'),
    url: readString(row, 'url'),
    trustLevel: readTrustLevel(row),
    active: readNumber(row, 'active') === 1,
    notes: readOptionalString(row, 'notes'),
    lastCheckedAt: readOptionalString(row, 'last_checked_at'),
    lastSuccessAt: readOptionalString(row, 'last_success_at'),
    lastError: readOptionalString(row, 'last_error'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

function readTrustLevel(row: object): PricingSourceTrustLevel {
  const value = readString(row, 'trust_level');

  if (value !== 'official' && value !== 'third_party' && value !== 'user_added') {
    throw new Error('Invalid pricing-source database row: trust_level is invalid.');
  }

  return value;
}

function readString(row: object, key: string): string {
  if (!(key in row) || typeof (row as Record<string, unknown>)[key] !== 'string') {
    throw new Error(`Invalid pricing-source database row: ${key} must be a string.`);
  }

  return (row as Record<string, string>)[key];
}

function readOptionalString(row: object, key: string): string | undefined {
  if (!(key in row) || (row as Record<string, unknown>)[key] === null) {
    return undefined;
  }

  return readString(row, key);
}

function readNumber(row: object, key: string): number {
  if (!(key in row) || typeof (row as Record<string, unknown>)[key] !== 'number') {
    throw new Error(`Invalid pricing-source database row: ${key} must be a number.`);
  }

  return (row as Record<string, number>)[key];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Pricing source check failed.';
}
