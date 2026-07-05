import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  AgentSettings,
  DateStylePreference,
  ThemePreference,
  TimeStylePreference,
  UpdateUserProfileRequest,
  UserProfile,
} from '../../shared/agent-contracts';

const profileFileName = 'user-profile.json';

export class UserProfileStore {
  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await this.readProfile();
  }

  async readProfile(): Promise<UserProfile> {
    try {
      const raw = JSON.parse(await readFile(this.profilePath(), 'utf8')) as unknown;
      const profile = parseUserProfile(raw);

      if (!profile) {
        throw new Error(`Invalid user profile: ${this.profilePath()}`);
      }

      if (!hasCurrentProfileShape(raw)) {
        await this.writeProfile(profile);
      }

      return profile;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }

      const profile = createDefaultProfile();
      await this.writeProfile(profile);

      return profile;
    }
  }

  async updateProfile(request: UpdateUserProfileRequest): Promise<UserProfile> {
    const existing = await this.readProfile();
    const update = normalizeProfileUpdate(request);
    const updated: UserProfile = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString(),
    };

    await this.writeProfile(updated);

    return updated;
  }

  private profilePath(): string {
    return join(this.dataDir, profileFileName);
  }

  private async writeProfile(profile: UserProfile): Promise<void> {
    await mkdir(dirname(this.profilePath()), { recursive: true });
    await writeFile(this.profilePath(), `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  }
}

function createDefaultProfile(): UserProfile {
  const now = new Date().toISOString();
  const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
  const locale = resolvedOptions.locale || 'en-US';
  const timeZone = resolvedOptions.timeZone || 'UTC';

  return {
    name: '',
    timeZone,
    language: languageFromLocale(locale),
    locale,
    dateStyle: 'medium',
    timeStyle: 'short',
    theme: 'system',
    agentSettings: {},
    createdAt: now,
    updatedAt: now,
  };
}

function parseUserProfile(value: unknown): UserProfile | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const now = new Date().toISOString();
  const defaults = createDefaultProfile();

  return {
    name: typeof record['name'] === 'string' ? record['name'] : defaults.name,
    timeZone: typeof record['timeZone'] === 'string' ? record['timeZone'] : defaults.timeZone,
    language: typeof record['language'] === 'string' ? record['language'] : defaults.language,
    locale: typeof record['locale'] === 'string' ? record['locale'] : defaults.locale,
    dateStyle: isDateStylePreference(record['dateStyle']) ? record['dateStyle'] : 'medium',
    timeStyle: isTimeStylePreference(record['timeStyle']) ? record['timeStyle'] : 'short',
    theme: isThemePreference(record['theme']) ? record['theme'] : 'system',
    agentSettings: parseAgentSettings(record['agentSettings']),
    createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : now,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : now,
  };
}

function normalizeProfileUpdate(request: UpdateUserProfileRequest): UpdateUserProfileRequest {
  const update: Record<string, unknown> = {};

  if (typeof request.name === 'string') {
    update['name'] = request.name.trim();
  }

  if (typeof request.timeZone === 'string') {
    if (!isSupportedTimeZone(request.timeZone)) {
      throw new Error(`Unsupported time zone: ${request.timeZone}.`);
    }

    update['timeZone'] = request.timeZone;
  }

  if (typeof request.language === 'string') {
    update['language'] = request.language.trim();
  }

  if (typeof request.locale === 'string') {
    if (!isSupportedLocale(request.locale)) {
      throw new Error(`Unsupported locale: ${request.locale}.`);
    }

    update['locale'] = request.locale;
  }

  if (isDateStylePreference(request.dateStyle)) {
    update['dateStyle'] = request.dateStyle;
  }

  if (isTimeStylePreference(request.timeStyle)) {
    update['timeStyle'] = request.timeStyle;
  }

  if (isThemePreference(request.theme)) {
    update['theme'] = request.theme;
  }

  if (request.agentSettings) {
    update['agentSettings'] = parseAgentSettings(request.agentSettings);
  }

  return update;
}

function parseAgentSettings(value: unknown): Record<string, AgentSettings> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([agentId, settings]) => [agentId, parseAgentSetting(settings)] as const)
      .filter((entry): entry is readonly [string, AgentSettings] => Boolean(entry[1])),
  );
}

function parseAgentSetting(value: unknown): AgentSettings | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const model = (value as Record<string, unknown>)['model'];

  return {
    model: typeof model === 'string' && model.trim() ? model.trim() : undefined,
  };
}

function hasCurrentProfileShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'timeZone' in value &&
    'language' in value &&
    'locale' in value &&
    'dateStyle' in value &&
    'timeStyle' in value &&
    'theme' in value &&
    'agentSettings' in value &&
    'createdAt' in value &&
    'updatedAt' in value
  );
}

function languageFromLocale(locale: string): string {
  return locale.split('-')[0] || 'en';
}

function isSupportedLocale(locale: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length === 1;
  } catch {
    return false;
  }
}

function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());

    return true;
  } catch {
    return false;
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isDateStylePreference(value: unknown): value is DateStylePreference {
  return value === 'short' || value === 'medium' || value === 'long' || value === 'full';
}

function isTimeStylePreference(value: unknown): value is TimeStylePreference {
  return value === 'short' || value === 'medium';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
