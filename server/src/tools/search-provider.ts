export type SearchTopic = 'general' | 'news' | 'finance';

export interface SearchRequest {
  readonly query: string;
  readonly maxResults?: number;
  readonly topic?: SearchTopic;
  readonly includeRawContent?: boolean;
}

export interface SearchProvider {
  search(request: SearchRequest): Promise<unknown>;
}
