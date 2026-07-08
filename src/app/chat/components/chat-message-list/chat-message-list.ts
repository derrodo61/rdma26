import { Component, input, signal } from '@angular/core';

import type {
  RenderedChatMessage,
  ResearchSourceSummary,
  RunActivity,
} from '../../chat-page/chat-page.types';

@Component({
  selector: 'app-chat-message-list',
  templateUrl: './chat-message-list.html',
  styleUrl: './chat-message-list.css',
})
export class ChatMessageList {
  readonly messages = input.required<readonly RenderedChatMessage[]>();
  readonly isRunning = input.required<boolean>();
  readonly runActivity = input.required<RunActivity | null>();
  readonly messageResearchSources =
    input.required<Readonly<Record<string, readonly ResearchSourceSummary[]>>>();
  protected readonly openSourcesMessageId = signal<string | null>(null);

  protected sourcesForMessage(messageId: string): readonly ResearchSourceSummary[] {
    return this.messageResearchSources()[messageId] ?? [];
  }

  protected isSourcesOpen(messageId: string): boolean {
    return this.openSourcesMessageId() === messageId;
  }

  protected toggleSources(messageId: string): void {
    this.openSourcesMessageId.update((openMessageId) =>
      openMessageId === messageId ? null : messageId,
    );
  }
}
