import { describe, expect, it, vi } from 'vitest';

import {
  CapabilityRegistry,
  interpreterCapabilityId,
  skillAcquisitionCapabilityId,
  skillAuthoringCapabilityId,
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

  it('registers proposal-only skill capabilities and enforces discovery before authoring', async () => {
    const runtime = {
      listSkills: vi.fn(async () => ({ skills: [] })),
      readSkill: vi.fn(),
      listSkillProposals: vi.fn(async () => ({ proposals: [] })),
      readSkillProposal: vi.fn(),
      searchSkillCatalog: vi.fn(async () => ({ results: [] })),
      inspectSkillInstallation: vi.fn(),
      proposeSkillCreate: vi.fn(async () => ({ id: 'proposal' })),
      proposeSkillUpdate: vi.fn(),
      proposeSkillInstall: vi.fn(),
    };
    const registry = new CapabilityRegistry(runtime);
    expect(registry.listDefinitions()).toContainEqual(
      expect.objectContaining({
        id: skillAcquisitionCapabilityId,
        available: true,
        providedTools: expect.arrayContaining([
          expect.objectContaining({ id: 'compare_skill_candidates' }),
        ]),
      }),
    );
    const tools = registry.createRunnableTools(
      [skillAuthoringCapabilityId, skillAcquisitionCapabilityId],
      { agentId: 'albert', threadId: 'thread-1' },
    );
    const propose = tools.find((candidate) => candidate.name === 'propose_skill_create');
    const searchInstalled = tools.find((candidate) => candidate.name === 'search_installed_skills');
    const searchCatalog = tools.find((candidate) => candidate.name === 'search_skill_catalogs');
    const input = {
      skillId: 'test-skill',
      skillMarkdown: '---\nname: test-skill\ndescription: Test.\n---\n',
    };

    await expect(propose?.invoke(input)).rejects.toThrow('Search both installed skills');
    await searchInstalled?.invoke({});
    await searchCatalog?.invoke({ query: 'test' });
    await expect(propose?.invoke(input)).resolves.toBeTruthy();
    expect(runtime.proposeSkillCreate).toHaveBeenCalledWith(input, {
      agentId: 'albert',
      threadId: 'thread-1',
    });
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
