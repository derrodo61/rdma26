import type { AgentRunEvent } from '../../../shared/agent-contracts';

export function writeServerSentEvent(stream: NodeJS.WritableStream, event: AgentRunEvent): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`);
}
