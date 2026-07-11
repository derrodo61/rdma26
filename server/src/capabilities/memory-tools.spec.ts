import { describe, expect, it, vi } from 'vitest';

import type { AssistantRuntime } from '../runtime';
import { createMemoryTools } from './memory-tools';

describe('memory tools', () => {
  it('can save explicitly requested global user memory', async () => {
    const createMemory = vi.fn(async (request: unknown) => request);
    const [saveMemory] = createMemoryTools(
      {
        createMemory,
      } as unknown as AssistantRuntime,
      'ronaldo',
    );

    const result = await saveMemory.invoke({
      scope: 'user',
      pinned: false,
      content: "The user's address is Seeblick 4, 28870 Ottersberg, Germany.",
      tags: ['address'],
    });

    expect(createMemory).toHaveBeenCalledWith({
      scope: 'user',
      agentId: undefined,
      pinned: false,
      content: "The user's address is Seeblick 4, 28870 Ottersberg, Germany.",
      tags: ['address'],
      source: {
        agentId: 'ronaldo',
        note: 'Saved by agent during chat run.',
      },
    });
    expect(result).toMatchObject({
      scope: 'user',
      agentId: undefined,
    });
  });

  it('can save per-agent user interaction preferences', async () => {
    const createMemory = vi.fn(async (request: unknown) => request);
    const [saveMemory] = createMemoryTools(
      {
        createMemory,
      } as unknown as AssistantRuntime,
      'ronaldo',
    );

    await saveMemory.invoke({
      scope: 'agent_user',
      pinned: true,
      content: 'The user prefers to communicate with Ronaldo in German.',
      tags: ['language', 'preference'],
    });

    expect(createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'agent_user',
        agentId: 'ronaldo',
        pinned: true,
      }),
    );
  });
});
