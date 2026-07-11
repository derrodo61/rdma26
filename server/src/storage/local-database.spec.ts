import Database from 'better-sqlite3';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalDatabase } from './local-database';

describe('LocalDatabase migrations', () => {
  it('backs up and transactionally removes the obsolete memory table through schema 8', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-database-migration-'));
    const databasePath = join(dataDir, 'rdma26.sqlite');
    const legacy = new Database(databasePath);

    try {
      legacy.exec(`
        create table schema_metadata (
          key text primary key,
          value text not null
        );
        insert into schema_metadata (key, value) values ('schema_version', '6');

        create table memory_records (
          id text primary key,
          scope text not null,
          agent_id text,
          type text not null,
          status text not null,
          lifetime text not null,
          pinned integer not null default 0,
          content text not null,
          content_lines_json text,
          tags_json text not null,
          source_json text,
          created_at text not null,
          updated_at text not null
        );
      `);
      legacy
        .prepare(
          `
            insert into memory_records (
              id, scope, agent_id, type, status, lifetime, pinned, content,
              tags_json, created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          '00000000-0000-0000-0000-000000000001',
          'agent',
          'ronaldo',
          'fact',
          'active',
          'permanent',
          1,
          'A preserved memory.',
          '[]',
          '2026-07-11T10:00:00.000Z',
          '2026-07-11T10:00:00.000Z',
        );
      legacy.close();

      const migrated = new LocalDatabase(dataDir);
      await migrated.ensureReady();
      const memoryTable = migrated
        .get()
        .prepare("select name from sqlite_master where type = 'table' and name = 'memory_records'")
        .get();
      const version = migrated
        .get()
        .prepare("select value from schema_metadata where key = 'schema_version'")
        .get();

      expect(memoryTable).toBeUndefined();
      expect(version).toEqual({ value: '8' });
      expect(await readdir(join(dataDir, 'backups'))).toHaveLength(2);
      migrated.close();
    } finally {
      if (legacy.open) {
        legacy.close();
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('creates new databases directly at the current schema without a backup', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rdma26-database-current-'));

    try {
      const database = new LocalDatabase(dataDir);
      await database.ensureReady();
      const version = database
        .get()
        .prepare("select value from schema_metadata where key = 'schema_version'")
        .get();
      const memoryTable = database
        .get()
        .prepare("select name from sqlite_master where type = 'table' and name = 'memory_records'")
        .get();

      expect(version).toEqual({ value: '8' });
      expect(memoryTable).toBeUndefined();
      await expect(readdir(join(dataDir, 'backups'))).rejects.toMatchObject({ code: 'ENOENT' });
      database.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
