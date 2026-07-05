# API Endpoints

The backend is a Fastify service. All routes call the shared `AssistantRuntime`, which is also used by the CLI.

Unless authentication is disabled, `/api/*` routes require the signed session cookie created by `POST /api/auth/login`. The auth session and login/logout routes are exempt.

## Automatic API Documentation

The backend exposes generated OpenAPI documentation:

- `GET /api/openapi.json` returns the generated OpenAPI 3.1 document.
- `GET /docs` serves Swagger UI for browser-based API exploration.

Zod remains the source of truth for request and route-parameter schemas. The server converts those Zod schemas to JSON Schema for Fastify route metadata, and `@fastify/swagger` uses that metadata to generate the OpenAPI document.

The current generated documentation covers routes, request bodies, and path parameters. Response schemas are not fully modeled yet.

## Health

### `GET /api/health`

Returns backend status, configured agents, default agent id, auth status, data directory, and whether `OPENAI_API_KEY` is configured.

## Authentication

### `GET /api/auth/session`

Returns whether auth is enabled and whether the current request is authenticated.

### `POST /api/auth/login`

Body:

```json
{
  "username": "rolf",
  "password": "secret"
}
```

Creates an HTTP-only signed session cookie when credentials match the configured single-user login.

### `POST /api/auth/logout`

Clears the session cookie.

## Models And Tools

### `GET /api/models`

Returns configured OpenAI model options and the default model.

### `GET /api/tools`

Returns registered tools and their availability. `internet_search` is available when `TAVILY_API_KEY` is configured.

## Agents

### `GET /api/agents`

Returns all configured agents and the default agent id.

### `POST /api/agents`

Body:

```json
{
  "id": "research",
  "name": "Research assistant"
}
```

Creates a new agent. `id` is optional; when omitted, the backend derives it from the name.

### `GET /api/agents/:agentId`

Returns one agent profile.

### `PATCH /api/agents/:agentId`

Body:

```json
{
  "name": "Researcher"
}
```

Updates the agent display name.

### `DELETE /api/agents/:agentId`

Deletes an agent and all related threads and Deep Agents data. The default agent cannot be deleted.

## Agent Tools

### `GET /api/agents/:agentId/tools`

Returns the agent's enabled tool ids plus all registered tool definitions.

### `PUT /api/agents/:agentId/tools`

Body:

```json
{
  "enabledTools": ["internet_search"]
}
```

Replaces the agent's enabled tool list.

### `POST /api/agents/:agentId/tools/:toolId`

Grants one tool to an agent.

### `DELETE /api/agents/:agentId/tools/:toolId`

Revokes one tool from an agent.

## Threads

### `GET /api/agents/:agentId/threads`

Lists thread summaries for one agent.

### `POST /api/agents/:agentId/threads`

Body:

```json
{
  "title": "Planning"
}
```

Creates a thread. `title` is optional.

### `GET /api/agents/:agentId/threads/:threadId`

Returns one full thread with messages.

### `DELETE /api/agents/:agentId/threads/:threadId`

Deletes one thread.

## Agent Runs

### `POST /api/agent-runs`

Body:

```json
{
  "agentId": "default",
  "threadId": "00000000-0000-0000-0000-000000000000",
  "prompt": "Hello",
  "model": "gpt-4.1-mini"
}
```

Streams Server-Sent Events:

- `run-started`
- `message`
- `thread-updated`
- `error`
- `run-finished`

## Legacy Default-Agent Thread Routes

These routes operate on the configured default agent and are kept for compatibility:

- `GET /api/threads`
- `POST /api/threads`
- `GET /api/threads/:threadId`
