import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type {
  CostSummaryGroupBy,
  CreateMemoryRequest,
  CreateModelPricingRequest,
  CreatePricingSourceRequest,
  LlmCallPurpose,
  LlmCallStatus,
  MemoryLifetime,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  ModelPricingStatus,
  PricingSourceTrustLevel,
  ToolDefinition,
  UpdatePricingSourceRequest,
} from '../../../shared/agent-contracts';
import type { AssistantRuntime } from '../runtime';

const memoryScopeSchema = z.enum(['agent', 'agent_user', 'user']);
const memoryTypeSchema = z.enum([
  'fact',
  'preference',
  'conversation_summary',
  'open_task',
  'tracked_topic',
]);
const memoryStatusSchema = z.enum(['active', 'archived', 'superseded']);
const memoryLifetimeSchema = z.enum(['permanent', 'active', 'temporary']);
const llmCallPurposeSchema = z.enum([
  'chat',
  'research_parent',
  'research_subagent',
  'research_verification',
  'thread_summary',
  'memory_retrieval',
  'memory_maintenance',
  'operator',
  'unknown',
]);
const llmCallStatusSchema = z.enum(['success', 'error', 'cancelled']);
const costSummaryGroupBySchema = z.enum(['day', 'agent', 'model', 'purpose']);
const modelPricingStatusSchema = z.enum(['active', 'superseded', 'unverified']);
const pricingSourceTrustLevelSchema = z.enum(['official', 'third_party', 'user_added']);

const adminToolDefinitions: readonly ToolDefinition[] = [
  {
    id: 'admin_list_agents',
    label: 'List agents',
    description: 'List all configured agents.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_create_agent',
    label: 'Create agent',
    description: 'Create a new agent with an optional id and required display name.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_update_agent',
    label: 'Update agent',
    description: 'Update an agent display name.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_set_agent_memory_writes',
    label: 'Set memory settings',
    description: 'Enable or disable long-term memory reads and writes for an agent.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_delete_agent',
    label: 'Delete agent',
    description: 'Delete a non-protected agent and all related data.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_read_agent_soul',
    label: 'Read soul.md',
    description: "Read an agent's soul.md content.",
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_update_agent_soul',
    label: 'Update soul.md',
    description: "Replace an agent's soul.md content.",
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_list_tools',
    label: 'List tools',
    description: 'List normal assignable tools and their availability.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_grant_agent_tool',
    label: 'Grant tool',
    description: 'Grant a normal assignable tool to an agent.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_revoke_agent_tool',
    label: 'Revoke tool',
    description: 'Revoke a normal assignable tool from an agent.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_list_memories',
    label: 'List memories',
    description: 'List memories across scopes or for a specific agent.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_read_memory',
    label: 'Read memory',
    description: 'Read one memory by id.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_create_memory',
    label: 'Create memory',
    description: 'Create a memory in an agent, agent-user, or global user scope.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_update_memory',
    label: 'Update memory',
    description: 'Update memory content, type, lifetime, status, or tags.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_archive_memory',
    label: 'Archive memory',
    description: 'Archive one memory without deleting it.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_delete_memory',
    label: 'Delete memory',
    description: 'Delete one memory after explicit confirmation.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_list_llm_calls',
    label: 'List LLM calls',
    description: 'List recorded LLM calls for usage and cost inspection.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_summarize_costs',
    label: 'Summarize costs',
    description: 'Summarize estimated LLM costs by day, agent, model, or purpose.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_list_model_pricing',
    label: 'List pricing',
    description: 'List configured model pricing records used for estimated costs.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_create_model_pricing',
    label: 'Create pricing',
    description: 'Create an unverified model pricing record from a researched source.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_update_model_pricing',
    label: 'Update pricing',
    description: 'Activate, supersede, or annotate a model pricing record after approval.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_list_pricing_sources',
    label: 'List pricing sources',
    description: 'List configured provider pricing source pages.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_create_pricing_source',
    label: 'Create pricing source',
    description: 'Add a provider pricing source page.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_update_pricing_source',
    label: 'Update pricing source',
    description: 'Update or deactivate a provider pricing source page.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_delete_pricing_source',
    label: 'Delete pricing source',
    description: 'Delete a provider pricing source page after confirmation.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_check_pricing_source',
    label: 'Check pricing source',
    description: 'Check whether a provider pricing source page is reachable.',
    provider: 'rdma26-admin',
    available: true,
  },
  {
    id: 'admin_read_pricing_source_page',
    label: 'Read pricing source',
    description:
      'Fallback reader for a configured provider pricing source page when structured extraction is incomplete.',
    provider: 'rdma26-admin',
    available: true,
  },
];

