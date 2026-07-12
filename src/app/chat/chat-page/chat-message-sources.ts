import type {
  ChatThread,
  RunContextDetails,
  RunContextToolCall,
} from '../../../../shared/agent-contracts';
import type { ResearchSourceSummary } from './chat-page.types';

interface ResearchToolResult extends Record<string, unknown> {
  readonly answerSourceUrls?: readonly unknown[];
  readonly findings?: readonly {
    readonly item?: unknown;
    readonly sourceUrls?: readonly unknown[];
  }[];
  readonly sources?: readonly {
    readonly url?: unknown;
    readonly title?: unknown;
  }[];
}

export function buildMessageResearchSources(
  thread: ChatThread | null,
  runContexts: readonly RunContextDetails[],
): Readonly<Record<string, readonly ResearchSourceSummary[]>> {
  return runContexts.reduce<Readonly<Record<string, readonly ResearchSourceSummary[]>>>(
    (sourcesByMessageId, runContext) =>
      mergeMessageResearchSources(sourcesByMessageId, thread, runContext),
    {},
  );
}

export function mergeMessageResearchSources(
  current: Readonly<Record<string, readonly ResearchSourceSummary[]>>,
  thread: ChatThread | null,
  runContext: RunContextDetails,
): Readonly<Record<string, readonly ResearchSourceSummary[]>> {
  const sources = extractResearchSources(runContext.toolCalls ?? []);

  if (!sources.length) {
    return current;
  }

  const messageId = resolveAssistantMessageId(thread, runContext, current);

  if (!messageId) {
    return current;
  }

  return {
    ...current,
    [messageId]: sources,
  };
}

function extractResearchSources(
  toolCalls: readonly RunContextToolCall[],
): readonly ResearchSourceSummary[] {
  const sources = new Map<string, ResearchSourceSummary>();

  for (const toolCall of toolCalls) {
    if (toolCall.name !== 'research' && toolCall.name !== 'task') {
      continue;
    }

    const payloads = parseStructuredPayloads(toolCall.result);
    const results = payloads.filter(isResearchToolResult);

    for (const result of results) {
      const answerSourceUrls = readAnswerSourceUrls(result);

      for (const url of answerSourceUrls) {
        sources.set(url, {
          url,
          title: readUrlDomain(url),
          domain: readUrlDomain(url),
        });
      }

      for (const source of result.sources ?? []) {
        if (typeof source.url !== 'string' || !source.url) {
          continue;
        }

        if (answerSourceUrls.size > 0 && !answerSourceUrls.has(source.url)) {
          continue;
        }

        sources.set(source.url, {
          url: source.url,
          title:
            typeof source.title === 'string' && source.title.trim() ? source.title : source.url,
          domain: readUrlDomain(source.url),
        });
      }
    }
  }

  return [...sources.values()];
}

function resolveAssistantMessageId(
  thread: ChatThread | null,
  runContext: RunContextDetails,
  current: Readonly<Record<string, readonly ResearchSourceSummary[]>>,
): string | null {
  if (
    runContext.assistantMessageId &&
    thread?.messages.some((message) => message.id === runContext.assistantMessageId)
  ) {
    return runContext.assistantMessageId;
  }

  const assistantResponse = runContext.assistantResponse?.trim();

  if (!assistantResponse) {
    return null;
  }

  return (
    thread?.messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.content.trim() === assistantResponse &&
        !current[message.id],
    )?.id ?? null
  );
}

function readAnswerSourceUrls(result: ResearchToolResult | null): ReadonlySet<string> {
  const explicitUrls = new Set(
    (result?.answerSourceUrls ?? []).filter((url): url is string => typeof url === 'string'),
  );

  if (explicitUrls.size > 0) {
    return explicitUrls;
  }

  const fallbackUrls = new Set<string>();

  for (const finding of result?.findings ?? []) {
    if (isRejectedResearchFinding(finding.item)) {
      continue;
    }

    for (const url of finding.sourceUrls ?? []) {
      if (typeof url === 'string' && url) {
        fallbackUrls.add(url);
      }
    }
  }

  return fallbackUrls;
}

function isRejectedResearchFinding(item: unknown): boolean {
  if (typeof item !== 'string') {
    return false;
  }

  const normalized = item.trim().toLowerCase();

  return (
    normalized.startsWith('not ') ||
    normalized.startsWith('nicht ') ||
    normalized.startsWith('kein ') ||
    normalized.includes(' not the ') ||
    normalized.includes(' nicht der ') ||
    normalized.includes(' nicht die ') ||
    normalized.includes(' nicht das ')
  );
}

function parseStructuredPayloads(result: string | undefined): readonly Record<string, unknown>[] {
  if (!result) {
    return [];
  }

  const payloads: Record<string, unknown>[] = [];
  visitStructuredPayload(result, payloads, 0);
  return payloads;
}

function visitStructuredPayload(
  value: unknown,
  payloads: Record<string, unknown>[],
  depth: number,
): void {
  if (depth > 10 || value === null || value === undefined) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;

    try {
      visitStructuredPayload(JSON.parse(trimmed) as unknown, payloads, depth + 1);
    } catch {
      return;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) visitStructuredPayload(item, payloads, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  payloads.push(record);
  for (const candidate of Object.values(record)) {
    visitStructuredPayload(candidate, payloads, depth + 1);
  }
}

function isResearchToolResult(value: Record<string, unknown>): value is ResearchToolResult {
  return 'answerSourceUrls' in value || 'findings' in value || 'sources' in value;
}

function readUrlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
