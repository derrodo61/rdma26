import type { CreateDeepAgentParams } from 'deepagents';

import { interpreterCapabilityId } from '../capabilities/capability-registry';

export async function createEnabledAgentMiddleware(
  enabledCapabilityIds: readonly string[],
): Promise<CreateDeepAgentParams['middleware']> {
  if (!enabledCapabilityIds.includes(interpreterCapabilityId)) {
    return [];
  }

  const { createCodeInterpreterMiddleware } = await import('@langchain/quickjs');

  const middleware = [
    createCodeInterpreterMiddleware({
      executionTimeoutMs: 5_000,
      maxResultChars: 4_000,
      memoryLimitBytes: 64 * 1024 * 1024,
      maxStackSizeBytes: 320 * 1024,
      ptc: [],
      subagents: true,
    }),
  ];

  // quickjs 0.6 and deepagents 1.10 expose incompatible generic tool constraints
  // even though both share the same LangChain runtime tool implementation.
  return middleware as unknown as CreateDeepAgentParams['middleware'];
}
