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

export function normalizeAssistantText(content: string): string {
  return content.replace(
    /(\(?\[[^\]]+\]\((https?:\/\/[^)\s]+)\)\)?)\((https?:\/\/[^)\s]+)\)/g,
    (match: string, markdownCitation: string, markdownUrl: string, repeatedUrl: string) =>
      equivalentCitationUrls(markdownUrl, repeatedUrl) ? markdownCitation : match,
  );
}

function equivalentCitationUrls(first: string, second: string): boolean {
  return canonicalizeCitationUrl(first) === canonicalizeCitationUrl(second);
}

function canonicalizeCitationUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
      if (key === 'utm_source' || key.startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}
