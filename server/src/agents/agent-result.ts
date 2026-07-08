import type { RunContextTokenUsage, RunContextToolCall } from '../../../shared/agent-contracts';

export function extractText(result: unknown): string {
  const messages = readProperty<unknown[]>(result, 'messages');
  const lastMessage = messages?.at(-1);
  const content = readProperty<unknown>(lastMessage, 'content');

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => readProperty<unknown>(part, 'text'))
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
      .trim();

    if (text) {
      return text;
    }
  }

  return 'The agent completed the run, but no assistant text was returned.';
}

export function extractToolCalls(result: unknown): readonly RunContextToolCall[] {
  const messages = readProperty<unknown[]>(result, 'messages') ?? [];
  const calls = new Map<string, RunContextToolCall>();
  const unnamedCalls: RunContextToolCall[] = [];

  for (const message of messages) {
    for (const call of readToolCalls(message)) {
      const id = readProperty<string>(call, 'id');
      const toolCall: RunContextToolCall = {
        id,
        name: readProperty<string>(call, 'name'),
        args: readProperty<unknown>(call, 'args') ?? readProperty<unknown>(call, 'arguments'),
      };

      if (id) {
        calls.set(id, {
          ...calls.get(id),
          ...toolCall,
        });
      } else {
        unnamedCalls.push(toolCall);
      }
    }

    const toolResult = readToolResult(message);

    if (!toolResult) {
      continue;
    }

    if (toolResult.id) {
      calls.set(toolResult.id, {
        ...calls.get(toolResult.id),
        id: toolResult.id,
        name: calls.get(toolResult.id)?.name ?? toolResult.name,
        result: toolResult.result,
      });
    } else {
      unnamedCalls.push(toolResult);
    }
  }

  return [...calls.values(), ...unnamedCalls];
}

export function extractTokenUsage(result: unknown): RunContextTokenUsage | undefined {
  const messages = readProperty<unknown[]>(result, 'messages') ?? [];
  const usage = messages.map((message) => readUsageFromMessage(message)).find(Boolean);

  return usage;
}

function readToolCalls(message: unknown): readonly unknown[] {
  const directToolCalls = readProperty<unknown[]>(message, 'tool_calls');

  if (Array.isArray(directToolCalls)) {
    return directToolCalls;
  }

  const additionalKwargs = readProperty<unknown>(message, 'additional_kwargs');
  const nestedToolCalls = readProperty<unknown[]>(additionalKwargs, 'tool_calls');

  return Array.isArray(nestedToolCalls) ? nestedToolCalls : [];
}

function readToolResult(message: unknown): RunContextToolCall | null {
  const type = readProperty<string>(message, 'type');
  const role = readProperty<string>(message, 'role');
  const name = readProperty<string>(message, 'name');
  const id =
    readProperty<string>(message, 'tool_call_id') ??
    readProperty<string>(message, 'id') ??
    undefined;

  if (type !== 'tool' && role !== 'tool' && !readProperty<unknown>(message, 'tool_call_id')) {
    return null;
  }

  return {
    id,
    name,
    result: stringifyToolResult(readProperty<unknown>(message, 'content')),
  };
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  return JSON.stringify(content);
}

function readUsageFromMessage(message: unknown): RunContextTokenUsage | undefined {
  const usageMetadata = readProperty<unknown>(message, 'usage_metadata');
  const responseMetadata = readProperty<unknown>(message, 'response_metadata');
  const tokenUsage = readProperty<unknown>(responseMetadata, 'tokenUsage');
  const openAiTokenUsage = readProperty<unknown>(responseMetadata, 'token_usage');
  const source = usageMetadata ?? tokenUsage ?? openAiTokenUsage;

  if (!source) {
    return undefined;
  }

  const inputTokens =
    readNumber(source, 'input_tokens') ??
    readNumber(source, 'promptTokens') ??
    readNumber(source, 'prompt_tokens');
  const outputTokens =
    readNumber(source, 'output_tokens') ??
    readNumber(source, 'completionTokens') ??
    readNumber(source, 'completion_tokens');
  const totalTokens =
    readNumber(source, 'total_tokens') ??
    readNumber(source, 'totalTokens') ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function readNumber(value: unknown, key: string): number | undefined {
  const candidate = readProperty<unknown>(value, key);

  return typeof candidate === 'number' ? candidate : undefined;
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}
