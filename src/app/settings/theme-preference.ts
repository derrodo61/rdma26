import { Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemePreferenceService {
  private readonly storageKey = 'rdma26:theme';

  readonly theme = signal<ThemePreference>(this.readTheme());

  constructor() {
    this.apply(this.theme());
  }

  setTheme(theme: ThemePreference): void {
    this.theme.set(theme);
    this.apply(theme);

    try {
      globalThis.localStorage.setItem(this.storageKey, theme);
    } catch {
      return;
    }
  }

  private readTheme(): ThemePreference {
    try {
      const value = globalThis.localStorage.getItem(this.storageKey);

      return isThemePreference(value) ? value : 'system';
    } catch {
      return 'system';
    }
  }

  private apply(theme: ThemePreference): void {
    globalThis.document?.documentElement.setAttribute('data-theme', theme);
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}
