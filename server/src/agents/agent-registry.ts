import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AgentKind,
  AgentMemorySettings,
  AgentModelSettings,
  AgentProfile,
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateAgentToolsRequest,
} from '../../../shared/agent-contracts';
import {
  createAssistantStorage,
  importThreadJsonFiles,
  type AssistantStorage,
} from '../storage/assistant-storage';
import { LocalDatabase } from '../storage/local-database';
import { costAnalystAgentId } from './system-agents';

const profileFileName = 'agent.json';
const soulVirtualPath = '/configuration/soul.md';

export class AgentRegistry {
  private readonly agentsDir: string;

  constructor(
    readonly dataDir: string,
    private readonly defaultAgentId: string,
    private readonly defaultAgentName: string,
  ) {
    this.agentsDir = join(dataDir, 'agents');
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.agentsDir, { recursive: true });
    const defaultAgent = await this.ensureAgent({
      id: this.defaultAgentId,
      name: this.defaultAgentName,
    });

    const storage = await this.storageFor(defaultAgent.id);
    await storage.ensureReady();
    await this.ensureAllAgentStorageReady();
    await this.importRootThreadJsonFiles(defaultAgent.id);
  }

  async listAgents(): Promise<AgentProfile[]> {
    await this.ensureReady();
    const entries = await readdir(this.agentsDir, { withFileTypes: true });
    const agents = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => await this.readAgent(entry.name)),
    );

    return agents
      .filter((agent): agent is AgentProfile => Boolean(agent))
      .sort((left, right) => {
        if (left.id === this.defaultAgentId) {
          return -1;
        }

        if (right.id === this.defaultAgentId) {
          return 1;
        }

        return left.name.localeCompare(right.name);
      });
  }

  async readAgent(agentId: string): Promise<AgentProfile | null> {
    validateAgentId(agentId);

    try {
      const raw = JSON.parse(await readFile(this.profilePath(agentId), 'utf8')) as unknown;
      const agent = parseAgentProfile(raw);

      if (!agent) {
        throw new Error(`Invalid agent profile: ${this.profilePath(agentId)}`);
      }

      if (!hasCurrentAgentProfileShape(raw)) {
        await this.writeAgent(agent);
      }

      return agent;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentProfile> {
    const id = normalizeAgentId(request.id ?? request.name);
    const existing = await this.readAgent(id);

    if (existing) {
      throw new Error(`Agent ${id} already exists.`);
    }

    return await this.writeNewAgent(
      id,
      request.name,
      normalizeAgentKind(request.kind ?? (id === this.defaultAgentId ? 'operator' : 'chat')),
      request.chatEnabled ?? request.kind !== 'internal',
    );
  }

  async updateAgent(agentId: string, request: UpdateAgentRequest): Promise<AgentProfile> {
    const existing = await this.readAgent(agentId);

    if (!existing) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    const updated: AgentProfile = {
      ...existing,
      name: request.name === undefined ? existing.name : normalizeAgentName(request.name),
      kind: request.kind === undefined ? existing.kind : normalizeAgentKind(request.kind),
      chatEnabled:
        request.chatEnabled === undefined ? existing.chatEnabled : Boolean(request.chatEnabled),
      memory: normalizeAgentMemorySettings(
        {
          ...existing.memory,
          ...request.memory,
        },
        existing.id,
      ),
      models: normalizeAgentModelSettings({
        ...existing.models,
        ...request.models,
        research: {
          ...existing.models.research,
          ...request.models?.research,
        },
      }),
      updatedAt: new Date().toISOString(),
    };

    await this.writeAgent(updated);

    return updated;
  }

  async updateAgentTools(agentId: string, request: UpdateAgentToolsRequest): Promise<AgentProfile> {
    const existing = await this.readAgent(agentId);

    if (!existing) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    const updated: AgentProfile = {
      ...existing,
      enabledTools: normalizeToolIds(request.enabledTools),
      updatedAt: new Date().toISOString(),
    };

    await this.writeAgent(updated);

    return updated;
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    validateAgentId(agentId);

    if (agentId === this.defaultAgentId || agentId === costAnalystAgentId) {
      throw new Error('Protected system agents cannot be deleted.');
    }

    const existing = await this.readAgent(agentId);

    if (!existing) {
      return false;
    }

    if (existing.kind === 'internal') {
      throw new Error('Protected system agents cannot be deleted.');
    }

    await rm(this.agentDir(agentId), {
      recursive: true,
      force: true,
    });
    await this.deleteAgentDatabaseRows(agentId);

    return true;
  }

  async ensureAgent(request: CreateAgentRequest & { readonly id: string }): Promise<AgentProfile> {
    const existing = await this.readAgent(request.id);

    if (existing) {
      return existing;
    }

    return await this.writeNewAgent(
      request.id,
      request.name,
      normalizeAgentKind(
        request.kind ?? (request.id === this.defaultAgentId ? 'operator' : 'chat'),
      ),
      request.chatEnabled ?? request.kind !== 'internal',
    );
  }

  async storageFor(agentId: string): Promise<AssistantStorage> {
    const agent = await this.readAgent(agentId);

    if (!agent) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    return createAssistantStorage(this.dataDir, agent);
  }

  getDefaultAgentId(): string {
    return this.defaultAgentId;
  }

  private async writeNewAgent(
    id: string,
    name: string,
    kind: AgentKind = id === this.defaultAgentId ? 'operator' : 'chat',
    chatEnabled: boolean = kind !== 'internal',
  ): Promise<AgentProfile> {
    validateAgentId(id);
    const now = new Date().toISOString();
    const agent: AgentProfile = {
      id,
      name: normalizeAgentName(name),
      kind,
      chatEnabled,
      enabledTools: [],
      memory: defaultAgentMemorySettings(id),
      models: {},
      soulVirtualPath,
      createdAt: now,
      updatedAt: now,
    };
    const storage = createAssistantStorage(this.dataDir, agent);

    await mkdir(this.agentDir(id), { recursive: true });
    await writeFile(this.profilePath(id), `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
    await storage.ensureReady();

    return agent;
  }

  private agentDir(agentId: string): string {
    return join(this.agentsDir, agentId);
  }

  private profilePath(agentId: string): string {
    return join(this.agentDir(agentId), profileFileName);
  }

  private async writeAgent(agent: AgentProfile): Promise<void> {
    await writeFile(this.profilePath(agent.id), `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
  }

  private async deleteAgentDatabaseRows(agentId: string): Promise<void> {
    const database = new LocalDatabase(this.dataDir);
    await database.ensureReady();
    const transaction = database.get().transaction(() => {
      database.get().prepare('delete from threads where agent_id = ?').run(agentId);
      database.get().prepare('delete from memory_records where agent_id = ?').run(agentId);
      database.get().prepare('delete from run_contexts where agent_id = ?').run(agentId);
    });

    transaction();
  }

  private async ensureAllAgentStorageReady(): Promise<void> {
    const entries = await readdir(this.agentsDir, { withFileTypes: true });
    const agentIds = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((agentId) => isValidAgentId(agentId));

    for (const agentId of agentIds) {
      const agent = await this.readAgent(agentId);

      if (!agent) {
        continue;
      }

      await createAssistantStorage(this.dataDir, agent).ensureReady();
    }
  }

  private async importRootThreadJsonFiles(defaultAgentId: string): Promise<void> {
    const database = new LocalDatabase(this.dataDir);
    await database.ensureReady();
    await importThreadJsonFiles(
      database,
      join(this.dataDir, 'threads'),
      defaultAgentId,
      'thread_json_imported_at:root',
    );
  }
}

function normalizeAgentId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  validateAgentId(normalized);

  return normalized;
}

export function validateAgentId(agentId: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(agentId)) {
    throw new Error('Agent id may only contain letters, numbers, underscores, and dashes.');
  }
}

