import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RunContextDetails } from '../../shared/agent-contracts';

export class RunContextStore {
  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.runsDir(), { recursive: true });
  }

  async writeRunContext(context: RunContextDetails): Promise<RunContextDetails> {
    await this.ensureReady();
    await writeFile(this.runPath(context.runId), `${JSON.stringify(context, null, 2)}\n`, 'utf8');

    return context;
  }

  async readRunContext(runId: string): Promise<RunContextDetails | null> {
    validateRunId(runId);

    try {
      return JSON.parse(await readFile(this.runPath(runId), 'utf8')) as RunContextDetails;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async requireRunContext(runId: string): Promise<RunContextDetails> {
    const context = await this.readRunContext(runId);

    if (!context) {
      throw new Error(`Run context ${runId} does not exist.`);
    }

    return context;
  }

  private runsDir(): string {
    return join(this.dataDir, 'runs');
  }

  private runPath(runId: string): string {
    validateRunId(runId);

    return join(this.runsDir(), `${runId}.json`);
  }
}

function validateRunId(runId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(runId)) {
    throw new Error('Run id must be a UUID.');
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
