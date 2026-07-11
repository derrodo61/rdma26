# Backend Structure

The backend is a Fastify service with a shared runtime facade. HTTP routes and CLI commands call the same `AssistantRuntime` methods, while the implementation is split into focused domain modules.

## Main Entry Points

- `server/src/index.ts` starts the backend process.
- `server/src/http/server.ts` creates the Fastify server, Swagger docs, CORS, auth, and routes.
- `server/src/cli.ts` implements the `rdma26` CLI.
- `server/src/runtime.ts` is the public backend facade used by both API routes and CLI commands.

`AssistantRuntime` should stay stable for callers. Larger workflows should live in domain services instead of growing `runtime.ts`.

## Domain Folders

- `server/src/agents/` manages configured agents and per-run Deep Agents orchestration helpers.
- `server/src/capabilities/` contains configurable agent capabilities and controlled tools. The external API still calls these tools, but internally the registry is named `CapabilityRegistry` because entries can be direct LangChain tools or higher-level Deep Agents capabilities.
- `server/src/chat/` runs chat requests and records run context.
- `server/src/http/` contains route registration, route schemas, SSE helpers, and HTTP error handling.
- `server/src/memory/` owns scoped Markdown memory files and pinned-memory budgets.
- `server/src/profiles/` stores synced user profile preferences.
- `server/src/research/` implements the researcher subagent, search provider abstraction, search quality helpers, and web page reader.
- `server/src/runs/` stores inspectable run-context snapshots.
- `server/src/storage/` contains low-level SQLite and agent file/thread storage adapters.
- `server/src/threads/` owns thread workflows, persistent LangGraph checkpointing, and bounded past-conversation access.

## Dependency Direction

Routes and CLI call `AssistantRuntime`. `AssistantRuntime` coordinates stores and services. Domain services can use lower-level stores, capabilities, and storage adapters, but route files should not call those internals directly.

This keeps API and CLI behavior consistent while allowing backend internals to evolve in smaller pieces.
