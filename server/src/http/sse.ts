import type { AgentRunEvent } from '../../../shared/agent-contracts';

export function writeServerSentEvent(stream: NodeJS.WritableStream, event: AgentRunEvent): void {
  const state = stream as NodeJS.WritableStream & {
    readonly destroyed?: boolean;
    readonly writableEnded?: boolean;
  };

  if (state.destroyed || state.writableEnded) {
    return;
  }

  stream.write(`data: ${JSON.stringify(event)}\n\n`);
}
