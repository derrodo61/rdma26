import type { RunContextTokenUsage } from '../../../shared/agent-contracts';

export function extractUsageFromMessage(message: unknown): RunContextTokenUsage | undefined {
  const usageMetadata = readProperty<unknown>(message, 'usage_metadata');
  const responseMetadata = readProperty<unknown>(message, 'response_metadata');
  const tokenUsage = readProperty<unknown>(responseMetadata, 'tokenUsage');
  const openAiTokenUsage =
    readProperty<unknown>(responseMetadata, 'token_usage') ??
    readProperty<unknown>(responseMetadata, 'usage');
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
  const inputTokenDetails =
    readProperty<unknown>(source, 'input_token_details') ??
    readProperty<unknown>(source, 'prompt_tokens_details');
  const outputTokenDetails =
    readProperty<unknown>(source, 'output_token_details') ??
    readProperty<unknown>(source, 'completion_tokens_details');
  const cachedInputTokens =
    readNumber(inputTokenDetails, 'cache_read') ?? readNumber(inputTokenDetails, 'cached_tokens');
  const reasoningTokens =
    readNumber(outputTokenDetails, 'reasoning') ??
    readNumber(outputTokenDetails, 'reasoning_tokens');

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
  };
}

export function extractUsageFromLlmResult(output: unknown): RunContextTokenUsage | undefined {
  const generations = readProperty<unknown[]>(output, 'generations');

  if (Array.isArray(generations)) {
    for (const generationGroup of generations) {
      if (!Array.isArray(generationGroup)) {
        continue;
      }

      for (const generation of generationGroup) {
        const message = readProperty<unknown>(generation, 'message');
        const usage = extractUsageFromMessage(message);

        if (usage) {
          return usage;
        }
      }
    }
  }

  const llmOutput = readProperty<unknown>(output, 'llmOutput');
  const estimatedTokenUsage = readProperty<unknown>(llmOutput, 'estimatedTokenUsage');
  const tokenUsage = readProperty<unknown>(llmOutput, 'tokenUsage');

  return extractUsageFromMessage({
    usage_metadata: estimatedTokenUsage ?? tokenUsage,
    response_metadata: llmOutput,
  });
}

export function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}

function readNumber(value: unknown, key: string): number | undefined {
  const candidate = readProperty<unknown>(value, key);

  return typeof candidate === 'number' ? candidate : undefined;
}
