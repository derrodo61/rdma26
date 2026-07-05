import { Injectable } from '@angular/core';

import type { AgentSettings } from '../../../shared/agent-contracts';

@Injectable({ providedIn: 'root' })
export class AgentSettingsStorage {
  private readonly settingsPrefix = 'rdma26:agent-settings';
  private readonly legacySelectedModelPrefix = 'rdma26:selected-model';

  read(agentId: string): AgentSettings {
    const settings = this.readSettingsObject(agentId);
    const legacyModel = this.readLegacySelectedModel(agentId);

    if (legacyModel && !settings.model) {
      const migrated = {
        ...settings,
        model: legacyModel,
      };
      this.write(agentId, migrated);
      this.removeLegacySelectedModel(agentId);
      return migrated;
    }

    return settings;
  }

  update(agentId: string, update: Partial<AgentSettings>): AgentSettings {
    const settings = {
      ...this.read(agentId),
      ...update,
    };

    this.write(agentId, settings);
    return settings;
  }

  readAll(agentIds: readonly string[]): Readonly<Record<string, AgentSettings>> {
    return Object.fromEntries(
      agentIds
        .map((agentId) => [agentId, this.read(agentId)] as const)
        .filter((entry): entry is readonly [string, AgentSettings] => Boolean(entry[1].model)),
    );
  }

  replaceAll(agentSettings: Readonly<Record<string, AgentSettings>>): void {
    for (const [agentId, settings] of Object.entries(agentSettings)) {
      this.write(agentId, settings);
    }
  }

  remove(agentId: string): void {
    try {
      globalThis.localStorage.removeItem(this.settingsKey(agentId));
      this.removeLegacySelectedModel(agentId);
    } catch {
      return;
    }
  }

  private readSettingsObject(agentId: string): AgentSettings {
    try {
      const raw = globalThis.localStorage.getItem(this.settingsKey(agentId));

      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;

      return {
        model: typeof parsed['model'] === 'string' ? parsed['model'] : undefined,
      };
    } catch {
      return {};
    }
  }

  private write(agentId: string, settings: AgentSettings): void {
    try {
      globalThis.localStorage.setItem(this.settingsKey(agentId), JSON.stringify(settings));
    } catch {
      return;
    }
  }

  private readLegacySelectedModel(agentId: string): string | undefined {
    try {
      return globalThis.localStorage.getItem(this.legacySelectedModelKey(agentId)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private removeLegacySelectedModel(agentId: string): void {
    try {
      globalThis.localStorage.removeItem(this.legacySelectedModelKey(agentId));
    } catch {
      return;
    }
  }

  private settingsKey(agentId: string): string {
    return `${this.settingsPrefix}:${agentId}`;
  }

  private legacySelectedModelKey(agentId: string): string {
    return `${this.legacySelectedModelPrefix}:${agentId}`;
  }
}
