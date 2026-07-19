import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { CapabilityDefinition, ToolDefinition } from '../../../shared/agent-contracts';
import { extractWebContent } from '../research/web-content-extractor';
import { readWebPage } from '../research/web-page-reader';
import {
  createSkillAcquisitionTools,
  createSkillAuthoringTools,
  type SkillDiscoveryState,
  type SkillProposalToolRuntime,
  type SkillToolActor,
} from './skill-proposal-tools';

export const webSearchCapabilityId = 'web_search';
export const interpreterCapabilityId = 'interpreter';
export const webPageAccessCapabilityId = 'web_page_access';
export const skillAuthoringCapabilityId = 'skill_authoring';
export const skillAcquisitionCapabilityId = 'skill_acquisition';
const readWebPageToolId = 'read_web_page';
const readWebPageStructureToolId = 'read_web_page_structure';

interface CapabilityRegistration {
  readonly definition: Omit<CapabilityDefinition, 'available' | 'unavailableReason'>;
  readonly isAvailable: () => boolean;
  readonly unavailableReason: string;
  readonly createTools?: (context: CapabilityToolContext) => readonly StructuredToolInterface[];
}

interface CapabilityToolContext {
  readonly actor: SkillToolActor;
  readonly discovery: SkillDiscoveryState;
  readonly enabledCapabilityIds: readonly string[];
}

export class CapabilityRegistry {
  constructor(private readonly skillRuntime?: SkillProposalToolRuntime) {}

  private readonly registrations: readonly CapabilityRegistration[] = [
    {
      definition: {
        id: webSearchCapabilityId,
        label: 'Web search',
        description:
          'Provider-hosted internet search with page opening and source citations, using the agent-selected OpenAI model.',
        provider: 'openai',
        providedTools: [
          toolDefinition(
            webSearchCapabilityId,
            'Web search',
            'Search the public web through the selected OpenAI model.',
            'openai',
          ),
        ],
      },
      isAvailable: () => Boolean(process.env['OPENAI_API_KEY']),
      unavailableReason: 'OPENAI_API_KEY is required.',
    },
    {
      definition: {
        id: interpreterCapabilityId,
        label: 'Code interpreter',
        description:
          'Isolated QuickJS workspace for calculations and deterministic structured-data transformations.',
        provider: 'deepagents-quickjs',
        providedTools: [
          toolDefinition(
            'eval',
            'Evaluate JavaScript',
            'Run JavaScript in the isolated QuickJS interpreter.',
            'deepagents-quickjs',
          ),
        ],
      },
      isAvailable: () => true,
      unavailableReason: 'The QuickJS interpreter is not available.',
    },
    {
      definition: {
        id: webPageAccessCapabilityId,
        label: 'Web page access',
        description:
          'Read known public web pages as text or structured content for focused source inspection.',
        provider: 'web',
        providedTools: [
          toolDefinition(
            readWebPageToolId,
            'Read web page',
            'Read text from a known public web page.',
            'web',
          ),
          toolDefinition(
            readWebPageStructureToolId,
            'Read web page structure',
            'Extract tables, headings, links, lists, Markdown, or article text from a known public page.',
            'web',
          ),
        ],
      },
      isAvailable: () => true,
      unavailableReason: 'Web content extraction is not available.',
      createTools: () => [createReadWebPageTool(), createExtractWebContentTool()],
    },
    {
      definition: {
        id: skillAuthoringCapabilityId,
        label: 'Skill authoring',
        description:
          'Draft new user skills and revisions as reviewable proposals without applying or attaching them.',
        provider: 'rdma26-skills',
        providedTools: [
          toolDefinition(
            'propose_skill_create',
            'Propose skill creation',
            'Draft a new skill proposal.',
            'rdma26-skills',
          ),
          toolDefinition(
            'propose_skill_update',
            'Propose skill update',
            'Draft a skill revision proposal.',
            'rdma26-skills',
          ),
          toolDefinition(
            'list_skill_proposals',
            'List skill proposals',
            'List reviewable skill proposals.',
            'rdma26-skills',
          ),
          toolDefinition(
            'inspect_skill_proposal',
            'Inspect skill proposal',
            'Inspect a skill proposal.',
            'rdma26-skills',
          ),
        ],
      },
      isAvailable: () => Boolean(this.skillRuntime),
      unavailableReason: 'Skill proposal storage is not available.',
      createTools: (context) =>
        createSkillAuthoringTools(
          requireSkillRuntime(this.skillRuntime),
          context.actor,
          context.discovery,
          context.enabledCapabilityIds.includes(skillAcquisitionCapabilityId),
        ),
    },
    {
      definition: {
        id: skillAcquisitionCapabilityId,
        label: 'Skill acquisition',
        description:
          'Search and inspect existing skills and draft hash-bound installation proposals without installing them.',
        provider: 'rdma26-skills',
        providedTools: [
          toolDefinition(
            'search_installed_skills',
            'Search installed skills',
            'List reusable installed skills.',
            'rdma26-skills',
          ),
          toolDefinition(
            'search_skill_catalogs',
            'Search skill catalogs',
            'Search trusted skill catalogs.',
            'rdma26-skills',
          ),
          toolDefinition(
            'inspect_skill_package',
            'Inspect skill package',
            'Inspect an installed skill.',
            'rdma26-skills',
          ),
          toolDefinition(
            'compare_skill_candidates',
            'Compare skill candidates',
            'Compare installed and catalog skill candidates.',
            'rdma26-skills',
          ),
          toolDefinition(
            'check_skill_compatibility',
            'Check skill compatibility',
            'Scan an external skill source.',
            'rdma26-skills',
          ),
          toolDefinition(
            'propose_skill_install',
            'Propose skill installation',
            'Draft an installation proposal.',
            'rdma26-skills',
          ),
        ],
      },
      isAvailable: () => Boolean(this.skillRuntime),
      unavailableReason: 'Skill catalog and proposal storage are not available.',
      createTools: (context) =>
        createSkillAcquisitionTools(
          requireSkillRuntime(this.skillRuntime),
          context.actor,
          context.discovery,
        ),
    },
  ];

