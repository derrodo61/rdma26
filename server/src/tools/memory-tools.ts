import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { AssistantRuntime } from '../runtime';

export function createMemoryTools(
  runtime: AssistantRuntime,
  agentId: string,
): readonly StructuredToolInterface[] {
  return [
    tool(
      async ({ content, type, lifetime, tags }: SaveMemoryInput) =>
        await runtime.createMemory({
          scope: 'agent',
          agentId,
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
          'Save an important long-term memory for this agent. Use for explicit remember requests or clearly useful, low-risk future context. Do not save secrets, credentials, sensitive data, raw long conversations, or temporary chat noise.',
        schema: z.object({
          content: z.string().trim().min(1).describe('Concise memory content to save.'),
          type: z
            .enum(['fact', 'preference', 'conversation_summary', 'open_task', 'tracked_topic'])
            .describe('Memory type.'),
          lifetime: z
            .enum(['permanent', 'active', 'temporary'])
            .default('active')
            .describe('How durable this memory should be.'),
          tags: z.array(z.string().trim().min(1)).default([]).describe('Short optional tags.'),
        }),
      },
    ),
  ];
}

interface SaveMemoryInput {
  readonly content: string;
  readonly type: 'fact' | 'preference' | 'conversation_summary' | 'open_task' | 'tracked_topic';
  readonly lifetime: 'permanent' | 'active' | 'temporary';
  readonly tags: readonly string[];
}
