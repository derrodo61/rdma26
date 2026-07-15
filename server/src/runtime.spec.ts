import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { AssistantRuntime } from './runtime';

describe('AssistantRuntime run cancellation', () => {
  const originalApiKey = process.env['OPENAI_API_KEY'];

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = originalApiKey;
    }
  });

  it('does not append messages when a run is cancelled before it starts', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-runtime-cancel-'));
    delete process.env['OPENAI_API_KEY'];
    const runtime = new AssistantRuntime({
      dataDir,
      defaultAgentId: 'scotty',
      defaultAgentName: 'Scotty',
    });

    try {
      await runtime.ensureReady();
      const thread = await runtime.createThread('scotty');
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        runtime.runAgent(
          {
            agentId: 'scotty',
            threadId: thread.id,
            prompt: 'Hello',
          },
          {
            signal: abortController.signal,
          },
        ),
      ).rejects.toThrow('cancelled');

      await expect(runtime.readThread('scotty', thread.id)).resolves.toMatchObject({
        messages: [],
      });
    } finally {
      runtime.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
