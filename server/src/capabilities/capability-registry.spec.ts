import { describe, expect, it } from 'vitest';

import {
  CapabilityRegistry,
  interpreterCapabilityId,
  webSearchCapabilityId,
} from './capability-registry';

describe('CapabilityRegistry', () => {
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

  it('registers OpenAI hosted search as a provider tool rather than a local tool', () => {
    const registry = new CapabilityRegistry();

    expect(registry.validateCapabilityIds([webSearchCapabilityId])).toEqual([
      webSearchCapabilityId,
    ]);
    expect(registry.createRunnableTools([webSearchCapabilityId])).toEqual([]);
    expect(registry.listDefinitions()).toContainEqual(
      expect.objectContaining({
        id: webSearchCapabilityId,
        label: 'Web search',
        provider: 'openai',
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
