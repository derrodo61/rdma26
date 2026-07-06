# Memory System

This document defines the memory goal for `rdma26` and the first design direction for reaching it.

## Goal

`rdma26` agents should remember important information across conversations without requiring Rolf to repeat himself.

Memory must make an agent feel continuous over time, but it must not become an invisible black box. Rolf must be able to see, understand, edit, and delete what an agent remembers.

The memory system should work for all agents, not only one special agent. Ronaldo, Mina, Scotty, and future agents should all use the same memory concepts.

The system should support these user expectations:

- If Rolf explicitly says "remember this", the agent should save it.
- If a conversation contains something clearly useful for the future, the agent may suggest saving it or a background process may extract it.
- If Rolf starts a new thread, the agent should be able to recall relevant past facts, preferences, open tasks, and important conversation summaries.
- The agent should not load all old conversations into the prompt.
- The agent should retrieve only memory that is relevant to the current conversation.
- Rolf should be able to inspect and correct memory from the UI, API, and CLI.
- Memory should remain local-first and stored under `.assistant-data` unless Rolf explicitly chooses another backend.

The practical test is simple:

> If Rolf asks Ronaldo in a new thread, "What did we talk about last time?", Ronaldo should be able to answer from saved memory, not pretend the relationship starts from zero.

## Non-Goals

- Do not store every full conversation as always-loaded prompt context.
- Do not use `soul.md` as a general memory dump.
- Do not hide memory in a place Rolf cannot inspect.
- Do not make memory agent-specific only if the remembered information clearly belongs to the user globally.

## LangChain Model

The memory system should follow LangChain and LangGraph terminology as closely as possible.

Useful references:

- [LangChain memory concepts](https://docs.langchain.com/oss/javascript/concepts/memory)
- [LangGraph long-term memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory#add-long-term-memory)
- [Deep Agents memory](https://docs.langchain.com/oss/javascript/deepagents/memory)
- [Deep Agents production memory configuration](https://docs.langchain.com/oss/javascript/deepagents/going-to-production#configuration)

Mapping to `rdma26`:

| LangChain term    | rdma26 meaning                                                     |
| ----------------- | ------------------------------------------------------------------ |
| Short-term memory | Current thread messages and thread state                           |
| Long-term memory  | Information available across threads                               |
| Semantic memory   | Facts and preferences                                              |
| Episodic memory   | Summaries of past events, conversations, and outcomes              |
| Procedural memory | Agent instructions, skills, and `soul.md`                          |
| Store namespace   | Scope such as user, agent, or shared memory                        |
| Semantic search   | Finding relevant memories by meaning instead of loading everything |

## soul.md

`soul.md` is identity, not memory.

It answers:

> Who is this agent?

It may contain:

- agent role
- personality
- operating principles
- stable behavior rules
- boundaries

It should not contain:

- arbitrary conversation notes
- game results
- task progress
- temporary facts
- large summaries

Current path:

```text
.assistant-data/agents/<agent-id>/configuration/soul.md
```

## Memory Scopes

Memory should support multiple scopes.

### Agent Memory

Belongs to one agent.

Example:

```text
.assistant-data/agents/ronaldo/memories/
```

Use for things Ronaldo should remember, but Mina should not automatically know.

### User Memory

Belongs to Rolf and can be useful to all agents.

Example:

```text
.assistant-data/user/memories/
```

Use for general preferences, profile facts, language style, timezone expectations, and recurring personal context.

### Shared/System Memory

Optional later.

Example:

```text
.assistant-data/shared/memories/
```

Use for project-wide or system-wide knowledge that multiple agents may need.

## Memory Types

The first memory model should support these types.

### Fact

A durable statement that may be useful later.

Example:

> Rolf wants Ronaldo to track Brazil vs Norway.

### Preference

Something Rolf likes, dislikes, or expects.

Example:

> Rolf prefers plain language explanations.

### Conversation Summary

A short summary of an important conversation or thread.

Example:

> On 2026-07-07, Rolf and Ronaldo discussed tracking World Cup game results.

### Open Task

Something still active.

Example:

> Ronaldo should check the final score of Brazil vs Norway later.

### Tracked Topic

A subject that may receive updates over time.

Example:

> World Cup 2026 games.

## Write Rules

Memory can be written in different ways.

### Explicit Save

If Rolf says "remember this", the agent should save it.

This is the safest first feature.

### Suggested Save

If the agent notices something likely worth remembering, it can ask:

> Should I remember this for future conversations?

### Background Consolidation

A background process can review recent threads and extract useful memories.

This should come later because it requires careful rules and user visibility.

## Read Rules

Memory should not all be loaded into every prompt.

The read flow should be:

1. Always load `soul.md`.
2. Load current thread messages.
3. Search relevant long-term memories for the current prompt.
4. Inject only the most relevant memory snippets into the run.
5. Tell the agent where the snippets came from.

## User Control

Memory must be inspectable and editable.

The UI, API, and CLI should eventually support:

- list memories
- read one memory
- create memory
- edit memory
- delete memory
- search memories
- show memory source thread
- show memory scope and type

Memory should not be treated as secret internal state.

## Storage Direction

The design should stay compatible with LangChain and LangGraph.

First implementation can be local-first under `.assistant-data`, but the concepts should map cleanly to LangGraph stores:

- namespace: user, agent, or shared scope
- key: memory id
- value: structured memory object
- optional semantic index later

Possible future backends:

- local JSON files
- SQLite
- LangGraph Store
- Postgres Store
- vector store for semantic search

## First Implementation Phase

The first phase should be small and visible.

Suggested first scope:

- agent-scoped memories
- explicit save only
- local file storage
- API and CLI support
- simple UI list/read/delete
- no automatic background summarization yet
- no embeddings yet

This gives Rolf control and lets us learn what memory should feel like before adding automatic behavior.

## Open Questions

- Should agents save memories automatically, or always ask first?
- Should there be global user memory shared by all agents from the beginning?
- Should memory have approval states, such as suggested, accepted, and rejected?
- Should memories expire?
- Should the agent show which memories it used in an answer?
- Should memory writes be allowed for all agents or controlled per agent?
- Should Scotty be able to inspect and manage memory for all agents?
