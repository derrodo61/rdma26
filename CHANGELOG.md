# Changelog

All notable project changes are tracked here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned release sections will be added when the project starts tagging releases.

## [Unreleased]

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
- Added `Scotty` as the protected default operator agent with controlled admin tools for agent and tool-grant management.
- Added migration for known legacy default `soul.md` templates to Scotty's operator identity.
- Added read-only UI/API/CLI visibility for controlled operator tools.
- Added a user profile settings page accessible from the settings menu.
- Added `profile:read`, `profile:update`, and `profile:agent-model:set` CLI commands.
- Added light, dark, and system theme support.
- Added dedicated API and CLI reference docs in `docs/api.md` and `docs/cli.md`.
- Added source-available license documentation for public publishing.

### Changed

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
