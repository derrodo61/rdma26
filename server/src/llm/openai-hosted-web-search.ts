import type { RunContextToolCall } from '../../../shared/agent-contracts';

export function extractOpenAiHostedWebToolCalls(
  assistantMessage: unknown,
  resultCitations: readonly WebSource[] = [],
): readonly RunContextToolCall[] {
  const additionalKwargs = readProperty<Record<string, unknown>>(
    assistantMessage,
    'additional_kwargs',
  );
  const outputs = Array.isArray(additionalKwargs?.['tool_outputs'])
    ? additionalKwargs['tool_outputs']
    : [];
  const messageCitations = extractUrlCitations(readProperty<unknown>(assistantMessage, 'content'));
  const citations = mergeSources(resultCitations, messageCitations);

  return outputs.flatMap((output, index) => {
    if (readProperty<string>(output, 'type') !== 'web_search_call') return [];
    const action = readProperty<Record<string, unknown>>(output, 'action') ?? {};
    const actionSources = extractActionSources(action);
    const sources = mergeSources(citations, actionSources);
    const answerSources = citations.length ? citations : actionSources;

    return [
      {
        id: readProperty<string>(output, 'id') ?? `openai-web-search-${index + 1}`,
        name: 'web_search',
        args: action,
        result: JSON.stringify({
          action,
          answerSourceUrls: answerSources.map((source) => source.url),
          sources,
        }),
      },
    ];
  });
}

export function extractOpenAiHostedWebToolCallsFromAgentResult(
  result: unknown,
): readonly RunContextToolCall[] {
  const messages = readProperty<unknown[]>(result, 'messages') ?? [];
  const citations = mergeSources(
    ...messages.map((message) => extractUrlCitations(readProperty<unknown>(message, 'content'))),
  );
  return messages.flatMap((message) => extractOpenAiHostedWebToolCalls(message, citations));
}

interface WebSource {
  readonly url: string;
  readonly title?: string;
}

function extractUrlCitations(content: unknown): readonly WebSource[] {
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

function extractActionSources(action: Record<string, unknown>): readonly WebSource[] {
  const sources = readProperty<unknown[]>(action, 'sources') ?? [];

  return sources.flatMap((source) => {
    const url = readProperty<string>(source, 'url');
    return url ? [{ url }] : [];
  });
}

function mergeSources(...groups: readonly (readonly WebSource[])[]): readonly WebSource[] {
  const sources = new Map<string, WebSource>();

  for (const group of groups) {
    for (const source of group) {
      const current = sources.get(source.url);
      sources.set(source.url, source.title || !current ? source : current);
    }
  }

  return [...sources.values()];
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  return (value as Record<string, T>)[key];
}
