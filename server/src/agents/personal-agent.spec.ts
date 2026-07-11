import { describe, expect, it } from 'vitest';

import { createMemoryFilesystemPermissions } from './personal-agent';

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
