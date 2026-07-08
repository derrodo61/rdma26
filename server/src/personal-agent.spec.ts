import { describe, expect, it } from 'vitest';

import { createBootloaderPromptForTest } from './personal-agent';

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
      [],
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
      [],
      false,
    );

    expect(enabledPrompt).toContain('Use the save_memory tool');
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
      [],
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
      [],
      true,
      ['internet_search'],
    );

    expect(withoutSearch).not.toContain('Internet search guidance');
    expect(withSearch).toContain('Internet search guidance');
    expect(withSearch).toContain('qualityHints.likelyNeedsFollowUp');
    expect(withSearch).toContain('latest completed');
    expect(withSearch).toContain('run a narrower follow-up search before answering');
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
      [],
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
      [],
      true,
      ['internet_search', 'read_web_page'],
    );

    expect(withoutReader).not.toContain('Web page reading guidance');
    expect(withReader).toContain('Web page reading guidance');
    expect(withReader).toContain('read one or more promising source pages');
    expect(withReader).toContain('official sources, reputable news/reporting');
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
