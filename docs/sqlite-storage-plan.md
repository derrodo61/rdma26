# SQLite Storage Plan

This document describes the phased move from UUID-named JSON files to a local SQLite database.

## Goal

`rdma26` should remain local-first, but structured app data should become searchable, sortable, and easier to manage from UI, API, and CLI.

SQLite becomes the source of truth for structured state:

```text
.assistant-data/rdma26.sqlite
```

Files remain useful for data that is naturally file-like:

- per-agent `configuration/soul.md`
- Deep Agents filesystem backend data
- future attachments or exports

## Why SQLite

- single local file, no server dependency
- chronological sorting without relying on UUID filenames
- efficient filtering by agent, scope, type, status, and dates
- transactions for multi-step writes
- future full-text search with FTS5
- easier UI data browsing
- reasonable migration path to another SQL database later if needed

## Phase 1: Memories

Move memory records to SQLite while keeping the existing MemoryStore API stable.

Status: implemented.

Tables:

```sql
memory_records (
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
)
```

Indexes:

- `(agent_id, scope, type, status, updated_at)`
- `(scope, type, status, updated_at)`
- `(type, status, updated_at)`
- `(updated_at)`

Migration:

- On startup, create the schema if missing.
- Import existing JSON memories from:
  - `.assistant-data/user/memories/*.json`
  - `.assistant-data/agents/<agent-id>/memories/*.json`
- Use `insert or ignore` so migration is idempotent.
- Remove JSON source files after successful import.
- New and updated memories are written to SQLite.

Compatibility:

- API responses remain unchanged.
- CLI commands remain unchanged.
- Runtime memory retrieval remains unchanged from callers' perspective.
- Embedding cache can stay as JSON in phase 1.

## Phase 2: Memory UI

Improve the memory UI once SQLite backs the data.

Status: implemented with metadata and date browsing filters in the memory UI,
API, and CLI.

Expected filters:

- scope: `user`, `agent_user`, `agent`
- agent
- type
- status
- tags
- created/updated date
- text search

Useful views:

- Global user memory
- Agent-specific user memory
- Agent memory
- Conversation summaries
- Archived/superseded memory

## Phase 3: Threads And Messages

Move threads and messages to SQLite.

Status: implemented.

Tables:

```sql
threads (
  id text primary key,
  agent_id text not null,
  title text not null,
  created_at text not null,
  updated_at text not null
)

messages (
  id text primary key,
  thread_id text not null references threads(id) on delete cascade,
  role text not null,
  content text not null,
  created_at text not null,
  position integer not null,
  unique(thread_id, position)
)
```

Migration imports `.assistant-data/agents/<agent-id>/threads/*.json` once per agent
and imports old root `.assistant-data/threads/*.json` into the default agent. JSON
source files are removed after successful import. New and updated threads/messages
are written to SQLite.

## Phase 4: Runs, Tool Calls, And Research Sources

Move run contexts to SQLite after threads/messages are stable.

Status: implemented with a compact run-context table.

Table:

```sql
run_contexts (
  id text primary key,
  agent_id text not null,
  thread_id text not null,
  created_at text not null,
  context_json text not null
)
```

The full typed run context is stored as JSON so the existing API, CLI, and UI
can continue to render the same details. Indexed metadata supports lookup,
thread deletion cleanup, orphan cleanup, and later browsing views.
Legacy global and per-agent run-context JSON files are removed after successful
import.

The run-context inspector should query this data directly.

## Later

- Add FTS5 tables for memory and thread search.
- Add database backup/export commands.
- Add JSON export/import for portability.
- Consider SQL migrations with explicit schema versions once multiple phases exist.
