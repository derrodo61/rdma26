import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { ModelProviderStatus } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';

@Component({
  selector: 'app-model-providers-page',
  imports: [RouterLink],
  templateUrl: './model-providers-page.html',
})
export class ModelProvidersPage {
  private readonly api = inject(AssistantApi);
  private readonly destroyRef = inject(DestroyRef);
  private pollTimer?: ReturnType<typeof setInterval>;

  protected readonly providers = signal<readonly ModelProviderStatus[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isWorking = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());
    void this.load();
  }

  protected async signIn(): Promise<void> {
    const popup = globalThis.open('', '_blank');
    this.isWorking.set(true);
    this.error.set(null);

    try {
      const login = await this.api.startOpenAiChatGptLogin();
      if (popup) {
        popup.location.href = login.authorizationUrl;
      } else {
        globalThis.location.href = login.authorizationUrl;
      }
      this.startPolling();
      await this.loadProviders();
    } catch (error) {
      popup?.close();
      this.error.set(getErrorMessage(error));
    } finally {
      this.isWorking.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    this.isWorking.set(true);
    this.error.set(null);

    try {
      await this.api.logoutOpenAiChatGpt();
      this.stopPolling();
      await this.loadProviders();
    } catch (error) {
      this.error.set(getErrorMessage(error));
    } finally {
      this.isWorking.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      await this.loadProviders();
    } catch (error) {
      this.error.set(getErrorMessage(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadProviders(): Promise<void> {
    const response = await this.api.modelProviders();
    this.providers.set(response.providers);

    if (
      response.providers.some(
        (provider) => provider.id === 'openai-chatgpt' && provider.authenticated,
      )
    ) {
      this.stopPolling();
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.loadProviders().catch((error: unknown) => {
        this.error.set(getErrorMessage(error));
        this.stopPolling();
      });
    }, 2_000);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}

function getErrorMessage(error: unknown): string {
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

  return error instanceof Error ? error.message : 'Model-provider request failed.';
}
