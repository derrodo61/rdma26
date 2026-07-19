import { describe, expect, it } from 'vitest';

import {
  CapabilityRegistry,
  interpreterCapabilityId,
  webPageAccessCapabilityId,
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

  it('groups both page readers under one web page access capability', () => {
    const registry = new CapabilityRegistry();

    expect(registry.listDefinitions()).toContainEqual(
      expect.objectContaining({
        id: webPageAccessCapabilityId,
        label: 'Web page access',
        provider: 'web',
        available: true,
        providedTools: [
          expect.objectContaining({ id: 'read_web_page' }),
          expect.objectContaining({ id: 'read_web_page_structure' }),
        ],
      }),
    );
    expect(registry.createRunnableTools([webPageAccessCapabilityId])).toHaveLength(2);
  });
});
