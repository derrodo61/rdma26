import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const currentSchemaVersion = 1;

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
  `);

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
