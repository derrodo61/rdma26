# Changelog

All notable project changes are tracked here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned release sections will be added when the project starts tagging releases.

## [Unreleased]

### Added

- Added local-first long-term memory records with scope, type, status, lifetime, tags, and source metadata.
- Added memory CRUD through backend API endpoints and CLI commands.
- Added a memory settings page for listing, creating, editing, archiving, restoring, and deleting memories.
- Added a `save_memory` agent tool and prompt injection of relevant active memories for chat runs.
- Added automatic per-thread `conversation_summary` memory upserts after chat runs.
- Added recall-aware memory retrieval so new-thread questions about previous conversations include recent conversation summaries.
- Added optional OpenAI embedding-backed semantic memory ranking with a local cache and lexical fallback.
- Added manual thread-summary consolidation through the API, CLI, and chat UI.
- Added LLM-backed thread-summary consolidation when OpenAI is configured.
- Removed local compact transcript summaries; if no summary LLM is available, no summary is created.
- Added bulk thread-summary refresh through the API, CLI, and memory settings UI.
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
- Added general `internet_search` prompt guidance for current facts, follow-up searches, recency checks, and uncertainty handling.

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
