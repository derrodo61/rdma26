import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { AssistantRuntime } from '../runtime';

export function createConversationTools(
  runtime: AssistantRuntime,
  agentId: string,
  currentThreadId: string,
): readonly StructuredToolInterface[] {
  return [
    tool(
      async ({ query, limit }) =>
        await runtime.searchPastConversations(agentId, query, limit, currentThreadId),
      {
        name: 'search_past_conversations',
        description:
          "Search this agent's earlier conversation threads by meaningful words in titles and messages. Requests for the previous or last thread prioritize the newest prior thread. Returns bounded excerpts and thread ids. Use only when earlier conversation history is relevant.",
        schema: z.object({
          query: z.string().trim().min(2).describe('Words to search for in earlier conversations.'),
          limit: z.number().int().min(1).max(10).default(5),
        }),
      },
    ),
    tool(
      async ({ threadId, messageLimit }) =>
        await runtime.readPastConversation(agentId, threadId, messageLimit, currentThreadId),
      {
        name: 'read_past_conversation',
        description:
          'Read a bounded number of messages from one earlier conversation returned by search_past_conversations.',
        schema: z.object({
          threadId: z.string().uuid(),
          messageLimit: z.number().int().min(1).max(50).default(20),
        }),
      },
    ),
  ];
}
