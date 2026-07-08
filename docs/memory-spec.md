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

It can change when the user intentionally changes the agent's identity, role, or operating principles.

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

### User Configuration

Belongs to the user and can be useful to all agents.

Example:

```text
.assistant-data/user/configuration/user.md
```

Use for stable user basics and global preferences such as name, language, timezone, date/time format, and general communication style.

This file answers:

> What should all agents know about the user?

### Agent-Local User Memory

Belongs to one agent and describes what that agent has learned about the user in that agent's own context.

Example:

```text
.assistant-data/agents/agent1/memories/user.md
```

Use for user information that matters to one agent but should not automatically be shared with all agents.

This file answers:

> What does this agent know about the user in this agent's context?

Example:

```md
# User Memory

- The user wants this agent to track games.
- The user prefers match times in Europe/Berlin.
- The user cares about national-team games more than club games.
```

This should stay separate from `configuration/soul.md`. `soul.md` can be edited, but it should not become a diary.

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

In the first implementation, this should happen directly in chat. If the user confirms, the memory is saved. If the user declines, it is not saved.

Do not add separate approval states in the first implementation. States such as `suggested`, `accepted`, and `rejected` may be useful later if background consolidation creates a review queue, but they should not be required for phase 1.

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

The first implementation exposes this as visible memory maintenance instead of a hidden daemon. The user can trigger it manually from the UI, API, or CLI, inspect the report, and see which agents or empty threads were skipped.

Scheduled maintenance is available but disabled by default. The user can enable it from the UI, API, or CLI, choose the interval, and decide whether it should run for one agent or all agents.

## Read Rules

Memory should not all be loaded into every prompt.

The read flow should be:

1. Always load `soul.md`.
2. Load current thread messages.
3. Search relevant long-term memories for the current prompt.
4. Inject only the most relevant memory snippets into the run.
5. Tell the agent where the snippets came from.

## Context Transparency

The system should record which context sources were used for each run.

This should not be shown inline in every assistant answer by default. Normal chat should stay clean.

Instead, UI, API, and CLI should later expose optional run details that answer:

> What did the agent know when it answered?

Run details may include:

- agent id and display name
- selected model
- loaded `soul.md`
- loaded user configuration
- loaded agent-local memories
- loaded global memories
- included thread messages
- available tools
- used tools
- memory retrieval scores
- token counts

This is useful for debugging, improving memory quality, and understanding surprising answers.

## Memory Lifecycle

Memories should be kept by default. They should not expire just because they are old.

Some old memories remain important, such as stable user preferences, long-term goals, recurring projects, important decisions, and agent-specific working agreements.

Memories should expire, be archived, or be replaced only when they are temporary, completed, contradicted, superseded, or no longer useful.

Future memory records should support lifecycle fields such as:

- `lifetime`: `permanent`, `active`, or `temporary`
- `status`: `active`, `archived`, or `superseded`

Examples:

- Permanent: "The user prefers plain language."
- Active: "The user wants agent1 to track the current tournament."
- Temporary: "The user wants updates about today's game."
- Superseded: "The user prefers English" replaced by "The user prefers German."
- Archived: "On 2026-07-07, the user and agent1 discussed the first memory concept."

Phase 1 should keep memories by default and support manual delete or archive. Later phases can add stronger lifecycle rules.

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

## Memory Permissions

Memory writes should be allowed by default for all agents, at least for agent-local memory.

Each agent should have a setting that can disable memory writes.

Example future configuration:

```json
{
  "memory": {
    "canWrite": true
  }
}
```

Possible later extension:

```json
{
  "memory": {
    "canRead": true,
    "canWrite": true,
    "canWriteUserGlobal": false,
    "canWriteAgentLocal": true
  }
}
```

Rules:

- Agents can read relevant memory by default.
- Agents can write agent-local memory by default.
- The user can turn memory writing off per agent through UI, API, and CLI.
- Writing global user memory should be more controlled than writing agent-local memory.
- If memory writing is disabled, the agent may say that it would remember something, but memory writing is disabled.

## Operator Memory Management

The protected operator agent should be able to inspect and manage memory for all agents.

Every installation creates this protected operator agent with id `scotty` and display name `Scotty`.

This should be treated as controlled admin functionality, not normal agent behavior.

The operator agent may support actions such as:

- list memories for an agent
- read memories for an agent
- search memories across agents
- edit or delete incorrect memories
- archive or supersede old memories
- inspect memory permissions
- enable or disable memory writes for an agent

Guardrails:

- The operator agent must clearly explain memory changes.
- Destructive actions should require confirmation.
- The protected operator agent cannot bypass backend rules.
- Normal agents should not automatically gain cross-agent memory access.

## Storage Direction

The design should stay compatible with LangChain and LangGraph.

First implementation can be local-first under `.assistant-data`, but the concepts should map cleanly to LangGraph stores:

- namespace: user, agent, or shared scope
- key: memory id
- value: structured memory object
- optional semantic index for ranking relevant memories

Possible future backends:

- local JSON files
- SQLite
- LangGraph Store
- Postgres Store
- external vector store for larger semantic search indexes

## First Implementation Phase

The first phase should be small and visible.

Implemented first scope:

- agent-scoped memories
- explicit save only
- local file storage
- API and CLI support
- UI list/read/create/edit/archive/delete
- UI source links back to the originating thread when memory source metadata contains a thread id
- UI run-context inspection for the memories, messages, tools, profile snapshot, and `soul.md` used by a chat run
- run-context metadata for the prompt, assistant response, thread title, memory tags/source/lifetime/status, and tool labels/providers
- run-context tool-call/result and token-usage capture when the Deep Agents response includes that metadata
- simple lexical retrieval for chat runs
- recall-aware retrieval for previous-conversation questions
- optional OpenAI embedding-backed semantic ranking for chat-run memory retrieval, with lexical recall as the fallback
- local embedding cache under `.assistant-data/memory-index`
- `save_memory` tool for agents
- automatic per-thread `conversation_summary` memory upsert after chat runs
- LLM-generated thread summaries for cross-thread recall
- manual thread-summary consolidation through UI, API, and CLI
- no local compact transcript fallback; if no summary LLM is available, no summary is created
- bulk thread-summary refresh through UI, API, and CLI
- visible manual memory maintenance through UI, API, and CLI, with per-agent reports and disabled-write skips
- optional scheduled memory maintenance through UI, API, and CLI, disabled by default
- per-agent memory write permission through UI, API, and CLI
- controlled Scotty tools for memory inspection, memory management, and memory-write permissions
- prompt-level memory-write guidance that matches whether `save_memory` is available in the current run
- run-context transparency endpoint and CLI command

Future backend option:

- An external vector database can be added later if the local memory store plus local embedding cache is no longer enough.

This gives the user control and lets us learn what memory should feel like before adding automatic behavior.

## Open Questions

No open questions yet.