  listDefinitions(): readonly CapabilityDefinition[] {
    return this.registrations.map((registration) => {
      const available = registration.isAvailable();

      return {
        ...registration.definition,
        available,
        unavailableReason: available ? undefined : registration.unavailableReason,
      };
    });
  }

  validateCapabilityIds(capabilityIds: readonly string[]): readonly string[] {
    const normalizedCapabilityIds = normalizeCapabilityIds(capabilityIds);
    const knownCapabilityIds = new Set(
      this.registrations.map((registration) => registration.definition.id),
    );
    const unknownCapabilityIds = normalizedCapabilityIds.filter(
      (capabilityId) => !knownCapabilityIds.has(capabilityId),
    );

    if (unknownCapabilityIds.length) {
      throw new Error(`Unknown capability id: ${unknownCapabilityIds.join(', ')}.`);
    }

    return normalizedCapabilityIds;
  }

  createRunnableTools(
    capabilityIds: readonly string[],
    actor: SkillToolActor = { agentId: 'unknown' },
  ): readonly StructuredToolInterface[] {
    const registrations = this.registrationsById(capabilityIds);
    const context: CapabilityToolContext = {
      actor,
      discovery: { searchedInstalled: false, searchedCatalog: false },
      enabledCapabilityIds: capabilityIds,
    };

    return registrations.flatMap((registration) => {
      if (!registration.createTools) {
        return [];
      }

      if (!registration.isAvailable()) {
        throw new Error(
          `Capability ${registration.definition.id} is enabled for this agent but unavailable. ${registration.unavailableReason}`,
        );
      }

      return registration.createTools(context);
    });
  }

  private registrationsById(capabilityIds: readonly string[]): readonly CapabilityRegistration[] {
    const normalizedToolIds = this.validateCapabilityIds(capabilityIds);

    return normalizedToolIds.map((capabilityId) => {
      const registration = this.registrations.find(
        (candidate) => candidate.definition.id === capabilityId,
      );

      if (!registration) {
        throw new Error(`Unknown capability id: ${capabilityId}.`);
      }

      return registration;
    });
  }
}

function requireSkillRuntime(
  runtime: SkillProposalToolRuntime | undefined,
): SkillProposalToolRuntime {
  if (!runtime) {
    throw new Error('Skill proposal runtime is unavailable.');
  }
  return runtime;
}

function toolDefinition(
  id: string,
  label: string,
  description: string,
  provider: string,
): ToolDefinition {
  return { id, label, description, provider, available: true };
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
