import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ThreadCheckpointer } from './thread-checkpointer';

const CounterState = Annotation.Root({
  count: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
});

function createCounterGraph(checkpointer: ThreadCheckpointer) {
  return new StateGraph(CounterState)
    .addNode('retain', () => ({}))
    .addEdge(START, 'retain')
    .addEdge('retain', END)
    .compile({ checkpointer: checkpointer.get() });
}

describe('ThreadCheckpointer', () => {
  it('persists thread state across checkpointer instances and deletes it with the thread', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-checkpoints-'));
    const config = { configurable: { thread_id: 'persistent-thread' } };

    try {
      const first = new ThreadCheckpointer(dataDir);
      await first.ensureReady();
      const firstGraph = createCounterGraph(first);

      await expect(firstGraph.invoke({ count: 1 }, config)).resolves.toMatchObject({ count: 1 });
      expect(await first.hasThread('persistent-thread')).toBe(true);
      first.close();

      const second = new ThreadCheckpointer(dataDir);
      await second.ensureReady();
      const secondGraph = createCounterGraph(second);

      await expect(secondGraph.invoke({ count: 2 }, config)).resolves.toMatchObject({ count: 3 });
      await second.deleteThread('persistent-thread');
      expect(await second.hasThread('persistent-thread')).toBe(false);
      second.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
