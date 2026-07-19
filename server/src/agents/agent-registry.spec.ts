import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { AgentRegistry } from './agent-registry';

describe('AgentRegistry', () => {
  it('stores agent visibility metadata for operator, chat, and internal agents', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-agents-'));
    const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty');

    await registry.ensureReady();
    const operator = await registry.readAgent('scotty');
    const chatAgent = await registry.createAgent({
      id: 'ronaldo',
      name: 'Ronaldo',
    });
    const internalAgent = await registry.createAgent({
      id: 'research',
      name: 'Research Agent',
      kind: 'internal',
      chatEnabled: false,
    });

    expect(operator).toMatchObject({
      id: 'scotty',
      kind: 'operator',
      chatEnabled: true,
    });
    expect(chatAgent).toMatchObject({
      id: 'ronaldo',
      kind: 'chat',
      chatEnabled: true,
    });
    expect(internalAgent).toMatchObject({
      id: 'research',
      kind: 'internal',
      chatEnabled: false,
    });
  });

  it('migrates legacy tool grants to capability grants', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-agents-'));
    const registry = new AgentRegistry(dataDir, 'scotty', 'Scotty');

    await registry.ensureReady();
    await registry.createAgent({ id: 'ronaldo', name: 'Ronaldo' });
    const profilePath = join(dataDir, 'agents', 'ronaldo', 'agent.json');
    const legacyProfile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<
      string,
      unknown
    >;
    delete legacyProfile['enabledCapabilities'];
    legacyProfile['enabledTools'] = ['read_web_page', 'read_web_page_structure', 'web_search'];
    await writeFile(profilePath, `${JSON.stringify(legacyProfile, null, 2)}\n`, 'utf8');

    await expect(registry.readAgent('ronaldo')).resolves.toMatchObject({
      enabledCapabilities: ['web_page_access', 'web_search'],
    });
    const migratedProfile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(migratedProfile['enabledCapabilities']).toEqual(['web_page_access', 'web_search']);
    expect(migratedProfile).not.toHaveProperty('enabledTools');
  });
});
