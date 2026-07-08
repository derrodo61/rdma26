import { describe, expect, it } from 'vitest';

import { researchToolId, ToolRegistry } from './tools/tool-registry';

describe('ToolRegistry', () => {
  it('validates research as configurable but does not instantiate it as a normal tool', () => {
    const registry = new ToolRegistry();

    expect(registry.validateToolIds([researchToolId])).toEqual([researchToolId]);
    expect(registry.createTools([researchToolId])).toEqual([]);
  });
});
