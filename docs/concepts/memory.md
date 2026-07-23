# Memory System

**Status:** Current implementation
**Audience:** Product and engineering
**Canonical for:** Conversation state, long-term memory, retrieval, and user
controls

This document describes the implemented rdma26 memory system. Product-level
acceptance criteria are defined in the
[current milestone](../product/current-milestone.md).

## Design Decisions

The implementation follows LangGraph thread persistence and Deep Agents
filesystem-backed memory concepts:

- identity, current conversation state, curated long-term memory, and past
  conversations are different context layers;
- Markdown files are the durable source for long-term memory;
- only a bounded pinned subset enters every applicable run;
- other memory and past conversations are retrieved on demand;
- derived semantic vectors are rebuildable indexes, not authoritative records;
- memory operations remain user-visible and use the same services through UI,
  API, CLI, and agent tools;
- automatic thread summaries, expiration, lifecycle states, and background
  consolidation are intentionally absent until evaluation proves a need.

Primary framework references:

- [LangChain memory concepts](https://docs.langchain.com/oss/javascript/concepts/memory)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Deep Agents memory](https://docs.langchain.com/oss/javascript/deepagents/memory)
- [Deep Agents backends](https://docs.langchain.com/oss/javascript/deepagents/backends)

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

Unpinned files are not added to startup context. When a request depends on remembered information that is not already available in pinned startup memory, the agent can call the bounded `search_unpinned_memory` tool. It searches only applicable unpinned global user, agent-user, and agent memory files and returns matching records through the same memory service used by the API and CLI. Pinned memories cannot be returned by this tool.

The search combines exact text matching with semantic similarity. Semantic search uses the configured embedding model, `text-embedding-3-small` by default, so queries can match memories with different wording or language. Memory content and tags are embedded lazily on the first semantic search and cached in SQLite by content hash. Unchanged memories are not embedded again; updates invalidate their cached vector and deletion removes it. Query embeddings are created for semantic searches but do not require a chat-model call.

When `OPENAI_API_KEY` is not configured, memory search falls back to exact text matching. `OPENAI_EMBEDDING_MODEL` can select a different OpenAI embedding model. With OpenAI embeddings enabled, memory text used for indexing is sent to the configured OpenAI embedding service.

### Embedding Observability

Every real embedding provider request is recorded in the same local LLM-call store as chat and subagent requests. Embedding calls use the `memory_retrieval` purpose and identify whether they indexed memory files or embedded a search query. A call records its model, agent, thread and parent run when available, actual provider-reported input tokens, duration, status, and error details.

The call metadata also distinguishes newly indexed memory files from vectors reused from the SQLite cache. Cache reuse does not create a fake provider request: only work that actually reaches the embedding provider appears as a call. A semantic query still needs one query embedding even when every memory vector is cached. Exact-text matches avoid semantic search and therefore create no embedding call.

Embedding calls are visible in the Usage and Run context pages. Estimated cost is calculated when an active pricing record exists for the configured embedding model. The OpenAI price update reads the configured model's official model page and creates its active pricing record when missing. Without an active record, the call remains fully observable but is marked unpriced.

## Past Conversations

Past conversation recall uses two controlled tools when memory reading is enabled:

- `search_past_conversations` searches titles and message text in earlier threads
  for the same agent and returns at most ten bounded excerpts. Topic searches
  rank meaningful matching words before recency. Explicit requests for the
  previous or last thread rank the newest prior thread first; conversation
  navigation words such as `previous`, `message`, and `thread` do not inflate
  topical relevance.
- `read_past_conversation` reads at most fifty recent messages from one selected earlier thread.

The current thread is excluded. Cross-agent thread access is not allowed. This keeps episodic conversation history separate from curated long-term memory and avoids loading old threads into ordinary runs.

## Reading And Writing Settings

Every agent has two independent settings:

- `canRead`: enables pinned startup memory, `search_unpinned_memory`, and past-conversation tools.
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

## Current Limitations And Evaluation Needs

The mechanisms are implemented, but the complete memory experience is not yet
accepted as reliable. The stable evaluation set must still demonstrate:

- relevant agent-local memory recall in a new thread;
- global user memory recall by the intended agents;
- cross-agent local-memory isolation;
- exclusion of irrelevant memories;
- correct handling of updated or contradictory information;
- useful past-conversation recall;
- bounded context and measurable embedding cost.

These are quality requirements for the existing architecture, not a reason to
add a new memory taxonomy.

## Related Pages

- [Agents](./agents.md)
- [Context windows](./context-window.md)
- [Storage](../architecture/storage.md)
- [Current milestone](../product/current-milestone.md)
