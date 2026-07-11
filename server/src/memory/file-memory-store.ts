import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

import type { MemoryScope } from '../../../shared/agent-contracts';
import { validateAgentId } from '../agents/agent-registry';
import type { MemorySemanticIndex } from './semantic-memory-index';

export const defaultPinnedMemoryCharacterLimit = 3_000;

export interface FileMemorySource {
  readonly agentId?: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly note?: string;
}

export interface FileMemoryEntry {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly pinned: boolean;
  readonly content: string;
  readonly tags: readonly string[];
  readonly source?: FileMemorySource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FileMemoryListRequest {
  readonly agentId?: string;
  readonly scope?: MemoryScope;
  readonly pinned?: boolean;
  readonly tag?: string;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly updatedFrom?: string;
  readonly updatedTo?: string;
  readonly query?: string;
  readonly limit?: number;
}

export interface CreateFileMemoryRequest {
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly pinned?: boolean;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly source?: FileMemorySource;
}

export interface UpdateFileMemoryRequest {
  readonly pinned?: boolean;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly source?: FileMemorySource;
}

export interface PinnedMemoryBudget {
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly usedCharacters: number;
  readonly limitCharacters: number;
}

interface FileMemoryMetadata {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly pinned: boolean;
  readonly tags: readonly string[];
  readonly source?: FileMemorySource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class FileMemoryStore {
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly pinnedCharacterLimit = defaultPinnedMemoryCharacterLimit,
    private readonly semanticIndex?: MemorySemanticIndex,
  ) {}

  async ensureReady(): Promise<void> {
    this.readyPromise ??= this.initialize();
    await this.readyPromise;
  }

  private async initialize(): Promise<void> {
    await Promise.all([
      rm(join(this.dataDir, 'memory-index'), { recursive: true, force: true }),
      rm(join(this.dataDir, 'memory-maintenance-settings.json'), { force: true }),
      rm(join(this.dataDir, 'user', 'memories'), { recursive: true, force: true }),
      rm(join(this.dataDir, 'deepagent'), { recursive: true, force: true }),
    ]);
    await mkdir(this.globalMemoryDir(), { recursive: true });
    const entries = await this.readCandidateEntries({});
    await this.semanticIndex?.ensureReady(entries);
  }

  async listEntries(request: FileMemoryListRequest = {}): Promise<FileMemoryEntry[]> {
    await this.ensureReady();
    const entries = await this.readCandidateEntries(request);
    const query = request.query?.trim();
    const tag = request.tag?.trim().toLocaleLowerCase();
    const filtered = entries
      .filter((entry) => request.pinned === undefined || entry.pinned === request.pinned)
      .filter((entry) => !tag || entry.tags.includes(tag))
      .filter((entry) => !request.createdFrom || entry.createdAt >= request.createdFrom)
      .filter((entry) => !request.createdTo || entry.createdAt <= request.createdTo)
      .filter((entry) => !request.updatedFrom || entry.updatedAt >= request.updatedFrom)
      .filter((entry) => !request.updatedTo || entry.updatedAt <= request.updatedTo);
    const limit = normalizeLimit(request.limit);

    if (!query) {
      return filtered
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);
    }

    return await this.searchEntries(filtered, query, limit);
  }

  async readEntry(memoryId: string): Promise<FileMemoryEntry | null> {
    validateMemoryId(memoryId);
    const entries = await this.listEntries({ limit: 10_000 });

    return entries.find((entry) => entry.id === memoryId) ?? null;
  }

  async requireEntry(memoryId: string): Promise<FileMemoryEntry> {
    const entry = await this.readEntry(memoryId);

    if (!entry) {
      throw new Error(`Memory ${memoryId} does not exist.`);
    }

    return entry;
  }

  async createEntry(request: CreateFileMemoryRequest): Promise<FileMemoryEntry> {
    await this.ensureReady();
    const now = new Date().toISOString();
    const entry: FileMemoryEntry = {
      id: crypto.randomUUID(),
      scope: normalizeScope(request.scope),
      ...normalizeAgentId(request.scope, request.agentId),
      pinned: request.pinned ?? false,
      content: normalizeContent(request.content),
      tags: normalizeTags(request.tags ?? []),
      ...(request.source ? { source: request.source } : {}),
      createdAt: now,
      updatedAt: now,
    };

    await this.assertPinnedBudget(entry);
    await this.writeEntry(entry);
    await this.semanticIndex?.invalidate(entry.id);

    return entry;
  }

  async updateEntry(memoryId: string, request: UpdateFileMemoryRequest): Promise<FileMemoryEntry> {
    const existing = await this.requireEntry(memoryId);
    const entry: FileMemoryEntry = {
      ...existing,
      pinned: request.pinned ?? existing.pinned,
      content: request.content === undefined ? existing.content : normalizeContent(request.content),
      tags: request.tags === undefined ? existing.tags : normalizeTags(request.tags),
      source: request.source === undefined ? existing.source : request.source,
      updatedAt: new Date().toISOString(),
    };

    await this.assertPinnedBudget(entry, existing.id);
    await this.writeEntry(entry);
    await this.semanticIndex?.invalidate(entry.id);

    return entry;
  }

