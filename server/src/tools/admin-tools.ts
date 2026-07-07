import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { ToolDefinition } from '../../../shared/agent-contracts';
import type { AssistantRuntime } from '../runtime';

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
  ];
}
