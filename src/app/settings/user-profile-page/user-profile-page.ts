import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import type {
  DateStylePreference,
  ThemePreference,
  TimeStylePreference,
  UserProfile,
} from '../../../../shared/agent-contracts';
import { UserProfileSyncService } from '../user-profile-sync';

@Component({
  selector: 'app-user-profile-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './user-profile-page.html',
  styleUrl: './user-profile-page.css',
})
export class UserProfilePage {
  private readonly userProfileSync = inject(UserProfileSyncService);

  protected readonly profile = this.userProfileSync.profile;
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);
  protected readonly draftName = signal('');
  protected readonly draftTimeZone = signal('');
  protected readonly draftLanguage = signal('');
  protected readonly draftLocale = signal('');
  protected readonly draftDateStyle = signal<DateStylePreference>('medium');
  protected readonly draftTimeStyle = signal<TimeStylePreference>('short');
  protected readonly draftTheme = signal<ThemePreference>('system');

  protected readonly timeZones = signal<readonly string[]>(readSupportedTimeZones());
  protected readonly locales = signal<readonly string[]>(readSuggestedLocales());
  protected readonly languages = signal<readonly string[]>(['en', 'de', 'fr', 'es', 'it', 'nl']);
  protected readonly dateStyles: readonly DateStylePreference[] = [
    'short',
    'medium',
    'long',
    'full',
  ];
  protected readonly timeStyles: readonly TimeStylePreference[] = ['short', 'medium'];
  protected readonly themes: readonly ThemePreference[] = ['system', 'light', 'dark'];
  protected readonly localeOptions = computed(() =>
    mergeOptions(this.locales(), this.draftLocale()),
  );
  protected readonly languageOptions = computed(() =>
    mergeOptions(this.languages(), this.draftLanguage()),
  );

  protected readonly preview = computed(() => {
    try {
      return new Intl.DateTimeFormat(this.draftLocale(), {
        dateStyle: this.draftDateStyle(),
        timeStyle: this.draftTimeStyle(),
        timeZone: this.draftTimeZone(),
      }).format(new Date());
    } catch {
      return 'Invalid date settings';
    }
  });

  protected readonly hasChanges = computed(() => {
    const profile = this.profile();

    return Boolean(
      profile &&
      (this.draftName().trim() !== profile.name ||
        this.draftTimeZone().trim() !== profile.timeZone ||
        this.draftLanguage().trim() !== profile.language ||
        this.draftLocale().trim() !== profile.locale ||
        this.draftDateStyle() !== profile.dateStyle ||
        this.draftTimeStyle() !== profile.timeStyle ||
        this.draftTheme() !== profile.theme),
    );
  });

  constructor() {
    void this.load();
  }

  protected updateName(value: string): void {
    this.draftName.set(value);
    this.savedMessage.set(null);
  }

  protected updateTimeZone(value: string): void {
    this.draftTimeZone.set(value);
    this.savedMessage.set(null);
  }

  protected updateLanguage(value: string): void {
    this.draftLanguage.set(value);
    this.savedMessage.set(null);
  }

  protected updateLocale(value: string): void {
    this.draftLocale.set(value);
    this.savedMessage.set(null);
  }

  protected updateDateStyle(value: DateStylePreference): void {
    this.draftDateStyle.set(value);
    this.savedMessage.set(null);
  }

  protected updateTimeStyle(value: TimeStylePreference): void {
    this.draftTimeStyle.set(value);
    this.savedMessage.set(null);
  }

  protected updateTheme(value: ThemePreference): void {
    this.draftTheme.set(value);
    this.savedMessage.set(null);
  }

  protected async save(): Promise<void> {
    await this.handleAsync(async () => {
      const profile = await this.userProfileSync.updateProfile({
        name: this.draftName().trim(),
        timeZone: this.draftTimeZone().trim(),
        language: this.draftLanguage().trim(),
        locale: this.draftLocale().trim(),
        dateStyle: this.draftDateStyle(),
        timeStyle: this.draftTimeStyle(),
        theme: this.draftTheme(),
      });
      this.applyProfile(profile);
      this.savedMessage.set('User profile saved.');
    });
  }

  private async load(): Promise<void> {
    await this.handleAsync(async () => {
      const profile = this.profile() ?? (await this.userProfileSync.loadProfile());
      this.applyProfile(profile);
    });
    this.isLoading.set(false);
  }

  private applyProfile(profile: UserProfile): void {
    this.draftName.set(profile.name);
    this.draftTimeZone.set(profile.timeZone);
    this.draftLanguage.set(profile.language);
    this.draftLocale.set(profile.locale);
    this.draftDateStyle.set(profile.dateStyle);
    this.draftTimeStyle.set(profile.timeStyle);
    this.draftTheme.set(profile.theme);
  }

  private async handleAsync(work: () => Promise<void>): Promise<void> {
    try {
      this.isSaving.set(true);
      this.error.set(null);
      await work();
    } catch (error) {
      this.error.set(getErrorMessage(error, 'Request failed.'));
    } finally {
      this.isSaving.set(false);
    }
  }
}

function readSupportedTimeZones(): readonly string[] {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };

  if (intlWithSupportedValues.supportedValuesOf) {
    return intlWithSupportedValues.supportedValuesOf('timeZone');
  }

  return ['UTC', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
}

function readSuggestedLocales(): readonly string[] {
  return [
    'de-DE',
    'de-AT',
    'de-CH',
    'en-US',
    'en-GB',
    'en-IE',
    'en-CA',
    'en-AU',
    'fr-FR',
    'fr-CH',
    'es-ES',
    'it-IT',
    'nl-NL',
    'pl-PL',
    'pt-PT',
    'pt-BR',
    'sv-SE',
    'da-DK',
    'fi-FI',
    'nb-NO',
  ];
}

function mergeOptions(options: readonly string[], selectedValue: string): readonly string[] {
  return [...new Set([selectedValue, ...options].filter(Boolean))];
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as unknown;

    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
    ) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : fallback;
}
