import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { AssistantRuntime } from '../runtime';

const memoryScopeSchema = z.enum(['agent', 'agent_user', 'user']);
const memoryTypeSchema = z.enum([
  'fact',
  'preference',
  'conversation_summary',
  'open_task',
  'tracked_topic',
]);
const memoryLifetimeSchema = z.enum(['permanent', 'active', 'temporary']);

export function createMemoryTools(
  runtime: AssistantRuntime,
  agentId: string,
): readonly StructuredToolInterface[] {
  return [
    tool(
      async ({ content, scope = 'agent', type, lifetime, tags }: SaveMemoryInput) =>
        await runtime.createMemory({
          scope,
          agentId: scope === 'user' ? undefined : agentId,
          type,
          lifetime,
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
          'Save an important long-term memory. Use when the user explicitly asks you to remember something or when future-useful, low-risk context clearly fits the memory rules. Use agent_user for user preferences that apply only to this agent, such as how the user wants this agent to communicate. Use user only when the user clearly wants the memory shared across agents. Sensitive personal data may be saved only when the user explicitly asks for it. Never save secrets, credentials, raw long conversations, or temporary chat noise.',
        schema: z.object({
          scope: memoryScopeSchema
            .default('agent')
            .describe(
              'Memory scope: agent for this agent, agent_user for user information or interaction preferences only relevant to this agent, user for global user information explicitly useful to all agents.',
            ),
          content: z.string().trim().min(1).describe('Concise memory content to save.'),
          type: memoryTypeSchema.describe('Memory type.'),
          lifetime: memoryLifetimeSchema
            .default('active')
            .describe('How durable this memory should be.'),
          tags: z.array(z.string().trim().min(1)).default([]).describe('Short optional tags.'),
        }),
      },
    ),
  ];
}

interface SaveMemoryInput {
  readonly scope?: 'agent' | 'agent_user' | 'user';
  readonly content: string;
  readonly type: 'fact' | 'preference' | 'conversation_summary' | 'open_task' | 'tracked_topic';
  readonly lifetime: 'permanent' | 'active' | 'temporary';
  readonly tags: readonly string[];
}
