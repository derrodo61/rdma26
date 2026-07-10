import { describe, expect, it } from 'vitest';

import { CapabilityRegistry, researchCapabilityId } from './capability-registry';

describe('CapabilityRegistry', () => {
  it('validates research as configurable but does not instantiate it as a normal tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.validateCapabilityIds([researchCapabilityId])).toEqual([researchCapabilityId]);
    expect(registry.createRunnableTools([researchCapabilityId])).toEqual([]);
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

  it('normalizes the legacy extract_web_content id to read_web_page_structure', () => {
    const registry = new CapabilityRegistry();

    expect(registry.validateCapabilityIds(['extract_web_content'])).toEqual([
      'read_web_page_structure',
    ]);
    expect(registry.createRunnableTools(['extract_web_content']).map((tool) => tool.name)).toEqual([
      'read_web_page_structure',
    ]);
  });
});
