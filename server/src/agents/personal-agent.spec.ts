import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectRunToolCalls,
  createAgentFilesystemBackend,
  createFilesystemPermissions,
  extractSkillUsages,
  summarizeSystemPrompt,
} from './personal-agent';

describe('PersonalAgent filesystem permissions', () => {
  it('always blocks native memory writes while allowing reads for a readable agent', () => {
    expect(createFilesystemPermissions(true)).toEqual([
      {
        operations: ['write'],
        paths: ['/skills', '/skills/**'],
        mode: 'deny',
      },
      {
        operations: ['write'],
        paths: ['/memory', '/memory/**'],
        mode: 'deny',
      },
    ]);
  });

  it('also blocks native memory reads when memory reading is disabled', () => {
    expect(createFilesystemPermissions(false)).toEqual([
      {
        operations: ['write'],
        paths: ['/skills', '/skills/**'],
        mode: 'deny',
      },
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

  it('mounts attached skills while hiding agent-local and unattached paths', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'rdma26-agent-backend-'));
    const deepAgentRoot = join(rootDir, 'deepagent');
    const attachedSkillDir = join(rootDir, 'library', 'attached');
    const emptySkillDir = join(rootDir, 'library', 'empty');
    const memoryDirectories = {
      global: join(rootDir, 'memory', 'global'),
      agentUser: join(rootDir, 'memory', 'agent-user'),
      agent: join(rootDir, 'memory', 'agent'),
    };

    try {
      await Promise.all([
        mkdir(join(deepAgentRoot, 'skills', 'legacy'), { recursive: true }),
        mkdir(attachedSkillDir, { recursive: true }),
        mkdir(emptySkillDir, { recursive: true }),
        ...Object.values(memoryDirectories).map(
          async (path) => await mkdir(path, { recursive: true }),
        ),
      ]);
      await writeFile(
        join(deepAgentRoot, 'skills', 'legacy', 'SKILL.md'),
        'legacy content',
        'utf8',
      );
      await writeFile(join(attachedSkillDir, 'SKILL.md'), 'attached content', 'utf8');
      const backend = createAgentFilesystemBackend(
        deepAgentRoot,
        memoryDirectories,
        emptySkillDir,
        [
          {
            id: 'attached',
            virtualPath: '/skills/attached/',
            directory: attachedSkillDir,
          },
        ],
      );

      await expect(backend.read('/skills/attached/SKILL.md')).resolves.toMatchObject({
        content: 'attached content',
      });
      await expect(backend.read('/skills/legacy/SKILL.md')).resolves.toMatchObject({
        error: expect.any(String),
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
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
          args: { file_path: '/skills/example/SKILL.md', limit: 500 },
        },
        {
          name: 'read_file',
          args: { file_path: '/configuration/soul.md' },
        },
      ]),
    ).toEqual([
      {
        name: 'example',
        path: '/skills/example/SKILL.md',
      },
    ]);
  });
});

describe('summarizeSystemPrompt', () => {
  it('captures the continuity block and stable diagnostics', () => {
    const diagnostics = summarizeSystemPrompt(
      [
        'Agent identity:',
        '- You are Albert.',
        '',
        'Conversation continuity:',
        '- Treat the current thread as a live conversation.',
        '',
        'Interpreter guidance:',
        '- Use eval for deterministic calculations.',
      ].join('\n'),
    );

    expect(diagnostics.characterCount).toBeGreaterThan(0);
    expect(diagnostics.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(diagnostics.includedSections).toEqual([
      'Conversation continuity',
      'Interpreter guidance',
    ]);
    expect(diagnostics.continuityGuidance).toBe(
      'Conversation continuity:\n- Treat the current thread as a live conversation.',
    );
  });
});

async function* asyncValues<T>(values: readonly T[]): AsyncIterable<T> {
  for (const value of values) yield value;
}
