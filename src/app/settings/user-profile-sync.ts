import { inject, Injectable, signal } from '@angular/core';

import type {
  AgentProfile,
  AgentSettings,
  ThemePreference,
  UpdateUserProfileRequest,
  UserProfile,
} from '../../../shared/agent-contracts';
import { AssistantApi } from '../chat/assistant-api';
import { AgentSettingsStorage } from './agent-settings-storage';
import { ThemePreferenceService } from './theme-preference';

@Injectable({ providedIn: 'root' })
export class UserProfileSyncService {
  private readonly api = inject(AssistantApi);
  private readonly agentSettingsStorage = inject(AgentSettingsStorage);
  private readonly themePreference = inject(ThemePreferenceService);

  readonly profile = signal<UserProfile | null>(null);

  async loadAndHydrate(agents: readonly AgentProfile[]): Promise<UserProfile> {
    const remoteProfile = await this.api.profile();
    const localUpdate = this.localProfileUpdate(remoteProfile, agents);
    const profile = hasProfileUpdate(localUpdate)
      ? await this.api.updateProfile(localUpdate)
      : remoteProfile;

    this.applyProfile(profile);

    return profile;
  }

  async loadProfile(): Promise<UserProfile> {
    const profile = await this.api.profile();
    this.applyProfile(profile);

    return profile;
  }

  async updateProfile(update: UpdateUserProfileRequest): Promise<UserProfile> {
    const profile = await this.api.updateProfile(update);
    this.applyProfile(profile);

    return profile;
  }

  async updateTheme(theme: ThemePreference): Promise<UserProfile | null> {
    this.themePreference.setTheme(theme);

    try {
      return await this.updateProfile({ theme });
    } catch {
      return this.profile();
    }
  }

  async updateAgentModel(agentId: string, model: string): Promise<UserProfile | null> {
    this.agentSettingsStorage.update(agentId, { model });

    try {
      return await this.updateProfile({
        agentSettings: {
          ...this.profile()?.agentSettings,
          [agentId]: {
            ...this.profile()?.agentSettings[agentId],
            model,
          },
        },
      });
    } catch {
      return this.profile();
    }
  }

  async updateLastAgent(agentId: string): Promise<UserProfile | null> {
    this.profile.update((profile) => (profile ? { ...profile, lastAgentId: agentId } : profile));

    try {
      return await this.updateProfile({ lastAgentId: agentId });
    } catch {
      return this.profile();
    }
  }

  private applyProfile(profile: UserProfile): void {
    this.profile.set(profile);
    this.themePreference.setTheme(profile.theme);
    this.agentSettingsStorage.replaceAll(profile.agentSettings);
  }

  private localProfileUpdate(
    profile: UserProfile,
    agents: readonly AgentProfile[],
  ): UpdateUserProfileRequest {
    const agentSettings = mergeAgentSettings(
      profile.agentSettings,
      this.agentSettingsStorage.readAll(agents.map((agent) => agent.id)),
    );
    const update: {
      theme?: ThemePreference;
      agentSettings?: Readonly<Record<string, AgentSettings>>;
    } = {};

    if (isNewProfile(profile)) {
      const localTheme = this.themePreference.readStoredTheme();

      if (localTheme !== profile.theme) {
        update.theme = localTheme;
      }
    }

    if (!areAgentSettingsEqual(agentSettings, profile.agentSettings)) {
      update.agentSettings = agentSettings;
    }

    return update;
  }
}

function mergeAgentSettings(
  remote: Readonly<Record<string, AgentSettings>>,
  local: Readonly<Record<string, AgentSettings>>,
): Readonly<Record<string, AgentSettings>> {
  return Object.fromEntries(
    [...new Set([...Object.keys(remote), ...Object.keys(local)])].map((agentId) => [
      agentId,
      {
        ...local[agentId],
        ...remote[agentId],
      },
    ]),
  );
}

function isNewProfile(profile: UserProfile): boolean {
  return profile.createdAt === profile.updatedAt;
}

function hasProfileUpdate(update: Partial<UserProfile>): boolean {
  return Object.keys(update).length > 0;
}

function areAgentSettingsEqual(
  left: Readonly<Record<string, AgentSettings>>,
  right: Readonly<Record<string, AgentSettings>>,
): boolean {
  return JSON.stringify(sortRecord(left)) === JSON.stringify(sortRecord(right));
}

function sortRecord(
  value: Readonly<Record<string, AgentSettings>>,
): Readonly<Record<string, AgentSettings>> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}