function isValidAgentId(agentId: string): boolean {
  try {
    validateAgentId(agentId);

    return true;
  } catch {
    return false;
  }
}

function normalizeAgentName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error('Agent name is required.');
  }

  return normalized;
}

function parseAgentProfile(value: unknown): AgentProfile | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'soulVirtualPath' in value &&
    'createdAt' in value &&
    'updatedAt' in value &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.soulVirtualPath === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  ) {
    return {
      id: value.id,
      name: value.name,
      kind: 'kind' in value ? normalizeAgentKind(value.kind) : defaultAgentKindForId(value.id),
      chatEnabled:
        'chatEnabled' in value && typeof value.chatEnabled === 'boolean'
          ? value.chatEnabled
          : defaultAgentKindForId(value.id) !== 'internal',
      enabledTools:
        'enabledTools' in value && Array.isArray(value.enabledTools)
          ? normalizeToolIds(value.enabledTools)
          : [],
      memory:
        'memory' in value
          ? normalizeAgentMemorySettings(value.memory, value.id)
          : defaultAgentMemorySettings(value.id),
      models: 'models' in value ? normalizeAgentModelSettings(value.models) : {},
      soulVirtualPath: normalizeSoulVirtualPath(value.soulVirtualPath),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  return null;
}

function hasCurrentAgentProfileShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ['chat', 'operator', 'internal'].includes(
      (value as { readonly kind?: unknown }).kind as string,
    ) &&
    'chatEnabled' in value &&
    typeof value.chatEnabled === 'boolean' &&
    'enabledTools' in value &&
    Array.isArray(value.enabledTools) &&
    'memory' in value &&
    typeof value.memory === 'object' &&
    value.memory !== null &&
    'canRead' in value.memory &&
    typeof value.memory.canRead === 'boolean' &&
    'canWrite' in value.memory &&
    typeof value.memory.canWrite === 'boolean' &&
    'models' in value &&
    typeof value.models === 'object' &&
    value.models !== null &&
    'soulVirtualPath' in value &&
    value.soulVirtualPath === soulVirtualPath
  );
}

