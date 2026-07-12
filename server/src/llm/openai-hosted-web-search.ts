import type { RunContextToolCall } from '../../../shared/agent-contracts';

export function extractOpenAiHostedWebToolCalls(
  assistantMessage: unknown,
): readonly RunContextToolCall[] {
  const additionalKwargs = readProperty<Record<string, unknown>>(
    assistantMessage,
    'additional_kwargs',
  );
  const outputs = Array.isArray(additionalKwargs?.['tool_outputs'])
    ? additionalKwargs['tool_outputs']
    : [];
  const citations = extractUrlCitations(readProperty<unknown>(assistantMessage, 'content'));

  return outputs.flatMap((output, index) => {
    if (readProperty<string>(output, 'type') !== 'web_search_call') return [];
    const action = readProperty<Record<string, unknown>>(output, 'action') ?? {};

    return [
      {
        id: readProperty<string>(output, 'id') ?? `openai-web-search-${index + 1}`,
        name: 'web_search',
        args: action,
        result: JSON.stringify({
          action,
          answerSourceUrls: citations.map((citation) => citation.url),
          sources: citations,
        }),
      },
    ];
  });
}

export function extractOpenAiHostedWebToolCallsFromAgentResult(
  result: unknown,
): readonly RunContextToolCall[] {
  const messages = readProperty<unknown[]>(result, 'messages') ?? [];
  return messages.flatMap((message) => extractOpenAiHostedWebToolCalls(message));
}

function extractUrlCitations(content: unknown): readonly {
  readonly url: string;
  readonly title?: string;
}[] {
  if (!Array.isArray(content)) return [];
  const citations = new Map<string, { readonly url: string; readonly title?: string }>();

  for (const part of content) {
    const annotations = readProperty<unknown[]>(part, 'annotations') ?? [];
    for (const annotation of annotations) {
      if (readProperty<string>(annotation, 'type') !== 'citation') continue;
      if (readProperty<string>(annotation, 'source') !== 'url_citation') continue;
      const url = readProperty<string>(annotation, 'url');
      if (!url) continue;
      const title = readProperty<string>(annotation, 'title');
      citations.set(url, title ? { url, title } : { url });
    }
  }

  return [...citations.values()];
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  return (value as Record<string, T>)[key];
}
