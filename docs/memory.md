# Memory System

This document describes the implemented `rdma26` memory system. The design decisions and future boundaries are in [memory-spec.md](./memory-spec.md).

## The Four Context Layers

rdma26 keeps four different things separate:

1. `soul.md` defines an agent's stable identity and operating principles.
2. LangGraph checkpoints preserve the state of one conversation thread.
3. Scoped Markdown files contain curated long-term memory across threads.
4. Stored threads contain past conversations and can be searched on demand.

A conversation is not converted into a memory record. There are no automatic thread summaries, expiration rules, lifecycle states, or background memory-maintenance LLM calls.

## Storage

```text
.assistant-data/
  langgraph-checkpoints.sqlite
  rdma26.sqlite
  user/
    memory/
      <memory-id>.md
  agents/
    <agent-id>/
      configuration/
        soul.md
      memory/
        user/
          <memory-id>.md
        agent/
          <memory-id>.md
```

`langgraph-checkpoints.sqlite` is the official LangGraph SQLite checkpointer database. It allows a Deep Agent conversation to continue after a backend restart.

`rdma26.sqlite` remains the UI read model for threads, messages, run contexts, LLM calls, and pricing. It does not contain authoritative long-term memory records. It also caches derived embedding vectors for semantic memory search; those vectors can be rebuilt from the Markdown files.

Each memory is a Markdown file with YAML frontmatter for its id, scope, pin state, tags, source, and timestamps. The Markdown body is the durable content.

## Scopes

`user`

Global user memory available to all memory-enabled agents. Files live in `.assistant-data/user/memory/` and are mounted at `/memory/global/`.

`agent_user`

Information about the user that applies only to one agent relationship. Files live in `.assistant-data/agents/<agent-id>/memory/user/` and are mounted at `/memory/agent-user/`.

`agent`

Knowledge or working agreements belonging to one agent. Files live in `.assistant-data/agents/<agent-id>/memory/agent/` and are mounted at `/memory/agent/`.

## Pinned Memory

Pinning means "load this memory at the start of every applicable run." The backend supplies pinned virtual paths through Deep Agents' `memory` option.

Durable and pinned are different. Every saved memory remains stored until it is deleted, including unpinned memory. Asking an agent to remember something permanently does not pin it. Agent-created memory is unpinned by default; pinning requires an explicit request to load the information into every conversation, or a direct change through UI, API, or CLI.

Each scope has a 3,000-character startup budget. A write that would exceed the budget fails clearly; rdma26 does not silently truncate another memory. Pinned memory should therefore be short and limited to information that must always apply.

The run-context page shows every pinned file loaded into a run, including its scope, virtual path, content, and source metadata.

## Unpinned Memory

Unpinned files are not added to startup context. When a request depends on remembered information that was not pinned and is not already available in pinned startup memory, the agent can call the bounded `search_memory` tool. It searches the applicable global user, agent-user, and agent memory files and returns matching records through the same memory service used by the API and CLI.

The search combines exact text matching with semantic similarity. Semantic search uses the configured embedding model, `text-embedding-3-small` by default, so queries can match memories with different wording or language. Memory content and tags are embedded lazily on the first semantic search and cached in SQLite by content hash. Unchanged memories are not embedded again; updates invalidate their cached vector and deletion removes it. Query embeddings are created for semantic searches but do not require a chat-model call.

When `OPENAI_API_KEY` is not configured, memory search falls back to exact text matching. `OPENAI_EMBEDDING_MODEL` can select a different OpenAI embedding model. With OpenAI embeddings enabled, memory text used for indexing is sent to the configured OpenAI embedding service.

## Past Conversations

Past conversation recall uses two controlled tools when memory reading is enabled:

- `search_past_conversations` searches titles and message text in earlier threads for the same agent and returns at most ten bounded excerpts.
- `read_past_conversation` reads at most fifty recent messages from one selected earlier thread.

The current thread is excluded. Cross-agent thread access is not allowed. This keeps episodic conversation history separate from curated long-term memory and avoids loading old threads into ordinary runs.

## Reading And Writing Settings

Every agent has two independent settings:

- `canRead`: enables pinned startup memory, `search_memory`, and past-conversation tools.
- `canWrite`: enables the controlled `save_memory` tool.

The user can still manage memory through UI, API, and CLI regardless of an agent's tool permissions.

The `save_memory` tool uses the same backend service as the API and CLI. Explicit user requests should be saved when writing is enabled. Sensitive, ambiguous, or unclear-scope information requires clarification. Secrets and credentials must never be saved.

Deep Agents' native filesystem tools are not allowed to write under `/memory`; all agent memory writes must go through `save_memory`. When `canRead` is disabled, native reads under `/memory` are denied as well. This prevents an agent from bypassing its configured memory permissions.

## API And CLI

The memory API exposes:

```text
GET    /api/memories
POST   /api/memories
GET    /api/memories/:memoryId
PATCH  /api/memories/:memoryId
DELETE /api/memories/:memoryId
```

The CLI exposes the same operations:

```bash
rdma26 memories:list --agent ronaldo --scope agent --pinned true
rdma26 memories:read --memory <memory-id>
rdma26 memories:create --agent ronaldo --scope agent --content "..." --pinned true
rdma26 memories:update --memory <memory-id> --content "..." --pinned false
rdma26 memories:delete --memory <memory-id>
```

The Memories settings page supports scope selection, search, create, edit, pin/unpin, and delete. Created and updated timestamps are generated by the backend.

## Deletion

Deleting a thread deletes its UI messages, run contexts, LLM call records, and LangGraph checkpoints. It does not delete unrelated curated memories.

Deleting an agent deletes its agent directory, local memory files, threads, run data, and LangGraph checkpoints. Global user memory remains.

## Schema Migration

Schema version 8 removes the old `memory_records` table. Schema version 9 adds a rebuildable embedding-vector cache while keeping Markdown as the only authoritative long-term memory source. Startup also removes the obsolete JSON embedding cache and memory-maintenance settings file. These migrations do not delete threads or messages.
