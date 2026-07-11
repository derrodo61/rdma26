import { createHash } from 'node:crypto';

import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import type { FileMemoryEntry } from './file-memory-store';
import { LocalDatabase } from '../storage/local-database';

export interface SemanticMemoryMatch {
  readonly memoryId: string;
  readonly score: number;
}

export interface MemorySemanticIndex {
  ensureReady(entries: readonly FileMemoryEntry[]): Promise<void>;
  search(
    entries: readonly FileMemoryEntry[],
    query: string,
    limit: number,
  ): Promise<readonly SemanticMemoryMatch[]>;
  invalidate(memoryId: string): Promise<void>;
  delete(memoryId: string): Promise<void>;
}

interface MemoryEmbeddingRow {
  readonly memory_id: string;
  readonly content_hash: string;
  readonly model: string;
  readonly vector_json: string;
}

export class SqliteSemanticMemoryIndex implements MemorySemanticIndex {
  private readonly database: LocalDatabase;

  constructor(
    dataDir: string,
    private readonly embeddings: EmbeddingsInterface,
    private readonly model: string,
    private readonly minimumScore = 0.25,
  ) {
    this.database = new LocalDatabase(dataDir);
  }

  async ensureReady(entries: readonly FileMemoryEntry[]): Promise<void> {
    await this.database.ensureReady();
    const ids = new Set(entries.map((entry) => entry.id));
    const rows = this.database
      .get()
      .prepare('select memory_id from memory_embedding_cache')
      .all() as { readonly memory_id: string }[];
    const remove = this.database
      .get()
      .prepare('delete from memory_embedding_cache where memory_id = ?');
    const prune = this.database.get().transaction((memoryIds: readonly string[]) => {
      for (const memoryId of memoryIds) remove.run(memoryId);
    });

    prune(rows.filter((row) => !ids.has(row.memory_id)).map((row) => row.memory_id));
  }

  async search(
    entries: readonly FileMemoryEntry[],
    query: string,
    limit: number,
  ): Promise<readonly SemanticMemoryMatch[]> {
    if (!entries.length) return [];
    await this.ensureIndexed(entries);
    const queryVector = await this.embeddings.embedQuery(query);
    const rows = this.readRows(entries.map((entry) => entry.id));

    return rows
      .map((row) => ({
        memoryId: row.memory_id,
        score: cosineSimilarity(queryVector, parseVector(row.vector_json)),
      }))
      .filter((match) => match.score >= this.minimumScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async invalidate(memoryId: string): Promise<void> {
    await this.delete(memoryId);
  }

  async delete(memoryId: string): Promise<void> {
    await this.database.ensureReady();
    this.database
      .get()
      .prepare('delete from memory_embedding_cache where memory_id = ?')
      .run(memoryId);
  }

  private async ensureIndexed(entries: readonly FileMemoryEntry[]): Promise<void> {
    await this.database.ensureReady();
    const existing = new Map(
      this.readRows(entries.map((entry) => entry.id)).map((row) => [row.memory_id, row]),
    );
    const missing = entries.filter((entry) => {
      const row = existing.get(entry.id);
      return row?.content_hash !== contentHash(entry) || row.model !== this.model;
    });

    if (!missing.length) return;
    const vectors = await this.embeddings.embedDocuments(missing.map(memorySearchText));
    const upsert = this.database.get().prepare(`
      insert into memory_embedding_cache (
        memory_id, content_hash, model, dimensions, vector_json, updated_at
      ) values (?, ?, ?, ?, ?, ?)
      on conflict(memory_id) do update set
        content_hash = excluded.content_hash,
        model = excluded.model,
        dimensions = excluded.dimensions,
        vector_json = excluded.vector_json,
        updated_at = excluded.updated_at
    `);
    const write = this.database.get().transaction(() => {
      for (const [index, entry] of missing.entries()) {
        const vector = vectors[index];

        if (!vector?.length) {
          throw new Error(`Embedding model returned no vector for memory ${entry.id}.`);
        }

        upsert.run(
          entry.id,
          contentHash(entry),
          this.model,
          vector.length,
          JSON.stringify(vector),
          new Date().toISOString(),
        );
      }
    });

    write();
  }

  private readRows(memoryIds: readonly string[]): MemoryEmbeddingRow[] {
    if (!memoryIds.length) return [];
    const placeholders = memoryIds.map(() => '?').join(', ');

    return this.database
      .get()
      .prepare(
        `select memory_id, content_hash, model, vector_json
         from memory_embedding_cache
         where memory_id in (${placeholders})`,
      )
      .all(...memoryIds) as MemoryEmbeddingRow[];
  }
}

function memorySearchText(entry: FileMemoryEntry): string {
  return [entry.content, entry.tags.length ? `Tags: ${entry.tags.join(', ')}` : '']
    .filter(Boolean)
    .join('\n');
}

function contentHash(entry: FileMemoryEntry): string {
  return createHash('sha256').update(memorySearchText(entry)).digest('hex');
}

function parseVector(value: string): number[] {
  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed) || !parsed.every((part) => typeof part === 'number')) {
    throw new Error('Invalid cached memory embedding vector.');
  }

  return parsed;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (!left.length || left.length !== right.length) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) return -1;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
