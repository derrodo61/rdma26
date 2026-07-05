# Changelog

All notable project changes are tracked here.

## Unreleased

- Added dynamic per-agent tool assignment through the backend API, CLI, and agent edit UI.
- Added the first registered tool, `internet_search`, backed by Tavily when `TAVILY_API_KEY` is configured.
- Added persistent `enabledTools` to agent profiles, including migration for existing agents.
- Added light, dark, and system theme support.
- Refined the chat layout with a collapsible sidebar, inline model selector, rounded composer, and simplified message styling.
- Added source-available license documentation for public publishing.

## 2026-07-05

- Initialized `rdma26` as a local-first Angular and Fastify personal multi-agent assistant.
- Added OpenAI model selection, per-agent localStorage model preference, and agent-specific conversation threads.
- Added local Deep Agents filesystem memory with per-agent `soul.md`.
- Added basic single-user username/password authentication.
- Added first-class CLI support backed by the same runtime as the API endpoints.
- Added agent management: create, edit display name, delete, and isolate related threads and memory data.
- Added thread deletion with frontend confirmation.
