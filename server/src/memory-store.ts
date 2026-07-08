import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OpenAIEmbeddings } from '@langchain/openai';

import type {
  CreateMemoryRequest,
  MemoryContextSource,
  MemoryLifetime,
  MemoryListRequest,
  MemoryRecord,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  UpdateMemoryRequest,
} from '../../shared/agent-contracts';
import { validateAgentId } from './agent-registry';
import { LocalDatabase } from './local-database';

const memoryTypes = new Set<MemoryType>([
  'fact',
  'preference',
  'conversation_summary',
  'open_task',
  'tracked_topic',
]);
const memoryScopes = new Set<MemoryScope>(['agent', 'agent_user', 'user']);
const memoryStatuses = new Set<MemoryStatus>(['active', 'archived', 'superseded']);
const memoryLifetimes = new Set<MemoryLifetime>(['permanent', 'active', 'temporary']);
const embeddingModel = process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small';

export class MemoryStore {
  private readonly database: LocalDatabase;

  constructor(private readonly dataDir: string) {
    this.database = new LocalDatabase(dataDir);
  }

  async ensureReady(): Promise<void> {
    await mkdir(join(this.dataDir, 'agents'), { recursive: true });
    await mkdir(this.memoryIndexDir(), { recursive: true });
    await this.database.ensureReady();
    await this.importJsonMemories();
  }

  async listMemories(request: MemoryListRequest = {}): Promise<MemoryRecord[]> {
    await this.ensureReady();
    const status = request.status ?? 'active';
    const memories = await this.readCandidateMemories(request);
    const query = normalizeQuery(request.query);
    const scored = memories
      .filter((memory) => memory.status === status)
      .filter((memory) => !request.type || memory.type === request.type)
      .filter((memory) => !request.lifetime || memory.lifetime === request.lifetime)
      .filter((memory) => !request.scope || memory.scope === request.scope)
      .filter((memory) => matchesTag(memory, request.tag))
      .filter((memory) =>
        matchesDateRange(memory.createdAt, request.createdFrom, request.createdTo),
      )
      .filter((memory) =>
        matchesDateRange(memory.updatedAt, request.updatedFrom, request.updatedTo),
      )
      .map((memory) => ({
        memory,
        score: scoreMemory(memory, query),
      }))
      .filter((item) => !query || item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.memory.updatedAt.localeCompare(left.memory.updatedAt);
      });

