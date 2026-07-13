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
      summarizeChatContext(messages, extraParams),
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
      summarizePromptContext(prompts, extraParams),
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
    contextComposition: LlmContextComposition,
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
        contextComposition,
      },
    });

    this.callsByProviderRunId.set(providerRunId, record.id);
  }
}

export interface LlmContextComposition {
  readonly messageGroupCount: number;
  readonly messageCount: number;
  readonly messageCharacters: number;
  readonly messagesByRole: Readonly<
    Record<string, { readonly count: number; readonly characters: number }>
  >;
  readonly contentBlocksByType: Readonly<Record<string, number>>;
  readonly toolDefinitionCount: number;
  readonly toolDefinitionCharacters: number;
  readonly toolDefinitions: readonly {
    readonly name: string;
    readonly characters: number;
  }[];
}

export function summarizeChatContext(
  messageGroups: readonly (readonly BaseMessage[])[],
  extraParams?: Record<string, unknown>,
): LlmContextComposition {
  const messagesByRole: Record<string, { count: number; characters: number }> = {};
  const contentBlocksByType: Record<string, number> = {};
  let messageCharacters = 0;
  let messageCount = 0;

  for (const message of messageGroups.flat()) {
    const role = message.getType();
    const characters = measuredLength({
      content: message.content,
      additional_kwargs: message.additional_kwargs,
    });
    const bucket = (messagesByRole[role] ??= { count: 0, characters: 0 });
    bucket.count += 1;
    bucket.characters += characters;
    messageCharacters += characters;
    messageCount += 1;

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        const type = readStringFromUnknown(block, 'type') ?? 'unknown';
        contentBlocksByType[type] = (contentBlocksByType[type] ?? 0) + 1;
      }
    }
  }

  return {
    messageGroupCount: messageGroups.length,
    messageCount,
    messageCharacters,
    messagesByRole,
    contentBlocksByType,
    ...summarizeToolDefinitions(extraParams),
  };
}

function summarizePromptContext(
  prompts: readonly string[],
  extraParams?: Record<string, unknown>,
): LlmContextComposition {
  const characters = prompts.reduce((total, prompt) => total + prompt.length, 0);

  return {
    messageGroupCount: prompts.length,
    messageCount: prompts.length,
    messageCharacters: characters,
    messagesByRole: {
      prompt: { count: prompts.length, characters },
    },
    contentBlocksByType: {},
    ...summarizeToolDefinitions(extraParams),
  };
}

function summarizeToolDefinitions(extraParams?: Record<string, unknown>) {
  const invocationParams = readProperty<Record<string, unknown>>(extraParams, 'invocation_params');
  const tools = readArray(invocationParams, 'tools') ?? readArray(extraParams, 'tools') ?? [];

  return {
    toolDefinitionCount: tools.length,
    toolDefinitionCharacters: measuredLength(tools),
    toolDefinitions: tools
      .map((tool) => ({
        name: readToolDefinitionName(tool),
        characters: measuredLength(tool),
      }))
      .sort((left, right) => right.characters - left.characters),
  };
}

function readToolDefinitionName(value: unknown): string {
  if (!isRecord(value)) {
    return 'unknown';
  }

  const functionDefinition = readProperty<Record<string, unknown>>(value, 'function');

  return (
    readString(value, 'name') ??
    readString(functionDefinition, 'name') ??
    readString(value, 'type') ??
    'unknown'
  );
}

function measuredLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
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

function readStringFromUnknown(value: unknown, key: string): string | undefined {
  return readString(isRecord(value) ? value : undefined, key);
}

function readArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly unknown[] | undefined {
  const value = record?.[key];

  return Array.isArray(value) ? value : undefined;
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
