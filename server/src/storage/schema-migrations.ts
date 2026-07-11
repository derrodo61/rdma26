import type Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const currentSchemaVersion = 8;

interface SchemaMigration {
  readonly version: number;
  readonly destructive?: boolean;
  readonly up: (database: Database.Database) => void;
}

const migrations: readonly SchemaMigration[] = [
  {
    version: 7,
    destructive: true,
    up: removeMemoryLifetime,
  },
  {
    version: 8,
    destructive: true,
    up: removeCustomMemoryTable,
  },
];

export async function migrateDatabase(
  database: Database.Database,
  fromVersion: number,
  dataDir: string,
): Promise<void> {
  if (fromVersion > currentSchemaVersion) {
    throw new Error(
      `Database schema version ${fromVersion} is newer than supported version ${currentSchemaVersion}.`,
    );
  }

  let version = fromVersion;

  for (const migration of migrations) {
    if (migration.version <= version) {
      continue;
    }

    if (migration.version !== version + 1) {
      throw new Error(
        `No database migration is available from schema version ${version} to ${migration.version}.`,
      );
    }

    if (migration.destructive) {
      await backupDatabase(database, dataDir, version, migration.version);
    }

    database.transaction(() => {
      migration.up(database);
      database
        .prepare(
          `
            insert into schema_metadata (key, value)
            values ('schema_version', ?)
            on conflict(key) do update set value = excluded.value
          `,
        )
        .run(String(migration.version));
    })();
    version = migration.version;
  }

  if (version !== currentSchemaVersion) {
    throw new Error(
      `Database schema version ${version} cannot be migrated to ${currentSchemaVersion}.`,
    );
  }
}

export function createCurrentSchema(database: Database.Database): void {
  database.exec(`
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

    create table if not exists pricing_sources (
      id text primary key,
      provider text not null,
      name text not null,
      url text not null,
      trust_level text not null,
      active integer not null,
      notes text,
      last_checked_at text,
      last_success_at text,
      last_error text,
      created_at text not null,
      updated_at text not null,
      unique(provider, url)
    );

    create index if not exists idx_threads_agent_updated on threads(agent_id, updated_at);
    create index if not exists idx_messages_thread_position on messages(thread_id, position);
    create index if not exists idx_run_contexts_agent_thread on run_contexts(agent_id, thread_id);
    create index if not exists idx_run_contexts_created on run_contexts(created_at);
    create index if not exists idx_llm_calls_run_started on llm_calls(run_id, request_started_at);
    create index if not exists idx_llm_calls_agent_thread_started
      on llm_calls(agent_id, thread_id, request_started_at);
    create index if not exists idx_llm_calls_started on llm_calls(request_started_at);
    create index if not exists idx_model_pricing_lookup
      on model_pricing(provider, model, status, valid_from, valid_until);
    create index if not exists idx_model_pricing_updated on model_pricing(updated_at);
    create unique index if not exists idx_model_pricing_provider_model
      on model_pricing(provider, model);
    create index if not exists idx_pricing_sources_provider_active
      on pricing_sources(provider, active);
    create index if not exists idx_pricing_sources_updated on pricing_sources(updated_at);
  `);
}

async function backupDatabase(
  database: Database.Database,
  dataDir: string,
  fromVersion: number,
  toVersion: number,
): Promise<void> {
  const backupDir = join(dataDir, 'backups');
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(
    backupDir,
    `rdma26-schema-v${fromVersion}-to-v${toVersion}-${timestamp}.sqlite`,
  );

  await database.backup(backupPath);
}

function removeMemoryLifetime(database: Database.Database): void {
  database.exec(`
    drop index if exists idx_memory_agent_scope_type_status_updated;
    drop index if exists idx_memory_scope_type_status_updated;
    drop index if exists idx_memory_type_status_updated;
    drop index if exists idx_memory_updated;

    create table memory_records_v7 (
      id text primary key,
      scope text not null,
      agent_id text,
      type text not null,
      status text not null,
      pinned integer not null default 0,
      content text not null,
      content_lines_json text,
      tags_json text not null,
      source_json text,
      created_at text not null,
      updated_at text not null
    );

    insert into memory_records_v7 (
      id, scope, agent_id, type, status, pinned, content, content_lines_json,
      tags_json, source_json, created_at, updated_at
    )
    select
      id, scope, agent_id, type, status, pinned, content, content_lines_json,
      tags_json, source_json, created_at, updated_at
    from memory_records;

    drop table memory_records;
    alter table memory_records_v7 rename to memory_records;

    create index idx_memory_agent_scope_type_status_updated
      on memory_records(agent_id, scope, type, status, updated_at);
    create index idx_memory_scope_type_status_updated
      on memory_records(scope, type, status, updated_at);
    create index idx_memory_type_status_updated
      on memory_records(type, status, updated_at);
    create index idx_memory_updated on memory_records(updated_at);
  `);
}

function removeCustomMemoryTable(database: Database.Database): void {
  database.exec(`
    drop index if exists idx_memory_agent_scope_type_status_updated;
    drop index if exists idx_memory_scope_type_status_updated;
    drop index if exists idx_memory_type_status_updated;
    drop index if exists idx_memory_updated;
    drop table if exists memory_records;
  `);
}
