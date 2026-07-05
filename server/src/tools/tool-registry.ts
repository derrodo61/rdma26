import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { ToolDefinition } from '../../../shared/agent-contracts';
import type { SearchProvider, SearchTopic } from './search-provider';
import { TavilySearchProvider } from './tavily-search-provider';

export const internetSearchToolId = 'internet_search';

interface ToolRegistration {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly provider: string;
  readonly isAvailable: () => boolean;
  readonly unavailableReason: string;
  readonly create: () => StructuredToolInterface;
}

export class ToolRegistry {
  private readonly registrations: readonly ToolRegistration[] = [
    {
      id: internetSearchToolId,
      label: 'Internet search',
      description: 'Search the web with Tavily.',
      provider: 'tavily',
      isAvailable: () => Boolean(process.env['TAVILY_API_KEY']),
      unavailableReason: 'TAVILY_API_KEY is not configured.',
      create: () => createInternetSearchTool(readTavilySearchProvider()),
    },
  ];

  listDefinitions(): readonly ToolDefinition[] {
    return this.registrations.map((registration) => {
      const available = registration.isAvailable();

      return {
        id: registration.id,
        label: registration.label,
        description: registration.description,
        provider: registration.provider,
        available,
        unavailableReason: available ? undefined : registration.unavailableReason,
      };
    });
  }

  validateToolIds(toolIds: readonly string[]): readonly string[] {
    const knownToolIds = new Set(this.registrations.map((registration) => registration.id));
    const unknownToolIds = toolIds.filter((toolId) => !knownToolIds.has(toolId));

    if (unknownToolIds.length) {
      throw new Error(`Unknown tool id: ${unknownToolIds.join(', ')}.`);
    }

    return normalizeToolIds(toolIds);
  }

  createTools(toolIds: readonly string[]): readonly StructuredToolInterface[] {
    const registrations = this.registrationsById(toolIds);

    return registrations.map((registration) => {
      if (!registration.isAvailable()) {
        throw new Error(
          `Tool ${registration.id} is enabled for this agent but unavailable. ${registration.unavailableReason}`,
        );
      }

      return registration.create();
    });
  }

  private registrationsById(toolIds: readonly string[]): readonly ToolRegistration[] {
    const normalizedToolIds = this.validateToolIds(toolIds);

    return normalizedToolIds.map((toolId) => {
      const registration = this.registrations.find((candidate) => candidate.id === toolId);

      if (!registration) {
        throw new Error(`Unknown tool id: ${toolId}.`);
      }

      return registration;
    });
  }
}

function createInternetSearchTool(searchProvider: SearchProvider): StructuredToolInterface {
  return tool(
    async ({
      query,
      maxResults = 5,
      topic = 'general',
      includeRawContent = false,
    }: {
      query: string;
      maxResults?: number;
      topic?: SearchTopic;
      includeRawContent?: boolean;
    }) => await searchProvider.search({ query, maxResults, topic, includeRawContent }),
    {
      name: internetSearchToolId,
      description: 'Run a web search when current internet information would help.',
      schema: z.object({
        query: z.string().describe('The search query.'),
        maxResults: z
          .number()
          .min(1)
          .max(10)
          .optional()
          .default(5)
          .describe('Maximum number of results to return.'),
        topic: z
          .enum(['general', 'news', 'finance'])
          .optional()
          .default('general')
          .describe('Search topic category.'),
        includeRawContent: z
          .boolean()
          .optional()
          .default(false)
          .describe('Whether to include raw page content when available.'),
      }),
    },
  );
}

function readTavilySearchProvider(): TavilySearchProvider {
  const apiKey = process.env['TAVILY_API_KEY'];

  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is required to use internet_search.');
  }

  return new TavilySearchProvider(apiKey);
}

function normalizeToolIds(toolIds: readonly string[]): readonly string[] {
  return [...new Set(toolIds.map((toolId) => toolId.trim()).filter(Boolean))].sort();
}
