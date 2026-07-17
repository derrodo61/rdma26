# Storage

This document describes the implemented local storage boundaries and lifecycle.

## Data Root

Persistent application data lives under `.assistant-data/` by default. The
backend owns this directory; browser code does not access it directly.

```text
.assistant-data/
  rdma26.sqlite
  langgraph-checkpoints.sqlite
  backups/
  evaluations/
  provider-auth/
    openai-chatgpt.json
  user/
    memory/
  agents/
    <agent-id>/
      agent.json
      configuration/
        soul.md
      memory/
        user/
        agent/
      deepagent/
```

## Application Database

`.assistant-data/rdma26.sqlite` stores structured application and observability
records:

- threads and messages used by UI, API, and CLI;
- run-context snapshots;
- LLM and embedding call accounting;
- model pricing and pricing sources;
- the user profile;
- rebuildable semantic-memory vectors and their content hashes;
- schema metadata.

Versioned evaluation reports are JSON artifacts under
`.assistant-data/evaluations/`. They retain metrics and responses even when the
temporary evaluation agents and their operational records are cleaned up.

The application database is not the authoritative source for long-term memory
content.

## LangGraph Checkpoints

`.assistant-data/langgraph-checkpoints.sqlite` is owned by the official
LangGraph SQLite checkpointer. It stores Deep Agents thread state so a
conversation can continue after a backend restart.

Application thread/message records and LangGraph checkpoint state have different
owners but share the same thread id. Thread deletion removes both.

## Files

Data that is naturally editable and file-oriented remains outside SQLite:

- agent profiles and configuration;
- each agent's `configuration/soul.md` identity;
- global and agent-scoped Markdown memory;
- Deep Agents filesystem and skill data;
- future attachments and generated artifacts.

The complete memory layout is documented in [memory.md](./memory.md).

ChatGPT/Codex OAuth credentials are stored in
`.assistant-data/provider-auth/openai-chatgpt.json`. The provider-auth directory
uses mode `0700` and the credential file uses mode `0600`. The backend refreshes
and atomically replaces this file; browser code and API responses never receive
its access or refresh tokens.

## Schema Migrations

`server/src/storage/schema-migrations.ts` contains ordered migrations. Each
migration runs transactionally and advances `schema_metadata.schema_version`
only after success.

Before a destructive migration, the backend creates a timestamped backup under
`.assistant-data/backups/`. A new database is created directly at the current
schema.

Current durable cleanup includes:

- removal of the obsolete memory lifetime column;
- removal of the former custom `memory_records` table;
- addition of the rebuildable semantic-memory vector cache;
- removal of obsolete JSON memory-index and maintenance files.

## Startup Maintenance

During startup, the runtime:

- ensures agents and system agents exist;
- initializes application stores and migrations;
- initializes the LangGraph checkpointer;
- removes orphaned run contexts;
- removes orphaned LLM-call records;
- ensures default pricing sources.

Maintenance must not silently delete authoritative memory or valid threads.

## Deletion Boundaries

Deleting a thread removes:

- thread messages;
- dependent run contexts;
- dependent LLM-call records;
- LangGraph checkpoints for that thread.

Deleting an agent removes:

- its agent directory and configuration;
- its agent-local memory;
- its threads and dependent run data;
- its LangGraph checkpoints.

Global user memory remains because it is not owned by one agent.

## Future Storage Work

Potential future additions include attachments, generated artifacts, retention
controls for high-volume telemetry, and full-text indexes for large thread
collections. They should be added only when the product requires them and their
deletion lifecycle is defined.