export function listAdminToolDefinitions(): readonly ToolDefinition[] {
  return adminToolDefinitions;
}

export function createAdminTools(runtime: AssistantRuntime): readonly StructuredToolInterface[] {
  return [
    tool(async () => await runtime.agentsResponse(), {
      name: 'admin_list_agents',
      description: 'List all configured agents. Only available to protected system agents.',
      schema: z.object({}),
    }),
    tool(
      async ({ id, name }: { id?: string; name: string }) =>
        await runtime.createAgent({
          id,
          name,
        }),
      {
        name: 'admin_create_agent',
        description: 'Create a new agent with an optional id and required display name.',
        schema: z.object({
          id: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional stable agent id. Omit to derive it from the name.'),
          name: z.string().trim().min(1).describe('Agent display name.'),
        }),
      },
    ),
    tool(
      async ({ agentId, name }: { agentId: string; name: string }) =>
        await runtime.updateAgent(agentId, { name }),
      {
        name: 'admin_update_agent',
        description: 'Update an agent display name.',
        schema: z.object({
          agentId: z.string().trim().min(1).describe('Agent id to update.'),
          name: z.string().trim().min(1).describe('New display name.'),
        }),
      },
    ),
    tool(
      async ({
        agentId,
        canRead,
        canWrite,
      }: {
        agentId: string;
        canRead?: boolean;
        canWrite?: boolean;
      }) => {
        if (canRead === undefined && canWrite === undefined) {
          throw new Error('Set canRead, canWrite, or both.');
        }

        return await runtime.updateAgent(agentId, {
          memory: {
            canRead,
            canWrite,
          },
        });
      },
      {
        name: 'admin_set_agent_memory_writes',
        description:
          'Enable or disable long-term memory reads and writes for an agent. Set canRead to control whether saved memories are injected into chat runs. Set canWrite to control whether the agent may save memories.',
        schema: z.object({
          agentId: z.string().trim().min(1).describe('Agent id to update.'),
          canRead: z
            .boolean()
            .optional()
            .describe('Whether saved memories may be retrieved for chat runs.'),
          canWrite: z.boolean().optional().describe('Whether the agent may write memories.'),
        }),
      },
    ),
    tool(async ({ agentId }: { agentId: string }) => await runtime.deleteAgent(agentId), {
      name: 'admin_delete_agent',
      description:
        'Delete an agent and all related data. Protected system agents cannot be deleted.',
      schema: z.object({
        agentId: z.string().trim().min(1).describe('Agent id to delete.'),
      }),
    }),
    tool(async ({ agentId }: { agentId: string }) => await runtime.readAgentSoul(agentId), {
      name: 'admin_read_agent_soul',
      description: "Read an agent's soul.md content.",
      schema: z.object({
        agentId: z.string().trim().min(1).describe('Agent id whose soul.md should be read.'),
      }),
    }),
    tool(
      async ({ agentId, content }: { agentId: string; content: string }) =>
        await runtime.updateAgentSoul(agentId, { content }),
      {
        name: 'admin_update_agent_soul',
        description: "Replace an agent's soul.md content.",
        schema: z.object({
          agentId: z.string().trim().min(1).describe('Agent id whose soul.md should be updated.'),
          content: z.string().describe('Full Markdown content for soul.md.'),
        }),
      },
    ),
    tool(async () => runtime.toolsResponse(), {
      name: 'admin_list_tools',
      description: 'List normal assignable tools and their availability.',
      schema: z.object({}),
    }),
    tool(
      async ({ agentId, toolId }: { agentId: string; toolId: string }) =>
        await runtime.grantAgentTool(agentId, toolId),
      {
        name: 'admin_grant_agent_tool',
        description: 'Grant a normal assignable tool to an agent.',
        schema: z.object({
          agentId: z.string().trim().min(1).describe('Agent id receiving the tool.'),
          toolId: z.string().trim().min(1).describe('Tool id to grant.'),
        }),
      },
    ),
    tool(
      async ({ agentId, toolId }: { agentId: string; toolId: string }) =>
        await runtime.revokeAgentTool(agentId, toolId),
      {
        name: 'admin_revoke_agent_tool',
        description: 'Revoke a normal assignable tool from an agent.',
        schema: z.object({
          agentId: z.string().trim().min(1).describe('Agent id losing the tool.'),
          toolId: z.string().trim().min(1).describe('Tool id to revoke.'),
        }),
      },
    ),
    tool(
      async ({ agentId, scope, type, status, query, limit }: AdminListMemoriesInput) =>
        await runtime.listMemories({
          agentId,
          scope,
          type,
          status,
          query,
          limit,
        }),
      {
        name: 'admin_list_memories',
        description:
          'List memories across scopes or for a specific agent. Use this before changing or deleting existing memories.',
        schema: z.object({
          agentId: z.string().trim().min(1).optional().describe('Optional agent id filter.'),
          scope: memoryScopeSchema.optional().describe('Optional memory scope filter.'),
          type: memoryTypeSchema.optional().describe('Optional memory type filter.'),
          status: memoryStatusSchema.optional().describe('Optional memory status filter.'),
          query: z.string().trim().min(1).optional().describe('Optional text search query.'),
          limit: z.number().int().min(1).max(100).optional().describe('Maximum memories to list.'),
        }),
      },
    ),
    tool(async ({ memoryId }: { memoryId: string }) => await runtime.readMemory(memoryId), {
      name: 'admin_read_memory',
      description: 'Read one memory by id.',
      schema: z.object({
        memoryId: z.string().uuid().describe('Memory id to read.'),
      }),
    }),
    tool(async (input: AdminCreateMemoryInput) => await runtime.createMemory(input), {
      name: 'admin_create_memory',
      description:
        'Create a memory. Ask first before writing sensitive, ambiguous, conflicting, or unclear-scope information.',
      schema: z.object({
        scope: memoryScopeSchema.describe('Memory scope.'),
        agentId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('Required for agent and agent_user scopes. Omit for user scope.'),
        type: memoryTypeSchema.describe('Memory type.'),
        lifetime: memoryLifetimeSchema.default('active').describe('Memory lifetime.'),
        content: z.string().trim().min(1).describe('Concise memory content.'),
        tags: z.array(z.string().trim().min(1)).default([]).describe('Optional memory tags.'),
      }),
    }),
    tool(
      async ({ memoryId, type, status, lifetime, content, tags }: AdminUpdateMemoryInput) =>
        await runtime.updateMemory(memoryId, {
          type,
          status,
          lifetime,
          content,
          tags,
        }),
      {
        name: 'admin_update_memory',
        description:
          'Update one memory. Use this to correct, supersede, or refine memory content and metadata.',
        schema: z.object({
          memoryId: z.string().uuid().describe('Memory id to update.'),
          type: memoryTypeSchema.optional().describe('New memory type.'),
          status: memoryStatusSchema.optional().describe('New memory status.'),
          lifetime: memoryLifetimeSchema.optional().describe('New memory lifetime.'),
          content: z.string().trim().min(1).optional().describe('New memory content.'),
          tags: z.array(z.string().trim().min(1)).optional().describe('Replacement tags.'),
        }),
      },
    ),
    tool(
      async ({ memoryId }: { memoryId: string }) =>
        await runtime.updateMemory(memoryId, { status: 'archived' }),
      {
        name: 'admin_archive_memory',
        description: 'Archive one memory without deleting it.',
        schema: z.object({
          memoryId: z.string().uuid().describe('Memory id to archive.'),
        }),
      },
    ),
    tool(
      async ({ memoryId, confirm }: { memoryId: string; confirm: boolean }) => {
        if (!confirm) {
          throw new Error('Memory deletion requires confirm=true.');
        }

        return await runtime.deleteMemory(memoryId);
      },
      {
        name: 'admin_delete_memory',
        description:
          'Delete one memory. Only use after the user explicitly confirms destructive deletion.',
        schema: z.object({
          memoryId: z.string().uuid().describe('Memory id to delete.'),
          confirm: z.literal(true).describe('Must be true after explicit user confirmation.'),
        }),
      },
    ),
    tool(
      async (input: AdminListLlmCallsInput) =>
        await runtime.listLlmCalls({
          agentId: input.agentId,
          threadId: input.threadId,
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          status: input.status,
          startedFrom: input.startedFrom,
          startedTo: input.startedTo,
          limit: input.limit,
        }),
      {
        name: 'admin_list_llm_calls',
        description:
          'List recorded LLM calls. Use this to inspect model usage, purpose, token counts, errors, and estimated costs.',
        schema: z.object({
          agentId: z.string().trim().min(1).optional().describe('Optional agent id filter.'),
          threadId: z.string().uuid().optional().describe('Optional thread id filter.'),
          provider: z.string().trim().min(1).optional().describe('Optional provider filter.'),
          model: z.string().trim().min(1).optional().describe('Optional model filter.'),
          purpose: llmCallPurposeSchema.optional().describe('Optional call purpose filter.'),
          status: llmCallStatusSchema.optional().describe('Optional call status filter.'),
          startedFrom: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional start date lower bound.'),
          startedTo: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional start date upper bound.'),
          limit: z.number().int().min(1).max(100).default(20).describe('Maximum calls to list.'),
        }),
      },
    ),
    tool(
      async (input: AdminSummarizeCostsInput) =>
        await runtime.summarizeCosts({
          agentId: input.agentId,
          threadId: input.threadId,
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          status: input.status,
          startedFrom: input.startedFrom,
          startedTo: input.startedTo,
          groupBy: input.groupBy,
        }),
      {
        name: 'admin_summarize_costs',
        description:
          'Summarize estimated LLM costs. Use this before advising about expensive models, agents, or purposes.',
        schema: z.object({
          agentId: z.string().trim().min(1).optional().describe('Optional agent id filter.'),
          threadId: z.string().uuid().optional().describe('Optional thread id filter.'),
          provider: z.string().trim().min(1).optional().describe('Optional provider filter.'),
          model: z.string().trim().min(1).optional().describe('Optional model filter.'),
          purpose: llmCallPurposeSchema.optional().describe('Optional call purpose filter.'),
          status: llmCallStatusSchema.optional().describe('Optional call status filter.'),
          startedFrom: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional start date lower bound.'),
          startedTo: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional start date upper bound.'),
          groupBy: costSummaryGroupBySchema.default('day').describe('Summary grouping.'),
        }),
      },
    ),
    tool(
      async ({ provider, model, status }: AdminListModelPricingInput) =>
        await runtime.listModelPricing({
          provider,
          model,
          status,
        }),
      {
        name: 'admin_list_model_pricing',
        description: 'List model pricing records used to calculate estimated costs.',
        schema: z.object({
          provider: z.string().trim().min(1).optional().describe('Optional provider filter.'),
          model: z.string().trim().min(1).optional().describe('Optional model filter.'),
          status: z
            .enum(['active', 'superseded', 'unverified'])
            .optional()
            .describe('Optional pricing status filter.'),
        }),
      },
    ),
    tool(
      async ({ provider, trustLevel, active }: AdminListPricingSourcesInput) =>
        await runtime.listPricingSources({
          provider,
          trustLevel,
          active,
        }),
      {
        name: 'admin_list_pricing_sources',
        description:
          'List configured provider pricing source pages. Use this before researching provider model prices.',
        schema: z.object({
          provider: z.string().trim().min(1).optional().describe('Optional provider filter.'),
          trustLevel: pricingSourceTrustLevelSchema
            .optional()
            .describe('Optional trust-level filter.'),
          active: z.boolean().optional().describe('Optional active-state filter.'),
        }),
      },
    ),
    tool(async (input: CreatePricingSourceRequest) => await runtime.createPricingSource(input), {
      name: 'admin_create_pricing_source',
      description: 'Add a provider pricing source page to the persistent source registry.',
      schema: z.object({
        provider: z.string().trim().min(1).describe('Provider id, such as openai.'),
        name: z.string().trim().min(1).describe('Human-readable source name.'),
        url: z.string().url().describe('Source URL.'),
        trustLevel: pricingSourceTrustLevelSchema
          .default('user_added')
          .describe('Trust level for the source.'),
        active: z.boolean().default(true).describe('Whether this source should be used.'),
        notes: z.string().trim().min(1).optional().describe('Optional source note.'),
      }),
    }),
    tool(
      async ({ sourceId, ...input }: AdminUpdatePricingSourceInput) =>
        await runtime.updatePricingSource(sourceId, input),
      {
        name: 'admin_update_pricing_source',
        description: 'Update, activate, or deactivate a provider pricing source page.',
        schema: z.object({
          sourceId: z.string().uuid().describe('Pricing source id.'),
          provider: z.string().trim().min(1).optional().describe('Optional provider id.'),
          name: z.string().trim().min(1).optional().describe('Optional source name.'),
          url: z.string().url().optional().describe('Optional source URL.'),
          trustLevel: pricingSourceTrustLevelSchema
            .optional()
            .describe('Optional source trust level.'),
          active: z.boolean().optional().describe('Optional active-state update.'),
          notes: z.string().trim().min(1).optional().describe('Optional source note.'),
        }),
      },
    ),
    tool(
      async ({ sourceId, confirm }: AdminDeletePricingSourceInput) => {
        if (!confirm) {
          throw new Error('Deleting a pricing source requires confirm=true.');
        }

        return await runtime.deletePricingSource(sourceId);
      },
      {
        name: 'admin_delete_pricing_source',
        description: 'Delete a provider pricing source page after explicit confirmation.',
        schema: z.object({
          sourceId: z.string().uuid().describe('Pricing source id.'),
          confirm: z.literal(true).describe('Must be true after explicit user approval.'),
        }),
      },
    ),
    tool(async ({ sourceId }: { sourceId: string }) => await runtime.checkPricingSource(sourceId), {
      name: 'admin_check_pricing_source',
      description: 'Check whether a provider pricing source page is reachable.',
      schema: z.object({
        sourceId: z.string().uuid().describe('Pricing source id.'),
      }),
    }),
    tool(
      async ({ sourceId, query }: { sourceId: string; query?: string }) =>
        await runtime.readPricingSourcePage(sourceId, query),
      {
        name: 'admin_read_pricing_source_page',
        description:
          'Fallback reader for a configured provider pricing source page. Use read_web_page_structure first for pricing comparisons; use this only when structured extraction is incomplete, truncated, or missing needed rows.',
        schema: z.object({
          sourceId: z.string().uuid().describe('Pricing source id.'),
          query: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional extraction hint for the page reader.'),
        }),
      },
    ),
    tool(
      async (input: AdminCreateModelPricingInput) => {
        await ensurePricingSourceAllowed(runtime, input.provider, input.sourceUrl);

        return await runtime.createModelPricing({
          ...input,
          status: 'unverified',
        });
      },
      {
        name: 'admin_create_model_pricing',
        description:
          'Create an unverified model pricing proposal after researching a trustworthy source. First list configured pricing sources and use active official sources when available. This does not activate the price.',
        schema: z.object({
          provider: z.string().trim().min(1).describe('Provider id, such as openai.'),
          model: z.string().trim().min(1).describe('Exact model id.'),
          inputCostPerMillionTokens: z
            .number()
            .min(0)
            .describe('Input token cost per 1 million tokens.'),
          outputCostPerMillionTokens: z
            .number()
            .min(0)
            .describe('Output token cost per 1 million tokens.'),
          cachedInputCostPerMillionTokens: z
            .number()
            .min(0)
            .optional()
            .describe('Cached input token cost per 1 million tokens when the provider lists it.'),
          reasoningCostPerMillionTokens: z
            .number()
            .min(0)
            .optional()
            .describe('Reasoning token cost per 1 million tokens when the provider lists it.'),
          currency: z.string().trim().min(1).default('USD').describe('Pricing currency.'),
          sourceUrl: z.string().url().describe('Source URL used for the pricing record.'),
          sourceName: z.string().trim().min(1).optional().describe('Human-readable source name.'),
          sourceRetrievedAt: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('ISO timestamp or date when the source was retrieved.'),
          validFrom: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional date/time when this pricing became valid.'),
          validUntil: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional date/time when this pricing stops being valid.'),
          notes: z.string().trim().min(1).optional().describe('Short evidence or caveat note.'),
        }),
      },
    ),
    tool(
      async ({ pricingId, status, validUntil, notes, confirm }: AdminUpdateModelPricingInput) => {
        if (!confirm) {
          throw new Error('Pricing status changes require confirm=true after explicit approval.');
        }

        return await runtime.updateModelPricing(pricingId, {
          status,
          validUntil,
          notes,
        });
      },
      {
        name: 'admin_update_model_pricing',
        description:
          'Activate, supersede, or annotate a pricing record. Only use after the user explicitly approves this pricing change.',
        schema: z.object({
          pricingId: z.string().uuid().describe('Pricing record id.'),
          status: modelPricingStatusSchema.describe('New pricing status.'),
          validUntil: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Optional date/time when superseded pricing stopped being valid.'),
          notes: z.string().trim().min(1).optional().describe('Optional update note.'),
          confirm: z.literal(true).describe('Must be true after explicit user approval.'),
        }),
      },
    ),
  ];
}