    return scored.slice(0, normalizeLimit(request.limit)).map((item) => item.memory);
  }

  async searchForRun(agentId: string, query: string, limit = 8): Promise<MemorySearchResult[]> {
    validateAgentId(agentId);
    await this.ensureReady();
    const normalizedQuery = normalizeQuery(query);
    const memories = await this.readCandidateMemories({
      agentId,
      status: 'active',
    });
    const recallIntent = hasRecallIntent(query);
    const baseScored = memories
      .filter((memory) => memory.status === 'active')
      .map((memory) => ({
        memory,
        score: scoreMemoryForRun(memory, normalizedQuery, recallIntent),
      }))
      .filter((item) => item.score > 0);
    const semanticScored = await this.trySemanticScore(
      query,
      memories.filter((memory) => memory.status === 'active'),
      baseScored,
    );
    const scored = semanticScored
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.memory.updatedAt.localeCompare(left.memory.updatedAt);
      })
      .slice(0, normalizeLimit(limit));

    return scored.map((item) => ({
      memory: item.memory,
      source: {
        memoryId: item.memory.id,
        scope: item.memory.scope,
        agentId: item.memory.agentId,
        type: item.memory.type,
        score: item.score,
      },
    }));
  }

  async readMemory(memoryId: string): Promise<MemoryRecord | null> {
    validateMemoryId(memoryId);
    await this.ensureReady();

    const row = this.database
      .get()
      .prepare('select * from memory_records where id = ?')
      .get(memoryId);

    return row ? memoryFromRow(row) : null;
  }

  async createMemory(request: CreateMemoryRequest): Promise<MemoryRecord> {
    await this.ensureReady();
    const now = new Date().toISOString();
    const memory: MemoryRecord = {
      id: crypto.randomUUID(),
      scope: normalizeScope(request.scope),
      agentId: normalizeMemoryAgentId(request.scope, request.agentId),
      type: normalizeType(request.type),
      status: 'active',
      lifetime: request.lifetime ? normalizeLifetime(request.lifetime) : 'active',
      content: normalizeContent(request.content),
      contentLines: contentLinesFor(request.content),
      tags: normalizeTags(request.tags ?? []),
      source: request.source,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeMemory(memory, 'insert');

    return memory;
  }

  async updateMemory(memoryId: string, request: UpdateMemoryRequest): Promise<MemoryRecord> {
    const existing = await this.requireMemory(memoryId);
    const updated: MemoryRecord = {
      ...existing,
      type: request.type ? normalizeType(request.type) : existing.type,
      status: request.status ? normalizeStatus(request.status) : existing.status,
      lifetime: request.lifetime ? normalizeLifetime(request.lifetime) : existing.lifetime,
      content: request.content === undefined ? existing.content : normalizeContent(request.content),
      contentLines:
        request.content === undefined
          ? contentLinesFor(existing.content)
          : contentLinesFor(request.content),
      tags: request.tags === undefined ? existing.tags : normalizeTags(request.tags),
      source: request.source === undefined ? existing.source : request.source,
      updatedAt: new Date().toISOString(),
    };

    await this.writeMemory(updated, 'replace');

    return updated;
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    validateMemoryId(memoryId);
    const memory = await this.readMemory(memoryId);

    if (!memory) {
      return false;
    }

    this.database.get().prepare('delete from memory_records where id = ?').run(memory.id);

    return true;
  }

  async deleteThreadSummaryMemories(agentId: string, threadId: string): Promise<number> {
    validateAgentId(agentId);
    const memories = await this.listMemories({
      agentId,
      scope: 'agent',
      type: 'conversation_summary',
      status: 'active',
      limit: 100,
    });
    const summaries = memories.filter(
      (memory) =>
        memory.type === 'conversation_summary' &&
        memory.source?.agentId === agentId &&
        memory.source.threadId === threadId,
    );

    await Promise.all(summaries.map(async (memory) => await this.deleteMemory(memory.id)));

    return summaries.length;
  }

  async requireMemory(memoryId: string): Promise<MemoryRecord> {
    const memory = await this.readMemory(memoryId);

    if (!memory) {
      throw new Error(`Memory ${memoryId} does not exist.`);
    }

    return memory;
  }

  async findThreadSummary(agentId: string, threadId: string): Promise<MemoryRecord | null> {
    validateAgentId(agentId);
    const memories = await this.listMemories({
      agentId,
      scope: 'agent',
      type: 'conversation_summary',
      status: 'active',
      limit: 100,
    });

    return memories.find((memory) => memory.source?.threadId === threadId) ?? null;
  }

  private async readCandidateMemories(request: MemoryListRequest): Promise<MemoryRecord[]> {
    const allMemories = await this.readAllMemories();

    if (request.scope === 'user') {
      return allMemories.filter((memory) => memory.scope === 'user');
    }

    if (request.agentId) {
      validateAgentId(request.agentId);
      const agentMemories = allMemories.filter((memory) => memory.agentId === request.agentId);

      if (request.scope === 'agent' || request.scope === 'agent_user') {
        return agentMemories.filter((memory) => memory.scope === request.scope);
      }

      return [...agentMemories, ...allMemories.filter((memory) => memory.scope === 'user')];
    }

    return allMemories;
  }

  private async readAllMemories(): Promise<MemoryRecord[]> {
    const rows = this.database
      .get()
      .prepare('select * from memory_records order by updated_at desc')
      .all();

    return rows.map((row) => memoryFromRow(row));
  }

  private async readMemoriesFromDir(dir: string): Promise<MemoryRecord[]> {
    try {
      const fileNames = await readdir(dir);
      const memories = await Promise.all(
        fileNames
          .filter((fileName) => fileName.endsWith('.json'))
          .map(async (fileName) => parseMemoryRecord(await readFile(join(dir, fileName), 'utf8'))),
      );

      return memories.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private writeMemory(memory: MemoryRecord, mode: 'insert' | 'replace' | 'insert-or-ignore'): void {
    const statement =
      mode === 'insert-or-ignore'
        ? 'insert or ignore into memory_records'
        : mode === 'replace'
          ? 'insert or replace into memory_records'
          : 'insert into memory_records';

    this.database
      .get()
      .prepare(
        `
          ${statement} (
            id,
            scope,
            agent_id,
            type,
            status,
            lifetime,
            content,
            content_lines_json,
            tags_json,
            source_json,
            created_at,
            updated_at
          ) values (
            @id,
            @scope,
            @agentId,
            @type,
            @status,
            @lifetime,
            @content,
            @contentLinesJson,
            @tagsJson,
            @sourceJson,
            @createdAt,
            @updatedAt
          )
        `,
      )
      .run(memoryToRow(memory));
  }

  private userMemoriesDir(): string {
    return join(this.dataDir, 'user', 'memories');
  }

  private agentMemoriesDir(agentId: string): string {
    return join(this.dataDir, 'agents', agentId, 'memories');
  }

  private async importJsonMemories(): Promise<void> {
    const importMarker = this.database
      .get()
      .prepare("select value from schema_metadata where key = 'memory_json_imported_at'")
      .get();

    if (importMarker) {
      await this.deleteImportedJsonMemories();
      return;
    }

    const memories = await this.readJsonMemoriesForImport();

    for (const memory of memories) {
      this.writeMemory(memory, 'insert-or-ignore');
    }

    this.database
      .get()
      .prepare(
        `
          insert into schema_metadata (key, value)
          values ('memory_json_imported_at', ?)
        `,
      )
      .run(new Date().toISOString());
    await this.deleteImportedJsonMemories();
  }

  private async readJsonMemoriesForImport(): Promise<MemoryRecord[]> {
    const agentsDir = join(this.dataDir, 'agents');
    const userMemories = await this.readMemoriesFromDir(this.userMemoriesDir());

    let agentIds: string[] = [];
    try {
      agentIds = (await readdir(agentsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    const agentMemories = await Promise.all(
      agentIds.map(
        async (agentId) => await this.readMemoriesFromDir(this.agentMemoriesDir(agentId)),
      ),
    );

    return [...userMemories, ...agentMemories.flat()];
  }

  private async deleteImportedJsonMemories(): Promise<void> {
    const agentsDir = join(this.dataDir, 'agents');
    const memoryDirs = [this.userMemoriesDir()];

    try {
      memoryDirs.push(
        ...(await readdir(agentsDir, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.agentMemoriesDir(entry.name)),
      );
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    await Promise.all(
      memoryDirs.map(async (dir) => {
        try {
          const fileNames = await readdir(dir);

          await Promise.all(
            fileNames
              .filter((fileName) => fileName.endsWith('.json'))
              .map(async (fileName) => {
                const path = join(dir, fileName);
                const memory = parseMemoryRecord(await readFile(path, 'utf8'));
                const row = this.database
                  .get()
                  .prepare('select id from memory_records where id = ?')
                  .get(memory.id);

                if (row) {
                  await rm(path, { force: true });
                }
              }),
          );
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }),
    );
  }

  private memoryIndexDir(): string {
    return join(this.dataDir, 'memory-index');
  }

  private embeddingCachePath(): string {
    return join(this.memoryIndexDir(), 'openai-embeddings.json');
  }

  private async trySemanticScore(
    query: string,
    memories: readonly MemoryRecord[],
    baseScored: readonly ScoredMemory[],
  ): Promise<ScoredMemory[]> {
    if (!process.env['OPENAI_API_KEY'] || !query.trim() || !memories.length) {
      return [...baseScored];
    }

    try {
      const semanticScored = await this.semanticScore(query, memories);
      const byId = new Map(baseScored.map((item) => [item.memory.id, item]));

      for (const semantic of semanticScored) {
        const existing = byId.get(semantic.memory.id);
        const score = existing
          ? existing.score + semantic.score
          : semantic.score >= 0.65
            ? semantic.score
            : 0;

        if (score > 0) {
          byId.set(semantic.memory.id, {
            memory: semantic.memory,
            score,
          });
        }
      }

      return [...byId.values()];
    } catch {
      return [...baseScored];
    }
  }

  private async semanticScore(
    query: string,
    memories: readonly MemoryRecord[],
  ): Promise<ScoredMemory[]> {
    const cache = await this.readEmbeddingCache();
    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env['OPENAI_API_KEY'],
      model: embeddingModel,
    });
    const queryEmbedding = await embeddings.embedQuery(query);
    const missing = memories.filter((memory) => !isCachedEmbeddingValid(cache[memory.id], memory));

    if (missing.length) {
      const vectors = await embeddings.embedDocuments(
        missing.map((memory) => memoryEmbeddingText(memory)),
      );

      missing.forEach((memory, index) => {
        const vector = vectors[index];

        if (!vector) {
          return;
        }

        cache[memory.id] = {
          memoryId: memory.id,
          memoryUpdatedAt: memory.updatedAt,
          model: embeddingModel,
          embedding: vector,
        };
      });

      await this.writeEmbeddingCache(cache);
    }

    return memories
      .map((memory) => {
        const entry = cache[memory.id];
        const similarity = entry ? cosineSimilarity(queryEmbedding, entry.embedding) : 0;

        return {
          memory,
          score: Math.max(0, similarity) * 2 + memoryTypeBoost(memory),
        };
      })
      .filter((item) => item.score > 0);
  }

  private async readEmbeddingCache(): Promise<EmbeddingCacheFile> {
    try {
      const parsed = JSON.parse(await readFile(this.embeddingCachePath(), 'utf8')) as unknown;

      return isEmbeddingCacheFile(parsed) ? parsed : {};
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return {};
      }

      throw error;
    }
  }

  private async writeEmbeddingCache(cache: EmbeddingCacheFile): Promise<void> {
    await mkdir(this.memoryIndexDir(), { recursive: true });
    await writeFile(this.embeddingCachePath(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  }
}

export interface MemorySearchResult {
  readonly memory: MemoryRecord;
  readonly source: MemoryContextSource;
}

interface ScoredMemory {
  readonly memory: MemoryRecord;
  readonly score: number;
}

interface EmbeddingCacheEntry {
  readonly memoryId: string;
  readonly memoryUpdatedAt: string;
  readonly model: string;
  readonly embedding: readonly number[];
}

type EmbeddingCacheFile = Record<string, EmbeddingCacheEntry>;

function parseMemoryRecord(raw: string): MemoryRecord {
  const value = JSON.parse(raw) as unknown;

  if (!isMemoryRecord(value)) {
    throw new Error('Invalid memory record.');
  }

  return value;
}

interface MemoryRecordRow {
  readonly id: string;
  readonly scope: string;
  readonly agent_id?: string | null;
  readonly type: string;
  readonly status: string;
  readonly lifetime: string;
  readonly content: string;
  readonly content_lines_json?: string | null;
  readonly tags_json: string;
  readonly source_json?: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function memoryToRow(memory: MemoryRecord) {
  const contentLines = memory.contentLines ?? contentLinesFor(memory.content);

  return {
    id: memory.id,
    scope: memory.scope,
    agentId: memory.agentId ?? null,
    type: memory.type,
    status: memory.status,
    lifetime: memory.lifetime,
    content: memory.content,
    contentLinesJson: contentLines ? JSON.stringify(contentLines) : null,
    tagsJson: JSON.stringify(memory.tags),
    sourceJson: memory.source ? JSON.stringify(memory.source) : null,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

function memoryFromRow(row: unknown): MemoryRecord {
  if (!isMemoryRecordRow(row)) {
    throw new Error('Invalid memory database row.');
  }

  const contentLines = parseJsonField<unknown>(row.content_lines_json);
  const source = parseJsonField<unknown>(row.source_json);
  const memory: MemoryRecord = {
    id: row.id,
    scope: normalizeScope(row.scope as MemoryScope),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    type: normalizeType(row.type as MemoryType),
    status: normalizeStatus(row.status as MemoryStatus),
    lifetime: normalizeLifetime(row.lifetime as MemoryLifetime),
    content: row.content,
    ...(Array.isArray(contentLines) ? { contentLines } : {}),
    tags: parseJsonField<readonly string[]>(row.tags_json),
    ...(source ? { source } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (!isMemoryRecord(memory)) {
    throw new Error('Invalid memory record from database.');
  }

  return memory;
}

function isMemoryRecordRow(value: unknown): value is MemoryRecordRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MemoryRecordRow).id === 'string' &&
    typeof (value as MemoryRecordRow).scope === 'string' &&
    typeof (value as MemoryRecordRow).type === 'string' &&
    typeof (value as MemoryRecordRow).status === 'string' &&
    typeof (value as MemoryRecordRow).lifetime === 'string' &&
    typeof (value as MemoryRecordRow).content === 'string' &&
    typeof (value as MemoryRecordRow).tags_json === 'string' &&
    typeof (value as MemoryRecordRow).created_at === 'string' &&
    typeof (value as MemoryRecordRow).updated_at === 'string'
  );
}

function parseJsonField<T>(value: string | null | undefined): T {
  return JSON.parse(value ?? 'null') as T;
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'scope' in value &&
    'type' in value &&
    'status' in value &&
    'lifetime' in value &&
    'content' in value &&
    'tags' in value &&
    'createdAt' in value &&
    'updatedAt' in value &&
    typeof value.id === 'string' &&
    memoryScopes.has(value.scope as MemoryScope) &&
    memoryTypes.has(value.type as MemoryType) &&
    memoryStatuses.has(value.status as MemoryStatus) &&
    memoryLifetimes.has(value.lifetime as MemoryLifetime) &&
    typeof value.content === 'string' &&
    (!('contentLines' in value) ||
      (Array.isArray(value.contentLines) &&
        value.contentLines.every((line) => typeof line === 'string'))) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (!('agentId' in value) || typeof value.agentId === 'string')
  );
}

function normalizeMemoryAgentId(
  scope: MemoryScope,
  agentId: string | undefined,
): string | undefined {
  if (scope === 'user') {
    return undefined;
  }

  if (!agentId) {
    throw new Error('Agent-scoped memories require agentId.');
  }

  validateAgentId(agentId);

  return agentId;
}

function normalizeScope(scope: MemoryScope): MemoryScope {
  if (!memoryScopes.has(scope)) {
    throw new Error('Memory scope must be agent, agent_user, or user.');
  }

  return scope;
}

function normalizeType(type: MemoryType): MemoryType {
  if (!memoryTypes.has(type)) {
    throw new Error('Unsupported memory type.');
  }

  return type;
}

function normalizeStatus(status: MemoryStatus): MemoryStatus {
  if (!memoryStatuses.has(status)) {
    throw new Error('Unsupported memory status.');
  }

  return status;
}

function normalizeLifetime(lifetime: MemoryLifetime): MemoryLifetime {
  if (!memoryLifetimes.has(lifetime)) {
    throw new Error('Unsupported memory lifetime.');
  }

  return lifetime;
}

function normalizeContent(content: string): string {
  const normalized = content.trim();

  if (!normalized) {
    throw new Error('Memory content is required.');
  }

  return normalized;
}

function contentLinesFor(content: string): readonly string[] | undefined {
  const normalized = content.trim();

  return normalized.includes('\n') ? normalized.split('\n') : undefined;
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

function matchesTag(memory: MemoryRecord, tag: string | undefined): boolean {
  const normalized = tag?.trim().toLowerCase();

  return !normalized || memory.tags.includes(normalized);
}

function matchesDateRange(
  value: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  const lower = normalizeDateBoundary(from, 'start');
  const upper = normalizeDateBoundary(to, 'end');

  return (!lower || value >= lower) && (!upper || value <= upper);
}

function normalizeDateBoundary(
  value: string | undefined,
  edge: 'start' | 'end',
): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return edge === 'start' ? `${normalized}T00:00:00.000Z` : `${normalized}T23:59:59.999Z`;
  }

  return normalized;
}

function validateMemoryId(memoryId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(memoryId)) {
    throw new Error('Memory id must be a UUID.');
  }
}

function normalizeQuery(query: string | undefined): readonly string[] {
  return [...new Set(query?.toLowerCase().match(/[a-z0-9äöüß]+/gi) ?? [])].filter(
    (token) => token.length > 2,
  );
}

function scoreMemory(memory: MemoryRecord, query: readonly string[]): number {
  if (!query.length) {
    return 1;
  }

  const haystack = `${memory.content} ${memory.tags.join(' ')} ${memory.type}`.toLowerCase();

  return query.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function scoreMemoryForRun(
  memory: MemoryRecord,
  query: readonly string[],
  recallIntent: boolean,
): number {
  const lexicalScore = scoreMemory(memory, query);

  if (lexicalScore > 0) {
    return lexicalScore + memoryTypeBoost(memory);
  }

  if (recallIntent && memory.type === 'conversation_summary') {
    return 0.75 + memoryTypeBoost(memory);
  }

  if (memory.lifetime === 'permanent' && (memory.type === 'preference' || memory.type === 'fact')) {
    return 0.5 + memoryTypeBoost(memory);
  }

  return 0;
}

function memoryTypeBoost(memory: MemoryRecord): number {
  switch (memory.type) {
    case 'conversation_summary':
      return 0.35;
    case 'open_task':
    case 'tracked_topic':
      return 0.25;
    case 'preference':
      return 0.2;
    case 'fact':
      return 0.1;
  }
}

function memoryEmbeddingText(memory: MemoryRecord): string {
  return [
    `type: ${memory.type}`,
    `scope: ${memory.scope}`,
    `lifetime: ${memory.lifetime}`,
    memory.tags.length ? `tags: ${memory.tags.join(', ')}` : '',
    memory.content,
  ]
    .filter(Boolean)
    .join('\n');
}

function isCachedEmbeddingValid(
  entry: EmbeddingCacheEntry | undefined,
  memory: MemoryRecord,
): entry is EmbeddingCacheEntry {
  return (
    !!entry &&
    entry.memoryId === memory.id &&
    entry.memoryUpdatedAt === memory.updatedAt &&
    entry.model === embeddingModel &&
    entry.embedding.length > 0
  );
}

function isEmbeddingCacheFile(value: unknown): value is EmbeddingCacheFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => isEmbeddingCacheEntry(entry))
  );
}

function isEmbeddingCacheEntry(value: unknown): value is EmbeddingCacheEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'memoryId' in value &&
    'memoryUpdatedAt' in value &&
    'model' in value &&
    'embedding' in value &&
    typeof value.memoryId === 'string' &&
    typeof value.memoryUpdatedAt === 'string' &&
    typeof value.model === 'string' &&
    isNumberArray(value.embedding)
  );
}

function isNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);

  if (!length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function hasRecallIntent(query: string): boolean {
  const normalized = query.toLowerCase();
  const recallWords = [
    'last conversation',
    'previous conversation',
    'last chat',
    'previous chat',
    'what did we talk',
    'what we discussed',
    'remember what',
    'recall',
    'talked about',
    'discussed',
    'letzte',
    'letzten',
    'vorherige',
    'vorherigen',
    'besprochen',
    'gesprochen',
    'erinnerst du',
  ];

  return recallWords.some((word) => normalized.includes(word));
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit) {
    return 50;
  }

  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
