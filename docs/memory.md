# Memory System

This document defines the memory goal for `rdma26` and the first design direction for reaching it.

## Goal

`rdma26` agents should remember important information across conversations without requiring the user to repeat themselves.

Memory must make an agent feel continuous over time, but it must not become an invisible black box. The user must be able to see, understand, edit, and delete what an agent remembers.

The memory system should work for all agents, not only one special agent. Existing and future agents should all use the same memory concepts.

The system should support these user expectations:

- If the user explicitly says "remember this", the agent should save it.
- If a conversation contains something clearly useful for the future, the agent may suggest saving it or a background process may extract it.
- If the user starts a new thread, the agent should be able to recall relevant past facts, preferences, open tasks, and important conversation summaries.
- The agent should not load all old conversations into the prompt.
- The agent should retrieve only memory that is relevant to the current conversation.
- The user should be able to inspect and correct memory from the UI, API, and CLI.
- Memory should remain local-first and stored under `.assistant-data` unless the user explicitly chooses another backend.

The practical test is simple:

> If the user asks an agent in a new thread, "What did we talk about last time?", the agent should be able to answer from saved memory, not pretend the relationship starts from zero.

## Non-Goals

- Do not store every full conversation as always-loaded prompt context.
- Do not use `soul.md` as a general memory dump.
- Do not hide memory in a place the user cannot inspect.
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
.assistant-data/agents/agent1/memories/
```

Use for things one agent should remember, but another agent should not automatically know.

### User Memory

Belongs to the user and can be useful to all agents.

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

> The user wants agent1 to track a specific game.

### Preference

Something the user likes, dislikes, or expects.

Example:

> The user prefers plain language explanations.

### Conversation Summary

A short summary of an important conversation or thread.

Example:

> On 2026-07-07, the user and agent1 discussed tracking game results.

### Open Task

Something still active.

Example:

> agent1 should check the final score of a tracked game later.

### Tracked Topic

A subject that may receive updates over time.

Example:

> Upcoming games in a tournament.

## Write Rules

Memory can be written in different ways.

General rule:

> Agents may save memories automatically when the value is clear and the risk is low. They must ask when the content is sensitive, ambiguous, conflicting, or unclear in scope. The user can explicitly ask an agent to save something at any time.

### Explicit Save

If the user says "remember this", the agent should save it.

This should always be supported. Even when automatic memory exists, the user must be able to directly tell an agent what to save.

### Automatic Save

Agents should save automatically when all of these are true:

- The information is likely useful in future conversations.
- The information is not obviously sensitive.
- The information has a clear type, such as fact, preference, open task, conversation summary, or tracked topic.
- The information has a clear scope, such as this agent or global user memory.
- The information is not just temporary chat noise.
- The information does not silently contradict an existing memory.

Examples:

- The user says they prefer German for football answers.
- The user asks agent1 to track a specific game.
- The user explains that an agent has a stable purpose.
- A conversation produced an important decision or open task.

### Suggested Save

If the agent notices something likely worth remembering, it can ask:

> Should I remember this for future conversations?

Agents should ask before saving when one of these is true:

- The information is sensitive.
- The agent is unsure whether the information matters.
- The agent is unsure where the memory belongs.
- The memory might strongly affect future behavior.
- The memory conflicts with an older memory.
- The user sounded uncertain, speculative, or temporary.

Examples:

- "Should I remember this only for agent1 or for all agents?"
- "Should I save this as a task or just as a note?"
- "This seems sensitive. Do you want me to remember it?"

### Never Save Automatically

Agents should not automatically save:

- passwords, API keys, tokens, or credentials
- payment details
- sensitive health, financial, or legal information
- private third-party information
- raw long conversations
- casual comments that are probably temporary
- anything the user explicitly says not to remember

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

This gives the user control and lets us learn what memory should feel like before adding automatic behavior.

## Open Questions

- Should there be global user memory shared by all agents from the beginning?
- Should memory have approval states, such as suggested, accepted, and rejected?
- Should memories expire?
- Should the agent show which memories it used in an answer?
- Should memory writes be allowed for all agents or controlled per agent?
- Should a protected operator agent be able to inspect and manage memory for all agents?
