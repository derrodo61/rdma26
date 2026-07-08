# Changelog

All notable project changes are tracked here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned release sections will be added when the project starts tagging releases.

## [Unreleased]

### Added

- Added local-first long-term memory records with scope, type, status, lifetime, tags, and source metadata.
- Added memory CRUD through backend API endpoints and CLI commands.
- Added a memory settings page for listing, creating, editing, archiving, restoring, and deleting memories.
- Added a `save_memory` agent tool and prompt injection of relevant active memories for chat runs.
- Added one-time per-thread `conversation_summary` memory creation through manual and scheduled maintenance.
- Added recall-aware memory retrieval so new-thread questions about previous conversations include recent conversation summaries.
- Added optional OpenAI embedding-backed semantic memory ranking with a local cache and lexical fallback.
- Added manual thread-summary consolidation through the API, CLI, and chat UI.
- Added LLM-backed thread-summary consolidation when OpenAI is configured.
- Removed local compact transcript summaries; if no summary LLM is available, no summary is created.
- Added bulk missing thread-summary creation through the API, CLI, and memory settings UI.
- Added visible memory maintenance through the API, CLI, and memory settings UI, with reports for skipped agents and empty threads.
- Added optional scheduled memory maintenance with persistent settings exposed through the API, CLI, and memory settings UI.
- Updated the agent bootloader prompt so disabled memory writes no longer instruct agents to use `save_memory`.
- Added source-thread links for memories that were created from a conversation thread.
- Added a run-context inspector page for viewing the memories, messages, tools, profile snapshot, and `soul.md` used by a chat run.
- Expanded run-context snapshots with prompt, assistant response, thread title, memory metadata/source, and tool labels/providers.
- Added run-context capture and display for tool calls, tool results, and token usage when returned by the agent runtime.
- Added per-agent memory write permissions through backend, CLI, and the agent edit UI.
- Added controlled Scotty tools for memory inspection, memory management, and memory-write permissions.
- Added persisted run-context details with API and CLI inspection.
- Added direct server tests for the memory store.
- Added general `internet_search` prompt guidance and search-result quality hints for current facts, follow-up searches, recency checks, and uncertainty handling.
- Added a safe `read_web_page` tool so agents can inspect public source pages after search before answering.
- Added generic verification guidance for precise current-list questions so search-enabled agents verify each requested item before answering.
- Improved `read_web_page` extraction with parser-based article/main-content cleanup instead of regex-only HTML stripping.
- Moved run-context files into per-agent `runs` folders and delete a thread's run contexts when the thread is deleted.
- Added startup cleanup for orphaned run-context files whose threads no longer exist.
- Tightened search/page-read guidance so precise current-list and current-result answers should not rely on snippets alone when source-page reading is available.
- Updated `read_web_page` to prefer Tavily Extract when `TAVILY_API_KEY` is configured, with local extraction as fallback.
- Changed `read_web_page` extraction failures, including 403 responses, to return structured warnings instead of aborting the agent run.
- Added a high-level `research` capability with structured findings, sources, searches, unresolved items, and run-context source affordances.
- Reworked `research` to follow Deep Agents subagent concepts: enabling it now attaches a `researcher` subagent to the domain agent, and the domain agent delegates through the built-in `task` tool instead of calling a wrapper tool.
- Added live `run-activity` streaming events from Deep Agents tool and subagent activity, and show the current activity in the chat UI while a run is active.
- Added agent visibility metadata (`kind` and `chatEnabled`) so future internal capability agents can stay hidden from the normal chat selector.
- Updated agent bootloader guidance to prefer `research` over low-level `internet_search` and `read_web_page` workflows when available.
- Added a compact chat UI source affordance for the latest research-backed run.
- Added persisted last-used agent selection in the synced user profile so the chat page reopens with the previously selected agent.
- Added stricter research-agent guardrails for latest/current temporal ordering, claim-status nuance, and contradiction warnings.
- Added current date/time context to researcher subagents so relative-date questions such as "today" and "heute" are resolved before searching.
- Added latest thread run-context lookup so source links and run inspection are restored after reloading an existing chat thread.
- Added per-message source controls so research sources are shown next to the assistant answer they support instead of only for the latest thread run.
- Added adaptive research search guidance so researcher subagents can stop early on strong evidence or escalate to local-language and regional sources when broad results are weak.
- Changed web page DNS/URL validation failures to return structured reader warnings instead of aborting chat runs.
- Changed thread-summary consolidation to return an existing summary instead of regenerating it, and added readable `contentLines` for multiline memory JSON files.
- Changed `save_memory` so agents can save agent, agent-user, or global user memories, and may save sensitive personal data when the user explicitly asks for it.
- Tightened memory-scope guidance so per-agent interaction preferences are saved as `agent_user` unless the user clearly wants a global preference.
- Added a best-effort new-thread trigger that creates a one-time summary for the previous latest non-empty thread when summary creation is available.
- Added a phased SQLite storage plan and moved memory records to `.assistant-data/rdma26.sqlite`, with one-time import of legacy JSON memory files.
- Added memory browsing filters for lifetime, tag, and created/updated date ranges across the API, CLI, and memory settings UI.
- Moved thread and message records to `.assistant-data/rdma26.sqlite`, with one-time import of legacy per-agent thread JSON files.
- Updated orphaned run-context cleanup and agent deletion to use SQLite-backed thread, memory, and run-context ownership.
- Moved run-context records to `.assistant-data/rdma26.sqlite`, with one-time import of legacy global and per-agent run-context JSON files.
- Changed SQLite migration cleanup so imported JSON memory, thread, and run-context files are removed after successful import.
- Removed the legacy `verify_current_facts` compatibility tool and its dedicated planner/verifier model overrides; `research` is now the single high-level current-facts research capability.