async function ensurePricingSourceAllowed(
  runtime: AssistantRuntime,
  provider: string,
  sourceUrl: string,
): Promise<void> {
  const sources = await runtime.listPricingSources({
    provider,
    trustLevel: 'official',
    active: true,
  });

  if (!sources.sources.length) {
    return;
  }

  const normalizedSourceUrl = normalizeUrl(sourceUrl);
  const matchesConfiguredSource = sources.sources.some(
    (source) => normalizeUrl(source.url) === normalizedSourceUrl,
  );

  if (!matchesConfiguredSource) {
    const allowedUrls = sources.sources.map((source) => source.url).join(', ');
    throw new Error(
      `Pricing proposals for ${provider} must cite an active official configured pricing source. Allowed sources: ${allowedUrls}`,
    );
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';

  return url.toString().replace(/\/$/, '');
}

interface AdminListMemoriesInput {
  readonly agentId?: string;
  readonly scope?: MemoryScope;
  readonly type?: MemoryType;
  readonly status?: MemoryStatus;
  readonly query?: string;
  readonly limit?: number;
}

interface AdminCreateMemoryInput extends CreateMemoryRequest {
  readonly scope: MemoryScope;
  readonly type: MemoryType;
  readonly lifetime: MemoryLifetime;
}

interface AdminUpdateMemoryInput {
  readonly memoryId: string;
  readonly type?: MemoryType;
  readonly status?: MemoryStatus;
  readonly lifetime?: MemoryLifetime;
  readonly content?: string;
  readonly tags?: readonly string[];
}

interface AdminListLlmCallsInput {
  readonly agentId?: string;
  readonly threadId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly purpose?: LlmCallPurpose;
  readonly status?: LlmCallStatus;
  readonly startedFrom?: string;
  readonly startedTo?: string;
  readonly limit?: number;
}

interface AdminSummarizeCostsInput extends Omit<AdminListLlmCallsInput, 'limit'> {
  readonly groupBy?: CostSummaryGroupBy;
}

interface AdminListModelPricingInput {
  readonly provider?: string;
  readonly model?: string;
  readonly status?: ModelPricingStatus;
}

interface AdminListPricingSourcesInput {
  readonly provider?: string;
  readonly trustLevel?: PricingSourceTrustLevel;
  readonly active?: boolean;
}

interface AdminCreateModelPricingInput extends Omit<
  CreateModelPricingRequest,
  'status' | 'currency'
> {
  readonly currency: string;
}

interface AdminUpdateModelPricingInput {
  readonly pricingId: string;
  readonly status: ModelPricingStatus;
  readonly validUntil?: string;
  readonly notes?: string;
  readonly confirm: true;
}

interface AdminDeletePricingSourceInput {
  readonly sourceId: string;
  readonly confirm: true;
}

interface AdminUpdatePricingSourceInput extends UpdatePricingSourceRequest {
  readonly sourceId: string;
}
