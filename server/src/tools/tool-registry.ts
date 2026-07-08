import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { ToolDefinition } from '../../../shared/agent-contracts';
import type { SearchProvider, SearchTopic } from '../research/search-provider';
import { withSearchQualityHints } from '../research/search-quality';
import { TavilySearchProvider } from '../research/tavily-search-provider';
import { readWebPage } from '../research/web-page-reader';

export const researchToolId = 'research';
const internetSearchToolId = 'internet_search';
const readWebPageToolId = 'read_web_page';

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
      id: researchToolId,
      label: 'Research',
      description:
        'Deep Agents researcher subagent capability with source reading and verification.',
      provider: 'rdma26-research',
      isAvailable: () => Boolean(process.env['TAVILY_API_KEY'] && process.env['OPENAI_API_KEY']),
      unavailableReason: 'TAVILY_API_KEY and OPENAI_API_KEY are required.',
      create: () => {
        throw new Error('research is a Deep Agents subagent capability, not a direct tool.');
      },
    },
    {
      id: internetSearchToolId,
      label: 'Internet search',
      description: 'Low-level Tavily search primitive for specialized or debugging workflows.',
      provider: 'tavily',
      isAvailable: () => Boolean(process.env['TAVILY_API_KEY']),
      unavailableReason: 'TAVILY_API_KEY is not configured.',
      create: () => createInternetSearchTool(readTavilySearchProvider()),
    },
    {
      id: readWebPageToolId,
      label: 'Read web page',
      description: 'Low-level public web page reader for source inspection workflows.',
      provider: 'web',
      isAvailable: () => true,
      unavailableReason: 'Web page reading is not available.',
      create: () => createReadWebPageTool(),
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

    return registrations
      .filter((registration) => registration.id !== researchToolId)
      .map((registration) => {
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

function createReadWebPageTool(): StructuredToolInterface {
  return tool(
    async ({
      url,
      maxCharacters = 12_000,
      query,
    }: {
      url: string;
      maxCharacters?: number;
      query?: string;
    }) => readWebPage(url, { maxCharacters, query }),
    {
      name: readWebPageToolId,
      description:
        'Read a public HTTP/HTTPS web page after search to verify source details. For precise current-list or current-result questions, use this before finalizing the answer. Rejects localhost and private-network URLs.',
      schema: z.object({
        url: z.string().url().describe('The public HTTP or HTTPS URL to read.'),
        maxCharacters: z
          .number()
          .min(1_000)
          .max(30_000)
          .optional()
          .default(12_000)
          .describe('Maximum number of readable text characters to return.'),
        query: z
          .string()
          .optional()
          .describe('Optional user intent query to focus extraction on the needed evidence.'),
      }),
    },
  );
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
    }) => {
      const request = {
        query,
        maxResults,
        topic,
        includeRawContent,
      };
      const result = await searchProvider.search(request);

      return withSearchQualityHints(result, request);
    },
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