## [2026-07-06]

### Added

- Added dynamic per-agent tool assignment through the backend API, CLI, and agent edit UI.
- Added the first registered tool, `internet_search`, backed by Tavily when `TAVILY_API_KEY` is configured.
- Added persistent `enabledTools` to agent profiles, including migration for existing agents.
- Added generated OpenAPI documentation from Zod-derived route schemas at `/api/openapi.json` and Swagger UI at `/docs`.
- Added a backend-synced user profile for name, timezone, locale, language, date/time display settings, theme, and per-agent UI settings.
- Added user profile date/time preferences to the agent bootloader prompt so agents can answer with the configured timezone and regional format.
- Added Markdown rendering for assistant chat messages.
- Added agent `soul.md` editing through the backend API, CLI, and agent edit UI with Markdown preview.
- Added a Markdown formatting toolbar with heading-level choices for the agent `soul.md` editor.
- Added `Scotty` as the protected operator agent with id `scotty` and controlled admin tools for agent and tool-grant management.
- Added read-only UI/API/CLI visibility for controlled operator tools.
- Added a memory system specification with rules for automatic memory writes, global/user-local memory, lifecycle handling, context transparency, permissions, and protected operator memory management.
- Added a user profile settings page accessible from the settings menu.
- Added `profile:read`, `profile:update`, and `profile:agent-model:set` CLI commands.
- Added light, dark, and system theme support.
- Added dedicated API and CLI reference docs in `docs/api.md` and `docs/cli.md`.
- Added source-available license documentation for public publishing.

### Changed

- Moved agent `soul.md` from Deep Agents memory into per-agent `configuration/soul.md` and clarified that it stores identity, not arbitrary memories.
- Removed default-agent compatibility routes and legacy data migration in favor of the built-in `scotty` operator agent id.
- Reworked the agent edit page into wider Basic, Tools, and Soul tabs.
- Refined the chat layout with a collapsible sidebar, inline model selector, rounded composer, and simplified message styling.
- Slimmed down the README so it stays focused on project overview, setup, and links to reference docs.
- Organized the changelog in Keep a Changelog style.

## [Initial development] - 2026-07-05

### Added

- Initialized `rdma26` as a local-first Angular and Fastify personal multi-agent assistant.
- Added OpenAI model selection, per-agent localStorage model preference, and agent-specific conversation threads.
- Added local Deep Agents filesystem memory with per-agent `soul.md`.
- Added basic single-user username/password authentication.
- Added first-class CLI support backed by the same runtime as the API endpoints.
- Added agent management: create, edit display name, delete, and isolate related threads and memory data.
- Added thread deletion with frontend confirmation.
