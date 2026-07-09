import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const currentSchemaVersion = 3;

export class LocalDatabase {
  private database: Database.Database | null = null;

  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(dirname(this.databasePath()), { recursive: true });
    const database = this.get();

    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    applySchema(database);
  }

  get(): Database.Database {
    if (!this.database) {
      this.database = new Database(this.databasePath());
    }

    return this.database;
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }

  private databasePath(): string {
    return join(this.dataDir, 'rdma26.sqlite');
  }
}

function applySchema(database: Database.Database): void {
  database.exec(`
    create table if not exists schema_metadata (
      key text primary key,
      value text not null
    );

    create table if not exists memory_records (
      id text primary key,
      scope text not null,
      agent_id text,
      type text not null,
      status text not null,
      lifetime text not null,
      content text not null,
      content_lines_json text,
      tags_json text not null,
      source_json text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists threads (
      id text primary key,
      agent_id text not null,
      title text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists messages (
      id text primary key,
      thread_id text not null references threads(id) on delete cascade,
      role text not null,
      content text not null,
      created_at text not null,
      position integer not null,
      unique(thread_id, position)
    );

    create table if not exists run_contexts (
      id text primary key,
      agent_id text not null,
      thread_id text not null,
      created_at text not null,
      context_json text not null
    );

    create table if not exists llm_calls (
      id text primary key,
      run_id text,
      provider text not null,
      model text not null,
      purpose text not null,
      status text not null,
      agent_id text,
      thread_id text,
      provider_run_id text,
      parent_provider_run_id text,
      input_tokens integer,
      output_tokens integer,
      total_tokens integer,
      cached_input_tokens integer,
      reasoning_tokens integer,
      request_started_at text not null,
      request_finished_at text,
      duration_ms integer,
      error_message text,
      pricing_snapshot_id text,
      estimated_input_cost real,
      estimated_output_cost real,
      estimated_cached_input_cost real,
      estimated_reasoning_cost real,
      estimated_total_cost real,
      estimated_cost_currency text,
      metadata_json text
    );

    create table if not exists model_pricing (
      id text primary key,
      provider text not null,
      model text not null,
      input_cost_per_million_tokens real not null,
      output_cost_per_million_tokens real not null,
      cached_input_cost_per_million_tokens real,
      reasoning_cost_per_million_tokens real,
      currency text not null,
      source_url text not null,
      source_name text,
      source_retrieved_at text not null,
      valid_from text,
      valid_until text,
      status text not null,
      notes text,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_memory_agent_scope_type_status_updated
      on memory_records(agent_id, scope, type, status, updated_at);

    create index if not exists idx_memory_scope_type_status_updated
      on memory_records(scope, type, status, updated_at);

    create index if not exists idx_memory_type_status_updated
      on memory_records(type, status, updated_at);

    create index if not exists idx_memory_updated
      on memory_records(updated_at);

    create index if not exists idx_threads_agent_updated
      on threads(agent_id, updated_at);

    create index if not exists idx_messages_thread_position
      on messages(thread_id, position);

    create index if not exists idx_run_contexts_agent_thread
      on run_contexts(agent_id, thread_id);

    create index if not exists idx_run_contexts_created
      on run_contexts(created_at);

    create index if not exists idx_llm_calls_run_started
      on llm_calls(run_id, request_started_at);

    create index if not exists idx_llm_calls_agent_thread_started
      on llm_calls(agent_id, thread_id, request_started_at);

    create index if not exists idx_llm_calls_started
      on llm_calls(request_started_at);

    create index if not exists idx_model_pricing_lookup
      on model_pricing(provider, model, status, valid_from, valid_until);

    create index if not exists idx_model_pricing_updated
      on model_pricing(updated_at);
  `);

  ensureColumn(database, 'llm_calls', 'pricing_snapshot_id', 'text');
  ensureColumn(database, 'llm_calls', 'estimated_input_cost', 'real');
  ensureColumn(database, 'llm_calls', 'estimated_output_cost', 'real');
  ensureColumn(database, 'llm_calls', 'estimated_cached_input_cost', 'real');
  ensureColumn(database, 'llm_calls', 'estimated_reasoning_cost', 'real');
  ensureColumn(database, 'llm_calls', 'estimated_total_cost', 'real');
  ensureColumn(database, 'llm_calls', 'estimated_cost_currency', 'text');

  database
    .prepare(
      `
        insert into schema_metadata (key, value)
        values ('schema_version', ?)
        on conflict(key) do update set value = excluded.value
      `,
    )
    .run(String(currentSchemaVersion));
}

function ensureColumn(
  database: Database.Database,
  tableName: string,
  columnName: string,
  columnType: string,
): void {
  const rows = database.prepare(`pragma table_info(${tableName})`).all();
  const hasColumn = rows.some(
    (row) =>
      typeof row === 'object' &&
      row !== null &&
      'name' in row &&
      (row as { readonly name?: unknown }).name === columnName,
  );

  if (!hasColumn) {
    database.exec(`alter table ${tableName} add column ${columnName} ${columnType}`);
  }
}
