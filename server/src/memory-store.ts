import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.userMemoriesDir(), { recursive: true });
    await mkdir(join(this.dataDir, 'agents'), { recursive: true });
    await mkdir(this.memoryIndexDir(), { recursive: true });
  }

  async listMemories(request: MemoryListRequest = {}): Promise<MemoryRecord[]> {
    await this.ensureReady();
    const status = request.status ?? 'active';
    const memories = await this.readCandidateMemories(request);
    const query = normalizeQuery(request.query);
    const scored = memories
      .filter((memory) => memory.status === status)
      .filter((memory) => !request.type || memory.type === request.type)
      .filter((memory) => !request.scope || memory.scope === request.scope)
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

    for (const memory of await this.readAllMemories()) {
      if (memory.id === memoryId) {
        return memory;
      }
    }

    return null;
  }

  async createMemory(request: CreateMemoryRequest): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const memory: MemoryRecord = {
      id: crypto.randomUUID(),
      scope: normalizeScope(request.scope),
      agentId: normalizeMemoryAgentId(request.scope, request.agentId),
      type: normalizeType(request.type),
      status: 'active',
      lifetime: request.lifetime ? normalizeLifetime(request.lifetime) : 'active',
      content: normalizeContent(request.content),
      tags: normalizeTags(request.tags ?? []),
      source: request.source,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeMemory(memory);

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
      tags: request.tags === undefined ? existing.tags : normalizeTags(request.tags),
      source: request.source === undefined ? existing.source : request.source,
      updatedAt: new Date().toISOString(),
    };

    await this.writeMemory(updated);

    return updated;
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    validateMemoryId(memoryId);
    const memory = await this.readMemory(memoryId);

    if (!memory) {
      return false;
    }

    await rm(this.memoryPath(memory), { force: true });

    return true;
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
    if (request.scope === 'user') {
      return await this.readMemoriesFromDir(this.userMemoriesDir());
    }

    if (request.agentId) {
      validateAgentId(request.agentId);
      const agentMemories = await this.readMemoriesFromDir(this.agentMemoriesDir(request.agentId));

      if (request.scope === 'agent' || request.scope === 'agent_user') {
        return agentMemories.filter((memory) => memory.scope === request.scope);
      }

      return [...agentMemories, ...(await this.readMemoriesFromDir(this.userMemoriesDir()))];
    }

    return await this.readAllMemories();
  }

  private async readAllMemories(): Promise<MemoryRecord[]> {
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

  private async writeMemory(memory: MemoryRecord): Promise<void> {
    const path = this.memoryPath(memory);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
  }

  private memoryPath(memory: MemoryRecord): string {
    return join(this.memoryDir(memory), `${memory.id}.json`);
  }

  private memoryDir(memory: Pick<MemoryRecord, 'scope' | 'agentId'>): string {
    return memory.scope === 'user'
      ? this.userMemoriesDir()
      : this.agentMemoriesDir(requireAgentId(memory.agentId));
  }

  private userMemoriesDir(): string {
    return join(this.dataDir, 'user', 'memories');
  }

  private agentMemoriesDir(agentId: string): string {
    return join(this.dataDir, 'agents', agentId, 'memories');
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

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

function validateMemoryId(memoryId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(memoryId)) {
    throw new Error('Memory id must be a UUID.');
  }
}

function requireAgentId(agentId: string | undefined): string {
  if (!agentId) {
    throw new Error('Memory is missing agentId.');
  }

  validateAgentId(agentId);

  return agentId;
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
