import { describe, expect, it } from 'vitest';

import { createBootloaderPromptForTest } from './agent-prompt';

describe('PersonalAgent bootloader prompt', () => {
  it('adds shared conversation continuity guidance', () => {
    const prompt = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      true,
    );

    expect(prompt).toContain('Conversation continuity');
    expect(prompt).toContain('live conversation, not a sequence of independent Q&A items');
    expect(prompt).toContain('infer the topic from the immediately preceding exchange');
    expect(prompt).toContain("Prefer answering the new part of the user's question first");
    expect(prompt).toContain('Do not begin a follow-up answer by restating');
    expect(prompt).toContain('do not repeat an already-stated headline result at all');
    expect(prompt).toContain('dieses Spiel');
    expect(prompt).toContain('already-stated headline result, date, score, winner');
    expect(prompt).toContain('follow-up questions asking for explanation, story, analysis');
    expect(prompt).toContain('Genau zu diesem 6:4');
  });

  it('describes save_memory only when memory writes are enabled', () => {
    const enabledPrompt = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      true,
    );
    const disabledPrompt = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      false,
    );

    expect(enabledPrompt).toContain('Use the save_memory tool');
    expect(enabledPrompt).toContain('dauerhaft');
    expect(enabledPrompt).toContain('pinned=false');
    expect(enabledPrompt).toContain('search_unpinned_memory');
    expect(enabledPrompt).toContain('never call a memory-search tool for pinned information');
    expect(enabledPrompt).toContain('Use agent_user for user preferences');
    expect(enabledPrompt).toContain('Use user only when the user clearly wants the memory shared');
    expect(enabledPrompt).toContain(
      'If the user explicitly asks you to remember sensitive personal data',
    );
    expect(enabledPrompt).toContain('never save secrets or credentials');
    expect(enabledPrompt).toMatch(
      /Current local calendar date \(authoritative for "today"\): \d{4}-\d{2}-\d{2}/,
    );
    expect(disabledPrompt).toContain('Memory writing is disabled for this agent');
    expect(disabledPrompt).not.toContain('Use the save_memory tool');
  });

  it('adds concise web-search guidance only when web_search is enabled', () => {
    const withoutSearch = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      true,
      [],
    );
    const withSearch = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      true,
      ['web_search'],
    );

    expect(withoutSearch).not.toContain('Web search guidance');
    expect(withSearch).toContain('Web search guidance');
    expect(withSearch).toContain('OpenAI hosted web search is available');
    expect(withSearch).toContain('Preserve hosted search citations');
    expect(withSearch).not.toContain('web-research/SKILL.md');
  });

  it('adds web page reading guidance only when read_web_page is enabled', () => {
    const withoutReader = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      true,
      ['web_search'],
    );
    const withReader = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      true,
      ['web_search', 'read_web_page'],
    );

    expect(withoutReader).not.toContain('Web page reading guidance');
    expect(withReader).toContain('Web page reading guidance');
    expect(withReader).toContain('when a public URL is already known');
    expect(withReader).toContain('beyond what hosted search provides');
  });

  it('describes the interpreter boundary only when enabled', () => {
    const withoutInterpreter = createBootloaderPromptForTest(
      { name: 'Agent', soulVirtualPath: '/configuration/soul.md' },
      testProfile(),
      false,
      '# soul',
      true,
      [],
    );
    const withInterpreter = createBootloaderPromptForTest(
      { name: 'Agent', soulVirtualPath: '/configuration/soul.md' },
      testProfile(),
      false,
      '# soul',
      true,
      ['interpreter'],
    );

    expect(withoutInterpreter).not.toContain('Interpreter guidance');
    expect(withInterpreter).toContain('Interpreter guidance');
    expect(withInterpreter).toContain('isolated JavaScript interpreter');
    expect(withInterpreter).toContain('sorting, filtering, grouping');
    expect(withInterpreter).toContain('multiple rows, grouping, sorting');
    expect(withInterpreter).toContain('Do not solve these tasks by mental arithmetic');
    expect(withInterpreter).toContain('no host filesystem, network, shell');
  });
});

function testProfile() {
  return {
    name: '',
    timeZone: 'Europe/Berlin',
    language: 'en',
    locale: 'en-US',
    dateStyle: 'medium' as const,
    timeStyle: 'short' as const,
    theme: 'system' as const,
    agentSettings: {},
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  };
}
