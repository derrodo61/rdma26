import { describe, expect, it } from 'vitest';

import { CapabilityRegistry, researchCapabilityId } from './capability-registry';

describe('CapabilityRegistry', () => {
  it('validates research as configurable but does not instantiate it as a normal tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.validateCapabilityIds([researchCapabilityId])).toEqual([researchCapabilityId]);
    expect(registry.createRunnableTools([researchCapabilityId])).toEqual([]);
  });

  it('lists the generic web content extractor as an assignable tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.listDefinitions()).toContainEqual(
      expect.objectContaining({
        id: 'extract_web_content',
        label: 'Extract web content',
        provider: 'web',
        available: true,
      }),
    );
  });
});
