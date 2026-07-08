import { describe, expect, it } from 'vitest';

import { CapabilityRegistry, researchCapabilityId } from './capability-registry';

describe('CapabilityRegistry', () => {
  it('validates research as configurable but does not instantiate it as a normal tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.validateCapabilityIds([researchCapabilityId])).toEqual([researchCapabilityId]);
    expect(registry.createRunnableTools([researchCapabilityId])).toEqual([]);
  });
});
