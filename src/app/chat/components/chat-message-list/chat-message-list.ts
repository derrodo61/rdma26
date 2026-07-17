import { Component, input, signal } from '@angular/core';

import type {
  MessageRunSummary,
  RenderedChatMessage,
  ResearchSourceSummary,
  RunActivity,
} from '../../chat-page/chat-page.types';
import { formatCost } from '../../../shared/cost-format';

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
  readonly messageRunSummaries = input.required<Readonly<Record<string, MessageRunSummary>>>();
  protected readonly openSourcesMessageId = signal<string | null>(null);

  protected sourcesForMessage(messageId: string): readonly ResearchSourceSummary[] {
    return this.messageResearchSources()[messageId] ?? [];
  }

  protected runSummaryForMessage(messageId: string): MessageRunSummary | null {
    return this.messageRunSummaries()[messageId] ?? null;
  }

  protected hasFooter(messageId: string): boolean {
    return this.sourcesForMessage(messageId).length > 0 || Boolean(this.runSummaryForMessage(messageId));
  }

  protected formatMessageCost(summary: MessageRunSummary): string {
    return summary.costs.map(({ amount, currency }) => formatCost(amount, currency)).join(' + ');
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
