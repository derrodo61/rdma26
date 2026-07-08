import { mkdtemp } from 'node:fs/promises';
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
});