  async deleteEntry(memoryId: string): Promise<boolean> {
    const existing = await this.readEntry(memoryId);

    if (!existing) {
      return false;
    }

    await rm(this.entryPath(existing), { force: true });
    await this.semanticIndex?.delete(existing.id);
    return true;
  }

  async pinnedPathsForAgent(agentId: string): Promise<string[]> {
    validateAgentId(agentId);
    const entries = await this.listEntries({ agentId, pinned: true, limit: 10_000 });

    return entries.map((entry) => virtualPathFor(entry));
  }

  async pinnedEntriesForAgent(agentId: string): Promise<FileMemoryEntry[]> {
    validateAgentId(agentId);
    return await this.listEntries({ agentId, pinned: true, limit: 10_000 });
  }

  virtualPath(entry: FileMemoryEntry): string {
    return virtualPathFor(entry);
  }

  async pinnedBudgetsForAgent(agentId: string): Promise<PinnedMemoryBudget[]> {
    validateAgentId(agentId);

    return await Promise.all(
      (['user', 'agent_user', 'agent'] as const).map(async (scope) => {
        const entries = await this.listEntries({ agentId, scope, pinned: true, limit: 10_000 });

        return {
          scope,
          ...(scope === 'user' ? {} : { agentId }),
          usedCharacters: entries.reduce(
            (total, entry) => total + pinnedContentSize(entry.content),
            0,
          ),
          limitCharacters: this.pinnedCharacterLimit,
        };
      }),
    );
  }

  memoryDirectoriesForAgent(agentId: string): AgentMemoryDirectories {
    validateAgentId(agentId);

    return {
      global: this.globalMemoryDir(),
      agentUser: this.agentUserMemoryDir(agentId),
      agent: this.agentMemoryDir(agentId),
    };
  }

  private async searchEntries(
    entries: readonly FileMemoryEntry[],
    query: string,
    limit: number,
  ): Promise<FileMemoryEntry[]> {
    const normalizedQuery = query.toLocaleLowerCase();
    const exact = entries.filter((entry) =>
      `${entry.content}\n${entry.tags.join(' ')}`.toLocaleLowerCase().includes(normalizedQuery),
    );

    if (exact.length || !this.semanticIndex) {
      return exact
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);
    }

    const semantic = await this.semanticIndex.search(entries, query, limit);
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const ordered = semantic
      .map((match) => entriesById.get(match.memoryId))
      .filter((entry): entry is FileMemoryEntry => Boolean(entry));

    return [...new Map(ordered.map((entry) => [entry.id, entry])).values()].slice(0, limit);
  }

  private async assertPinnedBudget(entry: FileMemoryEntry, replacingId?: string): Promise<void> {
    if (!entry.pinned) {
      return;
    }

    const entries = await this.listEntries({
      agentId: entry.agentId,
      scope: entry.scope,
      pinned: true,
      limit: 10_000,
    });
    const used = entries
      .filter((candidate) => candidate.id !== replacingId)
      .reduce((total, candidate) => total + pinnedContentSize(candidate.content), 0);
    const requested = pinnedContentSize(entry.content);

    if (used + requested > this.pinnedCharacterLimit) {
      throw new Error(
        `Pinned ${entry.scope} memory would use ${used + requested}/${this.pinnedCharacterLimit} characters. Unpin, remove, or shorten an entry first.`,
      );
    }
  }

  private async readCandidateEntries(request: FileMemoryListRequest): Promise<FileMemoryEntry[]> {
    if (request.agentId) {
      validateAgentId(request.agentId);
    }

    const directories = await this.candidateDirectories(request);
    const nested = await Promise.all(
      directories.map(async (directory) => await readDirectory(directory)),
    );

    return nested.flat();
  }

  private async candidateDirectories(request: FileMemoryListRequest): Promise<string[]> {
    if (request.scope === 'user') {
      return [this.globalMemoryDir()];
    }

    if (request.agentId) {
      if (request.scope === 'agent') {
        return [this.agentMemoryDir(request.agentId)];
      }

      if (request.scope === 'agent_user') {
        return [this.agentUserMemoryDir(request.agentId)];
      }

      return [
        this.globalMemoryDir(),
        this.agentUserMemoryDir(request.agentId),
        this.agentMemoryDir(request.agentId),
      ];
    }

    const agentIds = await this.listAgentIds();
    const agentDirectories = agentIds.flatMap((agentId) => {
      if (request.scope === 'agent') {
        return [this.agentMemoryDir(agentId)];
      }

      if (request.scope === 'agent_user') {
        return [this.agentUserMemoryDir(agentId)];
      }

      return [this.agentUserMemoryDir(agentId), this.agentMemoryDir(agentId)];
    });

    return request.scope ? agentDirectories : [this.globalMemoryDir(), ...agentDirectories];
  }

  private async listAgentIds(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.dataDir, 'agents'), { withFileTypes: true });

      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private async writeEntry(entry: FileMemoryEntry): Promise<void> {
    const path = this.entryPath(entry);
    await mkdir(this.scopeDir(entry.scope, entry.agentId), { recursive: true });
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, serializeEntry(entry), 'utf8');
    await rename(temporaryPath, path);
  }

  private entryPath(entry: Pick<FileMemoryEntry, 'id' | 'scope' | 'agentId'>): string {
    return join(this.scopeDir(entry.scope, entry.agentId), `${entry.id}.md`);
  }

  private scopeDir(scope: MemoryScope, agentId?: string): string {
    if (scope === 'user') {
      return this.globalMemoryDir();
    }

    if (!agentId) {
      throw new Error('Agent-scoped memories require agentId.');
    }

    return scope === 'agent' ? this.agentMemoryDir(agentId) : this.agentUserMemoryDir(agentId);
  }

  private globalMemoryDir(): string {
    return join(this.dataDir, 'user', 'memory');
  }

  private agentMemoryDir(agentId: string): string {
    return join(this.dataDir, 'agents', agentId, 'memory', 'agent');
  }

  private agentUserMemoryDir(agentId: string): string {
    return join(this.dataDir, 'agents', agentId, 'memory', 'user');
  }
}

