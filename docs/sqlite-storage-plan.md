# SQLite Storage Plan

This document records the current storage boundary for `rdma26`.

## Databases

`.assistant-data/rdma26.sqlite` stores structured application data:

- threads and messages for UI/API/CLI access
- run-context snapshots
- LLM call accounting
- model pricing and pricing sources

`.assistant-data/langgraph-checkpoints.sqlite` is owned by the official LangGraph SQLite checkpointer and stores Deep Agents thread state across backend restarts.

## Files

Data that is naturally editable and file-oriented remains outside SQLite:

- `.assistant-data/agents/<agent-id>/configuration/soul.md`
- scoped Markdown long-term memory under user and agent memory directories
- Deep Agents skills and filesystem backend data
- future attachments or exports

The complete memory layout is documented in [memory.md](./memory.md).

## Migrations

`server/src/storage/schema-migrations.ts` contains ordered schema migrations. The current schema version is 8.

Before a destructive migration, the backend creates a timestamped SQLite backup under `.assistant-data/backups/`. Each migration runs transactionally and advances `schema_metadata.schema_version` only after success.

Schema version 7 removed the former memory lifetime column. Schema version 8 removed the obsolete custom `memory_records` table after the project adopted scoped Deep Agents Markdown memory. Threads and messages are preserved.

New databases are created directly at the current schema and do not need migration backups.

## Future SQL Work

Potential future improvements include FTS5 indexes for larger thread-history collections and retention controls for high-volume run/LLM telemetry. These should be added only when real usage shows a need.
