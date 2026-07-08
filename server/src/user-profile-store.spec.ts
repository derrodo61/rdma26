import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { UserProfileStore } from './user-profile-store';

describe('UserProfileStore', () => {
  it('creates profiles without a last used agent by default', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-profile-'));

    try {
      const store = new UserProfileStore(dataDir);
      const profile = await store.readProfile();

      expect(profile.lastAgentId).toBeUndefined();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('stores the last used agent in the profile', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-profile-'));

    try {
      const store = new UserProfileStore(dataDir);
      await store.updateProfile({
        lastAgentId: 'ronaldo',
      });

      await expect(store.readProfile()).resolves.toMatchObject({
        lastAgentId: 'ronaldo',
      });

      const raw = JSON.parse(await readFile(join(dataDir, 'user-profile.json'), 'utf8')) as {
        lastAgentId?: unknown;
      };

      expect(raw.lastAgentId).toBe('ronaldo');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('parses older profiles without a last used agent', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-profile-'));

    try {
      await writeFile(
        join(dataDir, 'user-profile.json'),
        JSON.stringify({
          name: '',
          timeZone: 'Europe/Berlin',
          language: 'de',
          locale: 'de-DE',
          dateStyle: 'medium',
          timeStyle: 'short',
          theme: 'dark',
          agentSettings: {},
          createdAt: '2026-07-08T00:00:00.000Z',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }),
        'utf8',
      );

      const store = new UserProfileStore(dataDir);
      const profile = await store.readProfile();

      expect(profile.lastAgentId).toBeUndefined();
      expect(profile.theme).toBe('dark');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
