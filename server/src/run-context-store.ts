import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RunContextDetails } from '../../shared/agent-contracts';

export class RunContextStore {
  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.agentsDir(), { recursive: true });
    await this.migrateLegacyRuns();
  }

  async writeRunContext(context: RunContextDetails): Promise<RunContextDetails> {
    await this.ensureReady();
    await mkdir(this.agentRunsDir(context.agentId), { recursive: true });
    await writeFile(
      this.agentRunPath(context.agentId, context.runId),
      `${JSON.stringify(context, null, 2)}\n`,
      'utf8',
    );

    return context;
  }

  async readRunContext(runId: string): Promise<RunContextDetails | null> {
    validateRunId(runId);

    try {
      const runPath = await this.findRunPath(runId);

      if (!runPath) {
        return null;
      }

      return JSON.parse(await readFile(runPath, 'utf8')) as RunContextDetails;
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

  async deleteRunsForThread(agentId: string, threadId: string): Promise<number> {
    validateAgentId(agentId);
    validateThreadId(threadId);

    let deletedCount = 0;

    for (const runFile of await this.listRunFilesForAgent(agentId)) {
      const context = JSON.parse(await readFile(runFile, 'utf8')) as RunContextDetails;

      if (context.agentId !== agentId || context.threadId !== threadId) {
        continue;
      }

      await rm(runFile, { force: true });
      deletedCount += 1;
    }

    return deletedCount;
  }

  async deleteOrphanedRuns(): Promise<number> {
    await this.ensureReady();

    let deletedCount = 0;

    for (const agentId of await this.listAgentIds()) {
      const threadIds = await this.listThreadIdsForAgent(agentId);

      for (const runFile of await this.listRunFilesForAgent(agentId)) {
        const context = await this.readRunContextFileSafely(runFile);

        if (!context || context.agentId !== agentId || threadIds.has(context.threadId)) {
          continue;
        }

        await rm(runFile, { force: true });
        deletedCount += 1;
      }
    }

    return deletedCount;
  }

  private legacyRunsDir(): string {
    return join(this.dataDir, 'runs');
  }

  private agentsDir(): string {
    return join(this.dataDir, 'agents');
  }

  private agentRunsDir(agentId: string): string {
    validateAgentId(agentId);

    return join(this.agentsDir(), agentId, 'runs');
  }

  private agentRunPath(agentId: string, runId: string): string {
    validateAgentId(agentId);
    validateRunId(runId);

    return join(this.agentRunsDir(agentId), `${runId}.json`);
  }

  private async findRunPath(runId: string): Promise<string | null> {
    validateRunId(runId);

    for (const agentId of await this.listAgentIds()) {
      const runPath = this.agentRunPath(agentId, runId);

      try {
        await readFile(runPath, 'utf8');

        return runPath;
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          continue;
        }

        throw error;
      }
    }

    return null;
  }

  private async listRunFilesForAgent(agentId: string): Promise<readonly string[]> {
    try {
      const fileNames = await readdir(this.agentRunsDir(agentId));

      return fileNames
        .filter((fileName) => fileName.endsWith('.json'))
        .map((fileName) => join(this.agentRunsDir(agentId), fileName));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private async listThreadIdsForAgent(agentId: string): Promise<ReadonlySet<string>> {
    const threadsDir = join(this.agentsDir(), agentId, 'threads');

    try {
      const fileNames = await readdir(threadsDir);

      return new Set(
        fileNames
          .filter((fileName) => fileName.endsWith('.json'))
          .map((fileName) => fileName.slice(0, -'.json'.length))
          .filter((threadId) => /^[a-f0-9-]{36}$/i.test(threadId)),
      );
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return new Set();
      }

      throw error;
    }
  }

  private async readRunContextFileSafely(runFile: string): Promise<RunContextDetails | null> {
    try {
      return JSON.parse(await readFile(runFile, 'utf8')) as RunContextDetails;
    } catch {
      return null;
    }
  }

  private async listAgentIds(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.agentsDir(), { withFileTypes: true });

      return entries
        .filter((entry) => entry.isDirectory() && isValidAgentId(entry.name))
        .map((entry) => entry.name);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private async migrateLegacyRuns(): Promise<void> {
    let fileNames: readonly string[];

    try {
      fileNames = await readdir(this.legacyRunsDir());
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }

    for (const fileName of fileNames.filter((candidate) => candidate.endsWith('.json'))) {
      const legacyPath = join(this.legacyRunsDir(), fileName);
      const raw = await readFile(legacyPath, 'utf8');
      const context = JSON.parse(raw) as RunContextDetails;

      if (!isValidAgentId(context.agentId)) {
        await rm(legacyPath, { force: true });
        continue;
      }

      await mkdir(this.agentRunsDir(context.agentId), { recursive: true });
      await rename(legacyPath, this.agentRunPath(context.agentId, context.runId));
    }

    await rm(this.legacyRunsDir(), { recursive: true, force: true });
  }
}

function validateRunId(runId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(runId)) {
    throw new Error('Run id must be a UUID.');
  }
}

function validateAgentId(agentId: string): void {
  if (!isValidAgentId(agentId)) {
    throw new Error('Agent id must contain only letters, numbers, underscores, or hyphens.');
  }
}

function isValidAgentId(agentId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(agentId);
}

function validateThreadId(threadId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(threadId)) {
    throw new Error('Thread id must be a UUID.');
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
