import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type {
  CreateMemoryRequest,
  MemoryLifetime,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  ToolDefinition,
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
    label: 'Set memory writes',
    description: 'Enable or disable memory writes for an agent.',
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
];

export function listAdminToolDefinitions(): readonly ToolDefinition[] {
  return adminToolDefinitions;
}

export function createAdminTools(runtime: AssistantRuntime): readonly StructuredToolInterface[] {
  return [
    tool(async () => await runtime.agentsResponse(), {
      name: 'admin_list_agents',
      description: 'List all configured agents. Only available to the protected operator agent.',
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
      async ({ agentId, canWrite }: { agentId: string; canWrite: boolean }) =>
        await runtime.updateAgent(agentId, {
          memory: {
            canWrite,
          },
        }),
      {
        name: 'admin_set_agent_memory_writes',
        description: 'Enable or disable memory writes for an agent.',
        schema: z.object({
          agentId: z.string().trim().min(1).describe('Agent id to update.'),
          canWrite: z.boolean().describe('Whether the agent may write memories.'),
        }),
      },
    ),
    tool(async ({ agentId }: { agentId: string }) => await runtime.deleteAgent(agentId), {
      name: 'admin_delete_agent',
      description:
        'Delete an agent and all related data. The protected operator agent cannot be deleted.',
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
  ];
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
