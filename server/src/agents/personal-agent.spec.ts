import { describe, expect, it } from 'vitest';

import { collectRunToolCalls, createMemoryFilesystemPermissions } from './personal-agent';

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
          input: { subagent_type: 'researcher' },
          output: Promise.resolve('research complete'),
        },
      ]),
      subagents: asyncValues([
        {
          name: 'researcher',
          toolCalls: asyncValues([
            {
              callId: 'search-call',
              name: 'research_web_search',
              input: { query: 'latest result' },
              output: Promise.resolve({ results: [{ url: 'https://example.com/result' }] }),
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
        args: { subagent_type: 'researcher' },
        result: 'research complete',
      },
      {
        id: 'search-call',
        name: 'research_web_search',
        agentName: 'researcher',
        args: { query: 'latest result' },
        result: '{"results":[{"url":"https://example.com/result"}]}',
      },
    ]);
  });
});

async function* asyncValues<T>(values: readonly T[]): AsyncIterable<T> {
  for (const value of values) yield value;
}
