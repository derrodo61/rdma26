import type { ChatMessage } from '../../../../shared/agent-contracts';

export interface RenderedChatMessage extends ChatMessage {
  readonly renderedContent: string;
}

export interface ResearchSourceSummary {
  readonly url: string;
  readonly title: string;
  readonly domain: string;
}

export interface RunActivity {
  readonly label: string;
  readonly detail?: string;
}
