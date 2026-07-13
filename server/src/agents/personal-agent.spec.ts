import { describe, expect, it } from 'vitest';

import {
  collectRunToolCalls,
  createMemoryFilesystemPermissions,
  extractSkillUsages,
} from './personal-agent';

describe('PersonalAgent memory filesystem permissions', () => {
  it('always blocks native memory writes while allowing reads for a readable agent', () => {
    expect(createMemoryFilesystemPermissions(true)).toEqual([
      {
        operations: ['write'],
        paths: ['/memory', '/memory/**'],
        mode: 'deny',
      },
    ]);
  });

  it('also blocks native memory reads when memory reading is disabled', () => {
    expect(createMemoryFilesystemPermissions(false)).toEqual([
      {
        operations: ['write'],
        paths: ['/memory', '/memory/**'],
        mode: 'deny',
      },
      {
        operations: ['read'],
        paths: ['/memory', '/memory/**'],
        mode: 'deny',
      },
    ]);
  });
});

describe('collectRunToolCalls', () => {
  it('collects parent and nested subagent tool evidence', async () => {
    const calls = await collectRunToolCalls({
      toolCalls: asyncValues([
        {
          callId: 'parent-call',
          name: 'task',
          input: { subagent_type: 'calculator' },
          output: Promise.resolve('calculation complete'),
        },
      ]),
      subagents: asyncValues([
        {
          name: 'calculator',
          toolCalls: asyncValues([
            {
              callId: 'search-call',
              name: 'eval',
              input: { code: '2 + 2' },
              output: Promise.resolve({ result: 4 }),
            },
          ]),
          subagents: asyncValues([]),
        },
      ]),
    });

    expect(calls).toEqual([
      {
        id: 'parent-call',
        name: 'task',
        agentName: undefined,
        args: { subagent_type: 'calculator' },
        result: 'calculation complete',
      },
      {
        id: 'search-call',
        name: 'eval',
        agentName: 'calculator',
        args: { code: '2 + 2' },
        result: '{"result":4}',
      },
    ]);
  });
});

describe('extractSkillUsages', () => {
  it('recognizes progressively loaded SKILL.md files', () => {
    expect(
      extractSkillUsages([
        {
          name: 'read_file',
          args: { file_path: '/skills/web-research/SKILL.md', limit: 500 },
        },
        {
          name: 'read_file',
          args: { file_path: '/configuration/soul.md' },
        },
      ]),
    ).toEqual([
      {
        name: 'web-research',
        path: '/skills/web-research/SKILL.md',
      },
    ]);
  });
});

async function* asyncValues<T>(values: readonly T[]): AsyncIterable<T> {
  for (const value of values) yield value;
}
