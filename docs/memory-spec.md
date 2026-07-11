# Memory Architecture Specification

This document defines how `rdma26` should implement persistent memory using LangGraph and Deep Agents concepts instead of an application-specific memory taxonomy.

## Goal

An agent should remember useful information across conversations without forcing the user to repeat it, while keeping context size, LLM calls, cost, and user control predictable.

The system must make four different forms of context explicit:

1. Agent identity and instructions
2. Current conversation state
3. Curated long-term memory
4. Past conversations

These forms of context must not be stored or presented as if they were the same thing.

The practical acceptance tests are:

- If the user says "remember that I prefer concise answers", the information is available in later threads.
- If the user asks "what did we discuss in the previous thread?", the agent can search past conversations without treating the conversation as a saved user fact.
- Starting an ordinary conversation does not load every historical thread or every saved note.
- The user can inspect, add, edit, pin, unpin, and delete long-term memory through UI, API, and CLI.
- Memory remains local-first under `.assistant-data`.

## Sources And Alignment

The architecture follows these primary references:

- [LangChain memory concepts](https://docs.langchain.com/oss/javascript/concepts/memory)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Deep Agents memory](https://docs.langchain.com/oss/javascript/deepagents/memory)
- [Deep Agents backends](https://docs.langchain.com/oss/javascript/deepagents/backends)
- [OpenClaw memory overview](https://docs.openclaw.ai/concepts/memory)
- [Hermes persistent memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md)

LangGraph separates thread-scoped state persisted by a checkpointer from cross-thread information persisted in a store. Deep Agents builds long-term memory on persistent files and backends. OpenClaw and Hermes both use human-readable files as the durable memory source and keep conversation/session history separate.

## Core Principles

### Use Framework Concepts

Use LangGraph checkpointing for conversation state and Deep Agents memory files/backends for long-term memory. Do not create new memory types or lifecycle concepts unless they produce real, tested behavior.

### Files Are The Durable Memory Source

Long-term memories are stored as readable Markdown. Search indexes and embeddings are derived data that can be rebuilt; they are never the only copy of a memory.

### Keep Startup Memory Bounded

Only small pinned memory documents are loaded into the initial prompt. A configurable character or token budget prevents persistent memory from silently making every LLM call larger.

When the pinned-memory budget is full, a write must fail clearly. The system must not silently truncate or delete entries. The user or agent can consolidate, unpin, or remove entries before retrying.

### Read Other Memory On Demand

Unpinned long-term memory is not injected automatically. The agent reads or searches it only when the current request makes earlier information relevant.

### Keep Conversation Recall Separate

Past threads are episodic history, not user memory. They are retrieved through thread search and thread history, not through the long-term memory files.

### Avoid Automatic LLM Work Initially

The first implementation does not run hidden memory extraction, consolidation, expiration, or thread-summary LLM calls. Explicit writes and normal agent tool decisions are sufficient for the first phase.

## Context Layers

### 1. Agent Identity

Current file:

```text
.assistant-data/agents/<agent-id>/configuration/soul.md
```

`soul.md` answers:

> Who is this agent?

It contains identity, role, personality, operating principles, and boundaries. It is intentionally editable by the user, but it is not a diary or general memory file.

Agent task instructions that should be separately manageable may later move to an agent-specific `AGENTS.md`. That decision is independent of long-term user memory.

### 2. Skills

Skills are procedural context:

> How should the agent perform a particular kind of work?

They remain under the Deep Agents skills system and are loaded on demand. Skills are not user memories and are usually developer-controlled.

### 3. Current Thread

The current thread is short-term, thread-scoped memory. It contains messages and graph state required to continue one conversation.

Use the official SQLite LangGraph checkpointer:

```text
@langchain/langgraph-checkpoint-sqlite
```

The checkpointer provides persistent Deep Agents state across backend restarts. The application may keep a read model for efficient UI thread listing, but it must not reimplement checkpoint semantics.

### 4. Curated Long-Term Memory

Long-term memory contains concise information useful across threads, such as:

- user preferences
- user-provided facts
- agent-specific working agreements
- durable environment or project facts learned by an agent

It does not contain:

- raw conversation transcripts
- thread summaries
- agent identity
- skills
- credentials or secrets
- transient tool output
- reminders or scheduled jobs

### 5. Past Conversations

Past conversations are persisted threads. They are searched only when the user asks about previous conversations or when the agent has a concrete reason to inspect prior work.

Deep Agents documents this as episodic memory backed by checkpointed threads and exposed through a thread-search tool. rdma26 should follow that model.

Conversation summaries, if later introduced for compaction or search optimization, remain thread metadata. They do not become long-term memory entries and are deleted with their thread.

## Long-Term Memory Scopes

rdma26 has one user today but supports multiple agents. Memory files therefore use three scopes.

### Global User Memory

Information every memory-enabled agent may use.

```text
.assistant-data/user/memory/
```

Examples:

- general communication preferences
- stable personal facts the user explicitly wants shared

Structured profile settings such as timezone, locale, language, and date format remain in the user profile database. They must not be duplicated into memory files.

### Agent-Local User Memory

Information about the user that applies only to one agent relationship.

```text
.assistant-data/agents/<agent-id>/memory/user/
```

Example:

- the user wants one agent to answer in German while another agent answers in English

### Agent Memory

Knowledge or working agreements belonging to one agent.

```text
.assistant-data/agents/<agent-id>/memory/agent/
```

Examples:

- environment facts learned by a development agent
- stable conventions relevant only to one specialist agent

The backend mounts these directories through Deep Agents backends so the agent sees stable virtual memory paths independent of the host filesystem layout.

## Pinned And On-Demand Memory

Pinning controls prompt inclusion; it is not a memory type.

### Pinned Memory

Pinned entries are stored in bounded Markdown documents mounted as Deep Agents memory files and supplied through `createDeepAgent({ memory: [...] })`.

Pinned memory is loaded at the beginning of every applicable thread or run. Pinning should be used sparingly for information that must consistently affect behavior.

Examples:

- Always answer this user in German.
- Use Europe/Berlin when presenting local times.

### On-Demand Memory

Unpinned entries are stored as Markdown outside the startup memory list. Deep Agents can inspect them through its filesystem tools when needed.

The first implementation uses local file search and direct reads. It does not require embeddings or an additional LLM request.

If the collection later becomes too large for effective file search, rdma26 may add a rebuildable hybrid keyword/vector index. That is a later retrieval optimization, not part of the memory source model.

## Memory Operations

The same backend memory service is used by UI, API, CLI, and controlled agent tools.

Required operations:

- list memory entries by scope and agent
- read an entry
- add an entry
- replace an entry
- remove an entry
- pin an entry
- unpin an entry
- inspect current pinned-memory budget

An entry contains concise Markdown content plus application metadata needed for UI and source attribution. Metadata must not introduce speculative concepts such as lifetime, open-task state, or tracked-topic behavior.

## Write Rules

### Explicit User Requests

If the user says "remember this", the agent should save it when memory writing is enabled.

The agent asks a clarifying question when scope is ambiguous:

- remember for this agent
- remember about the user only for this agent
- remember globally for all agents

### Automatic Writes

Automatic hot-path writes may remain supported for clearly useful, low-risk information, but the behavior must be conservative and visible. Automatically inferred entries are unpinned.

Ask before saving when information is sensitive, ambiguous, conflicting, or likely to strongly affect future behavior.

Never save credentials, secrets, payment data, raw long conversations, private third-party information, or information the user asks not to remember.

### Background Consolidation

Not included in the first implementation.

Deep Agents documents a separate consolidation agent as an advanced option. It requires additional LLM calls and should be considered only after explicit memory behavior has been evaluated with real usage.

## Retrieval Rules

For a normal chat run:

1. Load `soul.md` and applicable skills metadata.
2. Restore the current thread through the LangGraph checkpointer.
3. Load applicable bounded pinned memory files.
4. Do not load unpinned memory or previous threads automatically.
5. Let the agent search memory files or past threads when the request requires them.

This keeps static prompt content stable, supports provider prompt caching, and avoids an embedding call for every user message.

## Past-Conversation Search

Provide a controlled tool with two stages:

1. Search or list candidate threads using agent, date, title, and text criteria.
2. Read bounded history from selected threads.

The tool must not dump all historical messages into context. It returns compact search results first and fetches details only for selected threads.

The deterministic first implementation can use SQLite text search. Optional summaries or semantic thread search can be evaluated later.

Deleting a thread deletes its checkpoints, messages, run contexts, and any derived thread-search data. No orphaned thread summaries or indexes may remain.

## Compaction

Compaction manages an oversized current thread. It is not long-term memory creation.

When introduced, compaction may summarize older messages within one thread while retaining the original stored conversation. Compaction output belongs to checkpointed thread state and is deleted with the thread.

## Permissions

Each agent keeps explicit memory permissions:

```json
{
  "memory": {
    "canRead": true,
    "canWrite": true
  }
}
```

Rules:

- Read permission controls access to long-term memory files and memory tools.
- Write permission controls add, replace, remove, pin, and unpin operations.
- Global user-memory writes require an explicit user request or confirmation.
- Normal agents cannot inspect another agent's private memory.
- Scotty can manage all memory through controlled operator tools and normal confirmation rules.

## User Control And Transparency

UI, API, and CLI provide equivalent access to the backend memory service.

The user-facing Memories page shows:

- Global user memory
- Agent-local user memory
- Agent memory
- Pinned state
- Content and source
- Created and updated timestamps
- Pinned-memory budget

It does not show conversation summaries as memories.

Run inspection records which pinned files and on-demand memory/thread reads contributed to an answer. Normal chat remains uncluttered unless the user opens run details.

## Storage And Indexing

### Source Of Truth

Markdown files under `.assistant-data` are the source of truth for long-term memory.

### Checkpoints

The official LangGraph SQLite checkpointer stores thread state locally.

### Application Database

The rdma26 SQLite database may store UI metadata, source references, and searchable projections, but it must not define a second competing copy of memory content.

### Search Index

No embedding index is required in phase 1. A future index must be:

- rebuildable from memory files
- configurable by provider and model
- observable for embedding calls and cost
- optional, with deterministic lexical search available

## Migration From The Current Implementation

The current custom `memory_records` system is replaced rather than preserved as a compatibility layer.

Migration work includes:

1. Remove custom fact/preference/conversation-summary/open-task/tracked-topic types.
2. Remove automatic prompt-time lexical and embedding retrieval.
3. Remove the JSON embedding cache.
4. Move conversation summaries out of long-term memory and then remove automatic thread-summary generation for phase 1.
5. Add the official persistent SQLite checkpointer.
6. Configure Deep Agents memory files and scoped backends.
7. Replace memory CRUD with file-backed entry operations and pinned-budget enforcement.
8. Add bounded past-thread search as a separate capability.
9. Update UI, API, CLI, run context, documentation, and tests.
10. Remove obsolete SQLite memory tables through an explicit migration after file migration or confirmed deletion.

Existing development memory data may be deleted; backward compatibility is not required at this stage. Threads and messages must be preserved.

## Implementation Phases

### Phase 1: Persistence Foundation

- Install and configure `@langchain/langgraph-checkpoint-sqlite`.
- Persist Deep Agents thread state across backend restarts.
- Keep existing user-visible threads and messages working.

### Phase 2: Deep Agents Memory Files

- Add scoped global, agent-user, and agent memory directories.
- Mount them through Deep Agents backends.
- Add bounded pinned memory files to `createDeepAgent({ memory: [...] })`.
- Add controlled file-backed memory operations.

### Phase 3: Product Surfaces

- Update UI, API, and CLI for the simplified memory model.
- Show scope, pinned state, source, timestamps, and budget.
- Remove memory types, statuses, maintenance, and conversation summaries from the Memories page.

### Phase 4: Past-Conversation Search

- Add candidate thread search.
- Add bounded thread-history reads.
- Record thread-search activity in run context.

### Phase 5: Cleanup And Evaluation

- Remove the custom memory table, embedding cache, retrieval scoring, and summary maintenance.
- Measure prompt size, extra tool calls, recall quality, and cost.
- Add semantic or hybrid indexing only if evaluation shows deterministic file/thread search is insufficient.

## Non-Goals For The First Implementation

- No automatic expiration.
- No memory lifetime classification.
- No open-task or tracked-topic memory types.
- No hidden background memory agent.
- No automatic thread-summary LLM call.
- No vector database.
- No embedding request for every chat message.
- No automatic memory graph or knowledge wiki.
- No compatibility layer for unused development memory records.

## Completion Criteria

The replacement is complete when:

- restarting the backend preserves Deep Agents thread state,
- pinned memories consistently appear in applicable new threads,
- unpinned memory is read only on demand,
- global and agent-specific scopes are isolated correctly,
- previous-conversation questions use thread search rather than normal memory records,
- deleting a thread removes all thread-owned state,
- memory can be managed through UI, API, CLI, and controlled tools,
- run inspection explains which memory and thread sources were used,
- no obsolete custom retrieval or summary-maintenance code remains,
- tests cover persistence, scoping, pinning, permissions, deletion, and context bounds.

## Open Questions

No open product questions currently block implementation. Concrete path names and pinned-memory budgets may be selected conservatively during implementation and documented with their defaults.
