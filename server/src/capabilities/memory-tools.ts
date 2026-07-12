import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { AssistantRuntime } from '../runtime';
import type { EmbeddingAccountingContext } from '../llm/openai-embedding-client';

const memoryScopeSchema = z.enum(['agent', 'agent_user', 'user']);

export function createMemoryReadTools(
  runtime: AssistantRuntime,
  agentId: string,
  context: Pick<EmbeddingAccountingContext, 'runId' | 'threadId'> = {},
): readonly StructuredToolInterface[] {
  return [
    tool(
      async ({ query, limit }) =>
        await runtime.listMemories(
          { agentId, pinned: false, query, limit },
          { ...context, agentId },
        ),
      {
        name: 'search_unpinned_memory',
        description:
          "Search only this agent's applicable unpinned long-term memory. Pinned memory is already loaded in startup context and cannot be returned by this tool. Call it only when the needed information is not already present, and before saying an unpinned remembered value is unavailable.",
        schema: z.object({
          query: z.string().trim().min(2).describe('Short meaningful words to find in memory.'),
          limit: z.number().int().min(1).max(10).default(5),
        }),
      },
    ),
  ];
}
export function createMemoryTools(
  runtime: AssistantRuntime,
  agentId: string,
): readonly StructuredToolInterface[] {
  return [
    tool(
      async ({ content, scope = 'agent', pinned, tags }: SaveMemoryInput) =>
        await runtime.createMemory({
          scope,
          agentId: scope === 'user' ? undefined : agentId,
          pinned,
          content,
          tags,
          source: {
            agentId,
            note: 'Saved by agent during chat run.',
          },
        }),
      {
        name: 'save_memory',
        description:
          'Save an important durable long-term memory. Durable means it remains saved until deleted; it does not mean pinned. Requests to remember something permanently or dauerhaft must remain unpinned. Pin only when the user explicitly asks for this information to be loaded into every conversation or explicitly uses the word pin or pinned. Automatically inferred memories must remain unpinned. Use agent_user for user preferences that apply only to this agent, such as how the user wants this agent to communicate. Use user only when the user clearly wants the memory shared across agents. Sensitive personal data may be saved only when the user explicitly asks for it. Never save secrets, credentials, raw long conversations, or temporary chat noise.',
        schema: z.object({
          scope: memoryScopeSchema
            .default('agent')
            .describe(
              'Memory scope: agent for this agent, agent_user for user information or interaction preferences only relevant to this agent, user for global user information explicitly useful to all agents.',
            ),
          content: z.string().trim().min(1).describe('Concise memory content to save.'),
          pinned: z
            .boolean()
            .default(false)
            .describe(
              'Load this memory into every applicable run. Keep false for ordinary durable or permanent memory. Set true only when the user explicitly requests loading it in every conversation or explicitly says to pin it.',
            ),
          tags: z.array(z.string().trim().min(1)).default([]).describe('Short optional tags.'),
        }),
      },
    ),
  ];
}

interface SaveMemoryInput {
  readonly scope?: 'agent' | 'agent_user' | 'user';
  readonly content: string;
  readonly pinned: boolean;
  readonly tags: readonly string[];
}
