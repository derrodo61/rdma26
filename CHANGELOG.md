# Changelog

All notable project changes are tracked here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned release sections will be added when the project starts tagging releases.

## [Unreleased]

### Added

- Added an assignable Deep Agents QuickJS interpreter capability for isolated calculations and deterministic structured-data transformations without host filesystem, network, shell, package, credential, or clock access.
- Added a versioned agent-evaluation harness with isolated temporary agents, direct, research, calculation, uncertainty, memory, and conversation cases, automatic assertions, human-review gates, CLI execution, and persisted baseline reports covering calls, tokens, context size, costs, and latency.
- Added an authoritative product vision, current architecture overview, and documentation index that separate implemented behavior from long-term direction.
- Added current-state storage, research, and observability references with explicit implementation boundaries and known limitations.
- Added persistent Deep Agents thread state through the official LangGraph SQLite checkpointer.
- Added scoped Markdown memory files for global user, agent-local user, and agent memory, mounted through Deep Agents backends.
- Added bounded pinned startup memory and on-demand access to unpinned memory files.
- Added controlled, bounded search and read tools for previous conversations, separate from long-term memory.
- Added a bounded `search_unpinned_memory` tool for on-demand recall that structurally excludes pinned startup memory.
- Added multilingual semantic memory retrieval with OpenAI embeddings, exact-match preference, scoped results, and a content-hash SQLite vector cache that reuses unchanged memory embeddings.
- Added embedding observability through the shared LLM-call accounting store, including actual provider token usage, model, duration, status, run ownership, estimated cost, operation type, and cache behavior in the Usage and Run context pages.
- Added run-context visibility for the exact pinned memory files loaded at startup.

### Fixed

- Made omitted chat-run models resolve consistently across API and CLI from the saved per-agent user-profile setting, then the backend agent setting, and finally the application default. Explicit request model overrides still take precedence.
- Prevented persistent LangGraph runs from resending the full UI thread after a checkpoint already exists.
- Enforced agent memory permissions at the Deep Agents filesystem boundary so native tools cannot bypass disabled reads or controlled `save_memory` writes.
- Limited run-context tool calls and token totals to the current run instead of inherited checkpoint history.
- Removed an agent's LangGraph checkpoints together with its threads and other owned data.
- Distinguished durable storage from pinned startup context so ordinary permanent-memory requests stay unpinned, and discouraged redundant memory searches when pinned context already contains the answer.
- Separated pinned and unpinned retrieval at the tool boundary so agents cannot redundantly fetch pinned startup memory through the on-demand search tool.

### Removed

- Removed completed or superseded memory, research, observability, SQLite, and temporary context-optimization planning documents after consolidating their durable information into current-state documentation.
- Removed the custom SQLite memory table, memory types/statuses, lexical and embedding scoring, embedding cache, conversation-summary memory generation, maintenance scheduler, and obsolete UI/API/CLI controls.

### Changed

- Evaluation runs can now select and record chat and researcher models independently for controlled quality and cost comparisons.
- Reorganized README and project documentation around product direction, implemented architecture, interfaces, and project history.
- Replaced startup-time schema patching with ordered transactional SQLite migrations. Destructive migrations create a database backup; schema version 8 removes the obsolete memory table and schema version 9 adds a rebuildable semantic-memory vector cache while preserving threads and messages.
- Replaced the custom memory system with a Deep Agents and LangGraph-aligned architecture that separates checkpointed threads, bounded file-backed long-term memory, on-demand recall, skills, identity, and past-conversation search.
- Simplified the Memories page to scope, content, tags, pinning, generated timestamps, and direct CRUD with plain-language help.

## [2026-07-11]

### Added

- Added Usage and Pricing tabs to the cost dashboard, OpenAI pricing refresh controls, and full pricing record CRUD through the UI, API, and CLI.
- Simplified model pricing to one active/inactive record per provider and model. Creating or updating prices activates the record, while deactivation is an explicit UI, API, or CLI action.
- Redesigned the Pricing tab around a compact source toolbar and full-width pricing table, with create and edit forms moved into a focused modal dialog.
- Extended official OpenAI price updates to persist input, cached-input, and output prices together for existing model records.
- Added a shared accessible dialog component and a pricing help modal with plain-language terminology and an example cost calculation.

### Fixed

- Persisted the latest successful pricing-source retrieval time and displayed it after checking official prices.

## [2026-07-10]

### Added

- Added a Deep Agents `pricing-source-analysis` skill and a generic pricing-source page reader so Cost Analyst can inspect configured official pricing pages before falling back to general research.
- Added a generic `read_web_page_structure` capability for cleaned HTML, Markdown, links, lists, and structured tables, and taught Cost Analyst to prefer it for official pricing-source comparison.
- Added focused `read_web_page_structure` modes and query filtering so agents can request compact table, heading, link, list, article, Markdown, or full extraction instead of full-page output by default.
- Added separate per-agent long-term memory read and write permissions through API, CLI, and the agent edit UI, and disabled automatic memory retrieval/writes for the protected Cost Analyst agent.
- Tightened Cost Analyst pricing-source guidance so configured official pages use `read_web_page_structure` first and the pricing-source page reader only as fallback.
- Added a dedicated `admin_sync_openai_model_pricing` Cost Analyst tool that fetches the official OpenAI pricing page, extracts model prices deterministically, and compares them with active saved OpenAI pricing records without changing data.
- Added direct OpenAI pricing sync through `rdma26 pricing:sync-openai` and `POST /api/model-pricing/openai/sync` so saved OpenAI price checks can run without an agent loop or LLM call.