function normalizeAgentKind(value: unknown): AgentKind {
  if (value === 'chat' || value === 'operator' || value === 'internal') {
    return value;
  }

  throw new Error('Agent kind must be chat, operator, or internal.');
}

function defaultAgentKindForId(agentId: string): AgentKind {
  return agentId === 'scotty' ? 'operator' : 'chat';
}

function normalizeSoulVirtualPath(value: string): string {
  return value === soulVirtualPath ? value : soulVirtualPath;
}

function normalizeAgentMemorySettings(value: unknown, agentId?: string): AgentMemorySettings {
  const defaults = defaultAgentMemorySettings(agentId);

  if (typeof value !== 'object' || value === null) {
    return defaults;
  }

  return {
    canRead:
      'canRead' in value && typeof value.canRead === 'boolean' ? value.canRead : defaults.canRead,
    canWrite:
      'canWrite' in value && typeof value.canWrite === 'boolean'
        ? value.canWrite
        : defaults.canWrite,
  };
}

function defaultAgentMemorySettings(agentId?: string): AgentMemorySettings {
  if (agentId === costAnalystAgentId) {
    return {
      canRead: false,
      canWrite: false,
    };
  }

  return {
    canRead: true,
    canWrite: true,
  };
}

function normalizeAgentModelSettings(value: unknown): AgentModelSettings {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const research =
    typeof record['research'] === 'object' && record['research'] !== null
      ? (record['research'] as Record<string, unknown>)
      : undefined;

  return {
    chat: normalizeOptionalModelId(record['chat']),
    research: {
      researcher: normalizeOptionalModelId(research?.['researcher']),
    },
    threadSummary: normalizeOptionalModelId(record['threadSummary']),
    memoryMaintenance: normalizeOptionalModelId(record['memoryMaintenance']),
  };
}

function normalizeOptionalModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();

  return normalized || undefined;
}

function normalizeToolIds(toolIds: readonly unknown[]): string[] {
  return [...new Set(toolIds.filter((toolId): toolId is string => typeof toolId === 'string'))]
    .map((toolId) => normalizeToolId(toolId.trim()))
    .filter(Boolean)
    .sort();
}

function normalizeToolId(toolId: string): string {
  return toolId === 'extract_web_content' ? 'read_web_page_structure' : toolId;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
