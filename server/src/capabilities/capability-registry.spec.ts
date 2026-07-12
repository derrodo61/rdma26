import { describe, expect, it } from 'vitest';

import {
  CapabilityRegistry,
  interpreterCapabilityId,
  researchCapabilityId,
} from './capability-registry';

describe('CapabilityRegistry', () => {
  it('validates research as configurable but does not instantiate it as a normal tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.validateCapabilityIds([researchCapabilityId])).toEqual([researchCapabilityId]);
    expect(registry.createRunnableTools([researchCapabilityId])).toEqual([]);
  });

  it('registers the interpreter as configurable middleware rather than a normal tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.validateCapabilityIds([interpreterCapabilityId])).toEqual([
      interpreterCapabilityId,
    ]);
    expect(registry.createRunnableTools([interpreterCapabilityId])).toEqual([]);
    expect(registry.listDefinitions()).toContainEqual(
      expect.objectContaining({
        id: interpreterCapabilityId,
        label: 'Code interpreter',
        provider: 'deepagents-quickjs',
        available: true,
      }),
    );
  });

  it('lists the page-structure reader as an assignable tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.listDefinitions()).toContainEqual(
      expect.objectContaining({
        id: 'read_web_page_structure',
        label: 'Read web page structure',
        provider: 'web',
        available: true,
      }),
    );
  });
});