## [2026-07-09]

### Added

- Added an LLM observability and cost-control specification covering call accounting, pricing records, cost estimates, model configuration, dashboards, and a future optimization agent.
- Decided that all backend LLM calls should go through one accounting-aware model factory so parent-agent and subagent requests can be measured consistently.
- Added the accounting-aware model factory rule to the repository instructions for future agents, subagents, tools, summaries, and maintenance jobs.
- Decided that model settings should be backend-owned, live-editable through UI/API/CLI, and layered as global defaults plus per-agent and per-capability overrides.
- Decided that LLM context inspection should store structured context references by default, with exact full prompt capture available only through an explicit local debug setting and purge support.
- Decided that LLM cost reporting should be labeled as estimated cost based on recorded usage and auditable pricing snapshots, not exact provider billing.
- Decided that pricing suggestions require explicit user approval before updating the single active/inactive record for a provider and model.
- Decided that LLM call records should be retained indefinitely by default, with manual cleanup controls and separate full-prompt payload purging.
- Decided that failed LLM calls should be logged, with estimated cost calculated only when usage metadata is available.
- Decided that estimated cost should not be shown inline in normal chat by default, with detailed cost shown in run inspection and dashboards instead.
- Decided that LLM cost optimization should be advisory by default and require explicit user approval before applying model, context, tool, or pricing changes.
- Added raw LLM call logging in SQLite for chat runs and thread-summary generation, including provider, model, purpose, status, timing, token usage, cached input tokens, and reasoning tokens when reported.
- Added a central OpenAI chat model factory so backend chat and summary LLM construction no longer happens directly in feature modules.
- Added LangChain callback-based LLM accounting so nested Deep Agents model calls can be recorded under the user-visible run.
- Added LLM call cleanup for deleted threads, deleted agents, and startup orphan cleanup.
- Added LLM call totals and per-call details to the run-context inspector page.
- Added SQLite-backed model pricing records with API and CLI management.
- Added estimated LLM call cost calculation from active pricing records, including cached input and reasoning token categories when priced.
- Added run-level estimated cost totals to the run-context inspector page.
- Added LLM call listing, single-call inspection, and estimated cost summaries through API and CLI.
- Added backend-owned per-agent chat model settings and researcher subagent model settings through API, CLI, and the agent edit UI.
- Added controlled Scotty observability tools for listing LLM calls, summarizing estimated costs, and reading pricing records.
- Added a cost dashboard for filtering LLM calls, summarizing estimated costs, inspecting recent calls, and managing pricing records.
- Added the protected internal Cost Analyst agent with API, CLI, and UI access for advisory LLM usage and cost optimization.
- Added protected Cost Analyst pricing tools so it can research provider prices and update pricing only after explicit approval.
- Added a SQLite-backed pricing source registry with API, CLI, default official OpenAI pricing source, reachability checks, and Cost Analyst source-inspection tools.
- Enabled the protected Cost Analyst agent in the normal chat selector so it can use the full streaming chat experience.

### Fixed

- Added client-side safeguards so stalled or prematurely closed agent run streams stop the chat composer and show an error instead of leaving the UI in a permanent thinking state.

## [2026-07-08]

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
- Added frontend tests for chat thread state and message source rendering.
- Added lazy-loaded settings routes for agent settings, agent edit, user profile, memory settings, and run-context pages.

### Changed

- Refactored backend HTTP, runtime, agent, workflow, and research code into smaller domain modules.
- Refactored the chat page into focused sidebar, composer, message-list, login, and thread-state pieces.
- Adjusted the Angular initial bundle warning budget after the app grew slightly beyond the default threshold.
- Improved per-message source controls with a dedicated button and message-scoped source panel.
- Fixed the chat source panel layout so source details participate in the scroll area and no longer disappear behind the composer.

## [2026-07-07]

### Added

- Added a memory system specification with rules for automatic memory writes, global and agent-local user memory, lifecycle handling, context transparency, memory-write permissions, and protected operator memory management.
- Added `Scotty` as the built-in protected operator agent with id `scotty`.
- Added controlled Scotty tools for agent administration, tool grants, memory inspection, memory management, and memory-write permissions.

### Changed

- Clarified memory policy wording so `soul.md` stores agent identity, while ordinary user and conversation memories live in memory records.
- Clarified automatic memory-save rules, including when agents should save automatically and when they should ask.
- Removed default-agent compatibility behavior in favor of the built-in `scotty` operator agent id.

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
- Added a user profile settings page accessible from the settings menu.
- Added `profile:read`, `profile:update`, and `profile:agent-model:set` CLI commands.
- Added light, dark, and system theme support.
- Added dedicated API and CLI reference docs in `docs/api.md` and `docs/cli.md`.
- Added source-available license documentation for public publishing.

### Changed

- Moved agent `soul.md` from Deep Agents memory into per-agent `configuration/soul.md` and clarified that it stores identity, not arbitrary memories.
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
