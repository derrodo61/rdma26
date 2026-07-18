import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';

import type { RunContextToolCall } from '../../../shared/agent-contracts';
import type { AgentActivityCallback } from './agent-activity';
import { emitActivity } from './agent-activity';

interface PendingToolCall {
  readonly id: string;
  readonly name?: string;
  readonly args?: unknown;
  result?: string;
}

export class ToolCallObserver extends BaseCallbackHandler {
  name = 'rdma26-tool-call-observer';
  private readonly calls = new Map<string, PendingToolCall>();

  constructor(private readonly onActivity?: AgentActivityCallback) {
    super({ _awaitHandler: true });
  }

  override handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
    toolCallId?: string,
  ): void {
    const name = readToolName(tool, runName);
    this.calls.set(runId, {
      id: toolCallId ?? runId,
      name,
      args: parseToolInput(input),
    });
    emitActivity(this.onActivity, {
      label: name ? `Using ${formatToolName(name)}` : 'Using a tool',
    });
  }

  override handleToolEnd(output: unknown, runId: string): void {
    const call = this.calls.get(runId);
    if (call) call.result = stringifyToolOutput(output);
  }

  override handleToolError(error: unknown, runId: string): void {
    const call = this.calls.get(runId);
    if (call) call.result = error instanceof Error ? error.message : String(error);
  }

  collected(): readonly RunContextToolCall[] {
    return [...this.calls.values()];
  }
}

function readToolName(tool: Serialized, runName: string | undefined): string | undefined {
  if (runName) return runName;
  const record = tool as unknown as Record<string, unknown>;
  if (typeof record['name'] === 'string') return record['name'];
  const id = Array.isArray(record['id']) ? record['id'] : [];
  const finalIdPart = id.at(-1);
  return typeof finalIdPart === 'string' ? finalIdPart : undefined;
}

function parseToolInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ');
}
