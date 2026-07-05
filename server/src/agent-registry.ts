import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AgentProfile,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '../../shared/agent-contracts';
import { createAssistantStorage, type AssistantStorage } from './storage';

const profileFileName = 'agent.json';

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

      if (!isAgentProfile(raw)) {
        throw new Error(`Invalid agent profile: ${this.profilePath(agentId)}`);
      }

      return raw;
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

    return await this.writeNewAgent(id, request.name);
  }

  async updateAgent(agentId: string, request: UpdateAgentRequest): Promise<AgentProfile> {
    const existing = await this.readAgent(agentId);

    if (!existing) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    const updated: AgentProfile = {
      ...existing,
      name: normalizeAgentName(request.name),
      updatedAt: new Date().toISOString(),
    };

    await writeFile(this.profilePath(agentId), `${JSON.stringify(updated, null, 2)}\n`, 'utf8');

    return updated;
  }

  async ensureAgent(request: CreateAgentRequest & { readonly id: string }): Promise<AgentProfile> {
    const existing = await this.readAgent(request.id);

    if (existing) {
      return existing;
    }

    return await this.writeNewAgent(request.id, request.name);
  }

  async storageFor(agentId: string): Promise<AssistantStorage> {
    const agent = await this.readAgent(agentId);

    if (!agent) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    return createAssistantStorage(this.dataDir, agent, {
      migrateLegacyData: agent.id === this.defaultAgentId,
    });
  }

  getDefaultAgentId(): string {
    return this.defaultAgentId;
  }

  private async writeNewAgent(id: string, name: string): Promise<AgentProfile> {
    validateAgentId(id);
    const now = new Date().toISOString();
    const agent: AgentProfile = {
      id,
      name: normalizeAgentName(name),
      soulVirtualPath: '/memories/soul.md',
      createdAt: now,
      updatedAt: now,
    };
    const storage = createAssistantStorage(this.dataDir, agent, {
      migrateLegacyData: id === this.defaultAgentId,
    });

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
}

export function normalizeAgentId(input: string): string {
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

function normalizeAgentName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error('Agent name is required.');
  }

  return normalized;
}

function isAgentProfile(value: unknown): value is AgentProfile {
  return (
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
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
