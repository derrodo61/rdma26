import { HttpErrorResponse } from '@angular/common/http';
import { JsonPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import type { RunContextDetails } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';

@Component({
  selector: 'app-run-context-page',
  imports: [JsonPipe, RouterLink],
  templateUrl: './run-context-page.html',
  styleUrl: './run-context-page.css',
})
export class RunContextPage {
  private readonly api = inject(AssistantApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly context = signal<RunContextDetails | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly chatQueryParams = computed(() => {
    const context = this.context();

    return context
      ? {
          agentId: context.agentId,
          threadId: context.threadId,
        }
      : {};
  });
  protected readonly profileLines = computed(() => {
    const profile = this.context()?.userProfile;

    if (!profile) {
      return [];
    }

    return [
      ['Name', profile.name || 'not configured'],
      ['Time zone', profile.timeZone],
      ['Language', profile.language],
      ['Locale', profile.locale],
      ['Date style', profile.dateStyle],
      ['Time style', profile.timeStyle],
      ['Theme', profile.theme],
    ] as const;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const runId = this.route.snapshot.paramMap.get('runId');

    if (!runId) {
      this.error.set('Run id is required.');
      this.isLoading.set(false);
      return;
    }

    try {
      this.context.set(await this.api.runContext(runId));
    } catch (error) {
      this.error.set(getErrorMessage(error, 'Could not load run context.'));
    } finally {
      this.isLoading.set(false);
    }
  }
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
