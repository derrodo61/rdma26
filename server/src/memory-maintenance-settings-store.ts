import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  MemoryMaintenanceSettings,
  UpdateMemoryMaintenanceSettingsRequest,
} from '../../shared/agent-contracts';
import { validateAgentId } from './agent-registry';

const settingsFileName = 'memory-maintenance-settings.json';

export class MemoryMaintenanceSettingsStore {
  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await this.readSettings();
  }

  async readSettings(): Promise<MemoryMaintenanceSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath(), 'utf8')) as unknown;
      const settings = parseSettings(parsed);

      if (!settings) {
        throw new Error(`Invalid memory maintenance settings: ${this.settingsPath()}`);
      }

      if (!hasCurrentSettingsShape(parsed)) {
        await this.writeSettings(settings);
      }

      return settings;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }

      const settings = createDefaultSettings();
      await this.writeSettings(settings);

      return settings;
    }
  }

  async updateSettings(
    request: UpdateMemoryMaintenanceSettingsRequest,
  ): Promise<MemoryMaintenanceSettings> {
    const existing = await this.readSettings();
    const updated: MemoryMaintenanceSettings = {
      ...existing,
      ...normalizeSettingsUpdate(request),
      updatedAt: new Date().toISOString(),
    };

    await this.writeSettings(updated);

    return updated;
  }

  async recordRunStarted(startedAt: string): Promise<MemoryMaintenanceSettings> {
    const existing = await this.readSettings();
    const updated: MemoryMaintenanceSettings = {
      ...existing,
      lastStartedAt: startedAt,
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    };

    await this.writeSettings(updated);

    return updated;
  }

  async recordRunFinished(finishedAt: string): Promise<MemoryMaintenanceSettings> {
    const existing = await this.readSettings();
    const updated: MemoryMaintenanceSettings = {
      ...existing,
      lastFinishedAt: finishedAt,
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    };

    await this.writeSettings(updated);

    return updated;
  }

  async recordRunFailed(errorMessage: string): Promise<MemoryMaintenanceSettings> {
    const existing = await this.readSettings();
    const updated: MemoryMaintenanceSettings = {
      ...existing,
      lastError: errorMessage,
      updatedAt: new Date().toISOString(),
    };

    await this.writeSettings(updated);

    return updated;
  }

  private settingsPath(): string {
    return join(this.dataDir, settingsFileName);
  }

  private async writeSettings(settings: MemoryMaintenanceSettings): Promise<void> {
    await mkdir(dirname(this.settingsPath()), { recursive: true });
    await writeFile(this.settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }
}

function createDefaultSettings(): MemoryMaintenanceSettings {
  return {
    enabled: false,
    intervalMinutes: 1440,
    limitPerAgent: 25,
    updatedAt: new Date().toISOString(),
  };
}

function parseSettings(value: unknown): MemoryMaintenanceSettings | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const defaults = createDefaultSettings();
  const agentId = typeof record['agentId'] === 'string' ? record['agentId'].trim() : undefined;

  return {
    enabled: typeof record['enabled'] === 'boolean' ? record['enabled'] : defaults.enabled,
    intervalMinutes:
      typeof record['intervalMinutes'] === 'number' && Number.isFinite(record['intervalMinutes'])
        ? normalizeIntervalMinutes(record['intervalMinutes'])
        : defaults.intervalMinutes,
    agentId: agentId ? normalizeOptionalAgentId(agentId) : undefined,
    model:
      typeof record['model'] === 'string' && record['model'].trim() ? record['model'] : undefined,
    limitPerAgent:
      typeof record['limitPerAgent'] === 'number' && Number.isFinite(record['limitPerAgent'])
        ? normalizeLimitPerAgent(record['limitPerAgent'])
        : defaults.limitPerAgent,
    lastStartedAt:
      typeof record['lastStartedAt'] === 'string' ? record['lastStartedAt'] : undefined,
    lastFinishedAt:
      typeof record['lastFinishedAt'] === 'string' ? record['lastFinishedAt'] : undefined,
    lastError: typeof record['lastError'] === 'string' ? record['lastError'] : undefined,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : defaults.updatedAt,
  };
}

function normalizeSettingsUpdate(
  request: UpdateMemoryMaintenanceSettingsRequest,
): Partial<MemoryMaintenanceSettings> {
  const update: WritableSettingsUpdate = {};

  if (typeof request.enabled === 'boolean') {
    update.enabled = request.enabled;
  }

  if (request.intervalMinutes !== undefined) {
    update.intervalMinutes = normalizeIntervalMinutes(request.intervalMinutes);
  }

  if (request.agentId !== undefined) {
    const agentId = request.agentId.trim();
    update.agentId = agentId ? normalizeOptionalAgentId(agentId) : undefined;
  }

  if (request.model !== undefined) {
    const model = request.model.trim();
    update.model = model || undefined;
  }

  if (request.limitPerAgent !== undefined) {
    update.limitPerAgent = normalizeLimitPerAgent(request.limitPerAgent);
  }

  return update;
}

type WritableSettingsUpdate = {
  -readonly [
    Key in keyof Partial<MemoryMaintenanceSettings>
  ]: Partial<MemoryMaintenanceSettings>[Key];
};

function normalizeOptionalAgentId(agentId: string): string {
  validateAgentId(agentId);

  return agentId;
}

function normalizeIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Memory maintenance interval must be a number.');
  }

  return Math.max(5, Math.min(Math.trunc(value), 10080));
}

function normalizeLimitPerAgent(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Memory maintenance limit must be a number.');
  }

  return Math.max(1, Math.min(Math.trunc(value), 500));
}

function hasCurrentSettingsShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('mode' in value) &&
    'enabled' in value &&
    'intervalMinutes' in value &&
    'limitPerAgent' in value &&
    'updatedAt' in value
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
