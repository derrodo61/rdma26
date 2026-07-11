import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class ThreadCheckpointer {
  private saver: SqliteSaver | null = null;

  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.get().getTuple({
      configurable: {
        thread_id: '__rdma26_setup__',
      },
    });
  }

  get(): SqliteSaver {
    if (!this.saver) {
      this.saver = SqliteSaver.fromConnString(join(this.dataDir, 'langgraph-checkpoints.sqlite'));
    }

    return this.saver;
  }

  async hasThread(threadId: string): Promise<boolean> {
    return Boolean(
      await this.get().getTuple({
        configurable: {
          thread_id: threadId,
        },
      }),
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    if (await this.hasThread(threadId)) {
      await this.get().deleteThread(threadId);
    }
  }

  close(): void {
    this.saver?.db.close();
    this.saver = null;
  }
}
