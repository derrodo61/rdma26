import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createCurrentSchema, currentSchemaVersion, migrateDatabase } from './schema-migrations';

export class LocalDatabase {
  private database: Database.Database | null = null;

  constructor(private readonly dataDir: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(dirname(this.databasePath()), { recursive: true });
    const database = this.get();

    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.exec(`
      create table if not exists schema_metadata (
        key text primary key,
        value text not null
      );
    `);

    const version = readSchemaVersion(database);

    if (!hasApplicationSchema(database) && version === null) {
      createCurrentSchema(database);
      writeSchemaVersion(database, currentSchemaVersion);
      return;
    }

    if (version === null) {
      throw new Error(
        'Existing database has no schema version. Restore a backup or migrate it explicitly.',
      );
    }

    await migrateDatabase(database, version, this.dataDir);
    createCurrentSchema(database);
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

function hasApplicationSchema(database: Database.Database): boolean {
  return Boolean(
    database.prepare("select 1 from sqlite_master where type = 'table' and name = 'threads'").get(),
  );
}

function readSchemaVersion(database: Database.Database): number | null {
  const row = database
    .prepare("select value from schema_metadata where key = 'schema_version'")
    .get() as { readonly value?: unknown } | undefined;

  if (!row || typeof row.value !== 'string') {
    return null;
  }

  const version = Number.parseInt(row.value, 10);

  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid database schema version: ${row.value}`);
  }

  return version;
}

function writeSchemaVersion(database: Database.Database, version: number): void {
  database
    .prepare(
      `
        insert into schema_metadata (key, value)
        values ('schema_version', ?)
        on conflict(key) do update set value = excluded.value
      `,
    )
    .run(String(version));
}
