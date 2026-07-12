import { describe, expect, it } from 'vitest';

import { createBootloaderPromptForTest } from './agent-prompt';

describe('PersonalAgent bootloader prompt', () => {
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
    expect(disabledPrompt).toContain('Memory writing is disabled for this agent');
    expect(disabledPrompt).not.toContain('Use the save_memory tool');
  });

  it('adds internet search guidance only when internet_search is enabled', () => {
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
      ['internet_search'],
    );

    expect(withoutSearch).not.toContain('Internet search guidance');
    expect(withSearch).toContain('Internet search guidance');
    expect(withSearch).toContain('qualityHints.likelyNeedsFollowUp');
    expect(withSearch).toContain('latest completed');
    expect(withSearch).toContain('run a narrower follow-up search before answering');
    expect(withSearch).toContain('For precise current-list questions');
    expect(withSearch).toContain('verify each item separately before answering');
    expect(withSearch).toContain('run a targeted follow-up search for that exact item');
    expect(withSearch).toContain('do not answer from search snippets alone');
    expect(withSearch).toContain('do not add meta commentary about search quality');
    expect(withSearch).toContain('scheduled or upcoming event');
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
      ['internet_search'],
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
      ['internet_search', 'read_web_page'],
    );

    expect(withoutReader).not.toContain('Web page reading guidance');
    expect(withReader).toContain('Web page reading guidance');
    expect(withReader).toContain('read one or more promising source pages');
    expect(withReader).toContain('official sources, reputable news/reporting');
    expect(withReader).toContain(
      'read the best available source page for each requested item before finalizing the answer',
    );
    expect(withReader).toContain(
      'continue searching or reading until the remaining items are confirmed',
    );
  });

  it('prefers research over low-level internet tools when enabled', () => {
    const prompt = createBootloaderPromptForTest(
      {
        name: 'Agent',
        soulVirtualPath: '/configuration/soul.md',
      },
      testProfile(),
      false,
      '# soul',
      true,
      ['research', 'internet_search', 'read_web_page'],
    );

    expect(prompt).toContain('Research guidance');
    expect(prompt).toContain('A researcher subagent is available through Deep Agents');
    expect(prompt).toContain('Use the task tool to delegate internet research');
    expect(prompt).toContain("Use the researcher's structured result as your evidence");
    expect(prompt).toContain("check the researcher's temporalCandidates");
    expect(prompt).toContain("preserve the researcher's claimStatus");
    expect(prompt).toContain('Do not convert official-source silence into "false"');
    expect(prompt).toContain('Do not manually start with internet_search or read_web_page');
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
