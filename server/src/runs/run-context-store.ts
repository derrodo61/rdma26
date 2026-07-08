import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { RunContextDetails } from '../../../shared/agent-contracts';
import { LocalDatabase } from '../storage/local-database';

export class RunContextStore {
  private readonly database: LocalDatabase;

  constructor(private readonly dataDir: string) {
    this.database = new LocalDatabase(dataDir);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.agentsDir(), { recursive: true });
    await this.database.ensureReady();
    await this.importRunJsonFiles();
  }

  async writeRunContext(context: RunContextDetails): Promise<RunContextDetails> {
    await this.ensureReady();
    this.writeRunContextRow(context, 'replace');

    return context;
  }

  async readRunContext(runId: string): Promise<RunContextDetails | null> {
    validateRunId(runId);

    const row = this.database
      .get()
      .prepare('select context_json from run_contexts where id = ?')
      .get(runId);

    return row ? runContextFromRow(row) : null;
  }

  async requireRunContext(runId: string): Promise<RunContextDetails> {
    const context = await this.readRunContext(runId);

    if (!context) {
      throw new Error(`Run context ${runId} does not exist.`);
    }

    return context;
  }

  async readLatestRunContextForThread(
    agentId: string,
    threadId: string,
  ): Promise<RunContextDetails | null> {
    validateAgentId(agentId);
    validateThreadId(threadId);

    const row = this.database
      .get()
      .prepare(
        `
          select context_json
          from run_contexts
          where agent_id = ?
            and thread_id = ?
          order by created_at desc
          limit 1
        `,
      )
      .get(agentId, threadId);

    return row ? runContextFromRow(row) : null;
  }

  async listRunContextsForThread(
    agentId: string,
    threadId: string,
  ): Promise<readonly RunContextDetails[]> {
    validateAgentId(agentId);
    validateThreadId(threadId);

    const rows = this.database
      .get()
      .prepare(
        `
          select context_json
          from run_contexts
          where agent_id = ?
            and thread_id = ?
          order by created_at desc
        `,
      )
      .all(agentId, threadId);

    return rows.map((row) => runContextFromRow(row));
  }

  async deleteRunsForThread(agentId: string, threadId: string): Promise<number> {
    validateAgentId(agentId);
    validateThreadId(threadId);

    const result = this.database
      .get()
      .prepare('delete from run_contexts where agent_id = ? and thread_id = ?')
      .run(agentId, threadId);

    return result.changes;
  }

  async deleteOrphanedRuns(): Promise<number> {
    await this.ensureReady();

    const result = this.database
      .get()
      .prepare(
        `
          delete from run_contexts
          where not exists (
            select 1
            from threads
            where threads.id = run_contexts.thread_id
              and threads.agent_id = run_contexts.agent_id
          )
        `,
      )
      .run();

    return result.changes;
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

  private async importRunJsonFiles(): Promise<void> {
    const markerKey = 'run_context_json_imported_at';
    const importMarker = this.database
      .get()
      .prepare('select value from schema_metadata where key = ?')
      .get(markerKey);

    if (importMarker) {
      await this.deleteImportedRunJsonFiles();
      return;
    }

    for (const runFile of await this.listLegacyRunFiles()) {
      const context = await this.readRunContextFileSafely(runFile);

      if (!context || !isValidAgentId(context.agentId)) {
        await rm(runFile, { force: true });
        continue;
      }

      this.writeRunContextRow(context, 'insert-or-ignore');
    }

    await this.deleteImportedRunJsonFiles();
    this.database
      .get()
      .prepare('insert into schema_metadata (key, value) values (?, ?)')
      .run(markerKey, new Date().toISOString());
  }

  private async listLegacyRunFiles(): Promise<readonly string[]> {
    const globalRuns = await this.listRunFilesInDir(this.legacyRunsDir());
    const agentRuns = await Promise.all(
      (await this.listAgentIds()).map(async (agentId) => await this.listRunFilesForAgent(agentId)),
    );

    return [...globalRuns, ...agentRuns.flat()];
  }

  private async listRunFilesInDir(dir: string): Promise<readonly string[]> {
    try {
      const fileNames = await readdir(dir);

      return fileNames
        .filter((fileName) => fileName.endsWith('.json'))
        .map((fileName) => join(dir, fileName));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
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

  private async deleteImportedRunJsonFiles(): Promise<void> {
    for (const runFile of await this.listLegacyRunFiles()) {
      const context = await this.readRunContextFileSafely(runFile);

      if (!context) {
        continue;
      }

      const row = this.database
        .get()
        .prepare('select id from run_contexts where id = ?')
        .get(context.runId);

      if (row) {
        await rm(runFile, { force: true });
      }
    }

    const remainingGlobalRuns = await this.listRunFilesInDir(this.legacyRunsDir());

    if (!remainingGlobalRuns.length) {
      await rm(this.legacyRunsDir(), { recursive: true, force: true });
    }
  }

  private writeRunContextRow(
    context: RunContextDetails,
    mode: 'replace' | 'insert-or-ignore',
  ): void {
    const statement =
      mode === 'replace'
        ? 'insert or replace into run_contexts'
        : 'insert or ignore into run_contexts';

    this.database
      .get()
      .prepare(
        `
          ${statement} (id, agent_id, thread_id, created_at, context_json)
          values (?, ?, ?, ?, ?)
        `,
      )
      .run(
        context.runId,
        context.agentId,
        context.threadId,
        context.createdAt,
        JSON.stringify(context),
      );
  }
}

function runContextFromRow(row: unknown): RunContextDetails {
  if (
    typeof row !== 'object' ||
    row === null ||
    !('context_json' in row) ||
    typeof row.context_json !== 'string'
  ) {
    throw new Error('Invalid run-context database row.');
  }

  return JSON.parse(row.context_json) as RunContextDetails;
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
