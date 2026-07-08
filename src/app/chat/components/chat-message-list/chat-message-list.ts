import { Component, input } from '@angular/core';

import type {
  RenderedChatMessage,
  ResearchSourceSummary,
  RunActivity,
} from '../../chat-page/chat-page.types';

@Component({
  selector: 'app-chat-message-list',
  templateUrl: './chat-message-list.html',
})
export class ChatMessageList {
  readonly messages = input.required<readonly RenderedChatMessage[]>();
  readonly isRunning = input.required<boolean>();
  readonly runActivity = input.required<RunActivity | null>();
  readonly messageResearchSources =
    input.required<Readonly<Record<string, readonly ResearchSourceSummary[]>>>();

  protected sourcesForMessage(messageId: string): readonly ResearchSourceSummary[] {
    return this.messageResearchSources()[messageId] ?? [];
  }
}
