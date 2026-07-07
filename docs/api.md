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

Returns backend status, configured agents, the initial/protected operator agent id, auth status, data directory, and whether `OPENAI_API_KEY` is configured.

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

## Profile

### `GET /api/profile`

Returns the synced user profile, including name, timezone, regional format (`locale`), language, date/time display preferences, theme, and per-agent UI settings.

### `PATCH /api/profile`

Body:

```json
{
  "name": "Rolf",
  "timeZone": "Europe/Berlin",
  "language": "de",
  "locale": "de-DE",
  "dateStyle": "medium",
  "timeStyle": "short",
  "theme": "system",
  "agentSettings": {
    "scotty": {
      "model": "gpt-4.1-mini"
    }
  }
}
```

Updates the synced user profile. Fields are optional; omitted fields keep their current values.

Agent runs include the current profile in the backend-generated bootloader prompt, so agents can use the configured timezone, language, regional format, date style, and time style when presenting dates and times.

## Models And Tools

### `GET /api/models`

Returns configured OpenAI model options and the default model.

### `GET /api/tools`

Returns registered tools and their availability. `internet_search` is available when `TAVILY_API_KEY` is configured.

The protected operator agent, `scotty`, also receives controlled admin tools during chat runs for managing agents, `soul.md`, and normal tool grants. Those admin tools are injected by the backend only for the protected operator agent and are not part of the normal assignable tool catalog returned here.

## Agents

### `GET /api/agents`

Returns all configured agents and the initial/protected operator agent id.

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

### `GET /api/agents/:agentId/soul`

Returns the current Markdown content of the agent's identity file, `configuration/soul.md`.

### `PUT /api/agents/:agentId/soul`

Body:

```json
{
  "content": "# soul.md\n\nYou are Research assistant.\n"
}
```

Replaces the agent's `configuration/soul.md` content. Use this file for stable identity, role, personality, and operating principles, not arbitrary memories or transient facts.

### `DELETE /api/agents/:agentId`

Deletes an agent and all related threads and Deep Agents data. The protected operator agent cannot be deleted.

The built-in protected operator agent has id `scotty` and display name `Scotty`.

## Agent Tools

### `GET /api/agents/:agentId/tools`

Returns the agent's enabled tool ids, all registered normal tool definitions, and any read-only controlled tools injected for that agent.

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
  "agentId": "scotty",
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
