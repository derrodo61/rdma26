import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { ToolDefinition } from '../../../shared/agent-contracts';
import { extractWebContent } from '../research/web-content-extractor';
import { readWebPage } from '../research/web-page-reader';

export const webSearchCapabilityId = 'web_search';
export const interpreterCapabilityId = 'interpreter';
const readWebPageToolId = 'read_web_page';
const readWebPageStructureToolId = 'read_web_page_structure';

interface CapabilityRegistration {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly provider: string;
  readonly isAvailable: () => boolean;
  readonly unavailableReason: string;
  readonly create: () => StructuredToolInterface;
}

export class CapabilityRegistry {
  private readonly registrations: readonly CapabilityRegistration[] = [
    {
      id: webSearchCapabilityId,
      label: 'Web search',
      description:
        'Provider-hosted internet search with page opening and source citations, using the agent-selected OpenAI model.',
      provider: 'openai',
      isAvailable: () => Boolean(process.env['OPENAI_API_KEY']),
      unavailableReason: 'OPENAI_API_KEY is required.',
      create: () => {
        throw new Error('web_search is an OpenAI hosted server tool, not a locally runnable tool.');
      },
    },
    {
      id: interpreterCapabilityId,
      label: 'Code interpreter',
      description:
        'Isolated QuickJS workspace for calculations and deterministic structured-data transformations.',
      provider: 'deepagents-quickjs',
      isAvailable: () => true,
      unavailableReason: 'The QuickJS interpreter is not available.',
      create: () => {
        throw new Error('interpreter is Deep Agents middleware, not a direct tool.');
      },
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
    {
      id: readWebPageStructureToolId,
      label: 'Read web page structure',
      description:
        'Fetch a public web page and return structured content such as tables, headings, links, lists, Markdown, or article text.',
      provider: 'web',
      isAvailable: () => true,
      unavailableReason: 'Web content extraction is not available.',
      create: () => createExtractWebContentTool(),
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

  validateCapabilityIds(capabilityIds: readonly string[]): readonly string[] {
    const normalizedCapabilityIds = normalizeCapabilityIds(capabilityIds);
    const knownToolIds = new Set(this.registrations.map((registration) => registration.id));
    const unknownToolIds = normalizedCapabilityIds.filter((toolId) => !knownToolIds.has(toolId));

    if (unknownToolIds.length) {
      throw new Error(`Unknown tool id: ${unknownToolIds.join(', ')}.`);
    }

    return normalizedCapabilityIds;
  }

  createRunnableTools(capabilityIds: readonly string[]): readonly StructuredToolInterface[] {
    const registrations = this.registrationsById(capabilityIds);

    return registrations
      .filter(
        (registration) =>
          registration.id !== webSearchCapabilityId && registration.id !== interpreterCapabilityId,
      )
      .map((registration) => {
        if (!registration.isAvailable()) {
          throw new Error(
            `Tool ${registration.id} is enabled for this agent but unavailable. ${registration.unavailableReason}`,
          );
        }

        return registration.create();
      });
  }

  private registrationsById(capabilityIds: readonly string[]): readonly CapabilityRegistration[] {
    const normalizedToolIds = this.validateCapabilityIds(capabilityIds);

    return normalizedToolIds.map((toolId) => {
      const registration = this.registrations.find((candidate) => candidate.id === toolId);

      if (!registration) {
        throw new Error(`Unknown tool id: ${toolId}.`);
      }

      return registration;
    });
  }
}

function createExtractWebContentTool(): StructuredToolInterface {
  return tool(
    async ({
      url,
      mode = 'overview',
      query,
      maxCharacters = 24_000,
      maxHtmlCharacters,
      maxTables = 20,
      maxRowsPerTable = 80,
      maxLists = 30,
      maxItemsPerList = 80,
    }: {
      url: string;
      mode?:
        'overview' | 'markdown' | 'article' | 'headings' | 'links' | 'lists' | 'tables' | 'full';
      query?: string;
      maxCharacters?: number;
      maxHtmlCharacters?: number;
      maxTables?: number;
      maxRowsPerTable?: number;
      maxLists?: number;
      maxItemsPerList?: number;
    }) =>
      extractWebContent(url, {
        mode,
        query,
        maxCharacters,
        maxHtmlCharacters: maxHtmlCharacters ?? (mode === 'full' ? 24_000 : 0),
        maxTables,
        maxRowsPerTable,
        maxLists,
        maxItemsPerList,
      }),
    {
      name: readWebPageStructureToolId,
      description:
        'Fetch a known public HTTP/HTTPS URL and return focused page structure. Use this when you already know the target URL and need structured content. Do not use it to discover sources; use web search first when the source URL is unknown. Use mode="tables" with a query for pricing/comparison pages, mode="headings" for headlines, mode="markdown" or "article" for prose, and mode="full" only for debugging. Rejects localhost and private-network URLs.',
      schema: z.object({
        url: z.string().url().describe('The public HTTP or HTTPS URL to extract.'),
        mode: z
          .enum(['overview', 'markdown', 'article', 'headings', 'links', 'lists', 'tables', 'full'])
          .optional()
          .default('overview')
          .describe(
            'Which representation to return. Prefer tables/headings/links/lists for focused tasks; use full only when explicitly needed.',
          ),
        query: z
          .string()
          .optional()
          .describe('Optional terms used to filter rows, headings, links, or list items.'),
        maxCharacters: z
          .number()
          .min(2_000)
          .max(60_000)
          .optional()
          .default(24_000)
          .describe('Maximum Markdown and readable text characters to return.'),
        maxHtmlCharacters: z
          .number()
          .min(0)
          .max(60_000)
          .optional()
          .describe(
            'Maximum cleaned HTML characters to return. Defaults to 0 except in full mode.',
          ),
        maxTables: z.number().min(0).max(50).optional().default(20),
        maxRowsPerTable: z.number().min(1).max(300).optional().default(80),
        maxLists: z.number().min(0).max(100).optional().default(30),
        maxItemsPerList: z.number().min(1).max(300).optional().default(80),
      }),
    },
  );
}

function createReadWebPageTool(): StructuredToolInterface {
  return tool(
    async ({ url, maxCharacters = 12_000 }: { url: string; maxCharacters?: number }) =>
      readWebPage(url, { maxCharacters }),
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
      }),
    },
  );
}

function normalizeCapabilityIds(capabilityIds: readonly string[]): readonly string[] {
  return [
    ...new Set(capabilityIds.map((capabilityId) => capabilityId.trim()).filter(Boolean)),
  ].sort();
}