export interface AgentMemoryDirectories {
  readonly global: string;
  readonly agentUser: string;
  readonly agent: string;
}

async function readDirectory(directory: string): Promise<FileMemoryEntry[]> {
  try {
    const names = (await readdir(directory)).filter(
      (name) => name.endsWith('.md') && isMemoryId(name.slice(0, -3)),
    );

    return await Promise.all(
      names.map(async (name) => parseEntry(await readFile(join(directory, name), 'utf8'))),
    );
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function serializeEntry(entry: FileMemoryEntry): string {
  const metadata: FileMemoryMetadata = {
    id: entry.id,
    scope: entry.scope,
    ...(entry.agentId ? { agentId: entry.agentId } : {}),
    pinned: entry.pinned,
    tags: entry.tags,
    ...(entry.source ? { source: entry.source } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };

  return `---\n${stringify(metadata).trimEnd()}\n---\n\n${entry.content.trim()}\n`;
}

function parseEntry(value: string): FileMemoryEntry {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(value);

  if (!match?.[1] || match[2] === undefined) {
    throw new Error('Invalid memory Markdown frontmatter.');
  }

  const metadata = parse(match[1]) as unknown;

  if (!isFileMemoryMetadata(metadata)) {
    throw new Error('Invalid memory Markdown metadata.');
  }

  return {
    ...metadata,
    content: normalizeContent(match[2]),
  };
}

function isFileMemoryMetadata(value: unknown): value is FileMemoryMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    isMemoryId(value.id) &&
    'scope' in value &&
    (value.scope === 'user' || value.scope === 'agent_user' || value.scope === 'agent') &&
    (!('agentId' in value) || typeof value.agentId === 'string') &&
    'pinned' in value &&
    typeof value.pinned === 'boolean' &&
    'tags' in value &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    'updatedAt' in value &&
    typeof value.updatedAt === 'string'
  );
}

function virtualPathFor(entry: FileMemoryEntry): string {
  const prefix =
    entry.scope === 'user'
      ? '/memory/global'
      : entry.scope === 'agent_user'
        ? '/memory/agent-user'
        : '/memory/agent';

  return `${prefix}/${entry.id}.md`;
}

function normalizeScope(scope: MemoryScope): MemoryScope {
  if (scope !== 'user' && scope !== 'agent_user' && scope !== 'agent') {
    throw new Error('Memory scope must be user, agent_user, or agent.');
  }

  return scope;
}

function normalizeAgentId(
  scope: MemoryScope,
  agentId: string | undefined,
): { readonly agentId?: string } {
  if (scope === 'user') {
    return {};
  }

  if (!agentId) {
    throw new Error('Agent-scoped memories require agentId.');
  }

  validateAgentId(agentId);
  return { agentId };
}

function normalizeContent(content: string): string {
  const normalized = content.trim();

  if (!normalized) {
    throw new Error('Memory content is required.');
  }

  return normalized;
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))].sort();
}

function pinnedContentSize(content: string): number {
  return content.trim().length + 2;
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 100, 1), 10_000);
}

function validateMemoryId(memoryId: string): void {
  if (!isMemoryId(memoryId)) {
    throw new Error('Memory id must be a UUID.');
  }
}

function isMemoryId(value: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
