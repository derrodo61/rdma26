import { TavilySearch } from '@langchain/tavily';

import type { SearchProvider, SearchRequest } from './search-provider';

export class TavilySearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search({
    query,
    maxResults = 5,
    topic = 'general',
    includeRawContent = false,
  }: SearchRequest): Promise<unknown> {
    const tavilySearch = new TavilySearch({
      maxResults,
      tavilyApiKey: this.apiKey,
      includeRawContent,
      topic,
    });

    return await tavilySearch._call({ query, topic });
  }
}
