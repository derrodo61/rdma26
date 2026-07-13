import { describe, expect, it } from 'vitest';

import { ToolCallObserver } from './tool-call-observer';

describe('ToolCallObserver', () => {
  it('records a skill file read with its input and result', () => {
    const observer = new ToolCallObserver();

    observer.handleToolStart(
      { id: ['deepagents', 'read_file'], lc: 1, type: 'not_implemented' },
      '{"file_path":"/skills/web-research/SKILL.md"}',
      'run-1',
      undefined,
      undefined,
      undefined,
      'read_file',
      'call-1',
    );
    observer.handleToolEnd('# Web research', 'run-1');

    expect(observer.collected()).toEqual([
      {
        id: 'call-1',
        name: 'read_file',
        args: { file_path: '/skills/web-research/SKILL.md' },
        result: '# Web research',
      },
    ]);
  });
});
