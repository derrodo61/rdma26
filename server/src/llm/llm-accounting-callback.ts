import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { BaseMessage } from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';
import type { Serialized } from '@langchain/core/load/serializable';

import type { LlmCallPurpose } from '../../../shared/agent-contracts';
import { extractUsageFromLlmResult } from './llm-usage';
import type { LlmCallStore } from './llm-call-store';

export class LlmAccountingCallbackHandler extends BaseCallbackHandler {
  name = 'rdma26_llm_accounting';
  private readonly callsByProviderRunId = new Map<string, string>();

  constructor(
    private readonly store: LlmCallStore,
    private readonly context: LlmAccountingContext,
  ) {
    super({ _awaitHandler: true });
  }

  override async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    providerRunId: string,
    parentProviderRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    await this.startProviderRun(
      llm,
      providerRunId,
      parentProviderRunId,
      extraParams,
      tags,
      metadata,
      runName,
      messages.length,
    );
  }

  override async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    providerRunId: string,
    parentProviderRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    await this.startProviderRun(
      llm,
      providerRunId,
      parentProviderRunId,
      extraParams,
      tags,
      metadata,
      runName,
      prompts.length,
    );
  }

  override async handleLLMEnd(
    output: LLMResult,
    providerRunId: string,
    _parentProviderRunId?: string,
  ): Promise<void> {
    const callId = this.callsByProviderRunId.get(providerRunId);

    if (!callId) {
      return;
    }

    await this.store.finishCall(callId, 'success', extractUsageFromLlmResult(output));
  }

  override async handleLLMError(error: unknown, providerRunId: string): Promise<void> {
    const callId = this.callsByProviderRunId.get(providerRunId);

    if (!callId) {
      return;
    }

    await this.store.finishCall(callId, 'error', undefined, getErrorMessage(error));
  }

  private async startProviderRun(
    llm: Serialized,
    providerRunId: string,
    parentProviderRunId: string | undefined,
    extraParams: Record<string, unknown> | undefined,
    tags: string[] | undefined,
    metadata: Record<string, unknown> | undefined,
    runName: string | undefined,
    promptCount: number,
  ): Promise<void> {
    if (this.callsByProviderRunId.has(providerRunId)) {
      return;
    }

    const record = await this.store.startCall({
      runId: this.context.runId,
      provider: this.context.provider,
      model: readModel(llm, extraParams) ?? this.context.model,
      purpose: this.context.purpose,
      agentId: this.context.agentId,
      threadId: this.context.threadId,
      providerRunId,
      parentProviderRunId,
      metadata: {
        promptCount,
        runName,
        tags,
        metadata,
      },
    });

    this.callsByProviderRunId.set(providerRunId, record.id);
  }
}

export interface LlmAccountingContext {
  readonly runId?: string;
  readonly provider: string;
  readonly model: string;
  readonly purpose: LlmCallPurpose;
  readonly agentId?: string;
  readonly threadId?: string;
}

function readModel(
  llm: Serialized,
  extraParams: Record<string, unknown> | undefined,
): string | undefined {
  const kwargs = readProperty<Record<string, unknown>>(llm, 'kwargs');
  const invocationParams = readProperty<Record<string, unknown>>(extraParams, 'invocation_params');
  const metadata = readProperty<Record<string, unknown>>(extraParams, 'metadata');
  const candidate =
    readString(invocationParams, 'model') ??
    readString(invocationParams, 'model_name') ??
    readString(metadata, 'ls_model_name') ??
    readString(kwargs, 'model') ??
    readString(kwargs, 'modelName') ??
    readString(kwargs, 'model_name');

  return candidate;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];

  return typeof value === 'string' ? value : undefined;
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
