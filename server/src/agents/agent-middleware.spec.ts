import { describe, expect, it } from 'vitest';

import { createEnabledAgentMiddleware } from './agent-middleware';

describe('agent middleware', () => {
  it('adds the interpreter only when its capability is enabled', async () => {
    await expect(createEnabledAgentMiddleware([])).resolves.toEqual([]);
    await expect(createEnabledAgentMiddleware(['interpreter'])).resolves.toHaveLength(1);
  });
});
