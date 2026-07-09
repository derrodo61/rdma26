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

Returns the synced user profile, including name, timezone, regional format (`locale`), language, date/time display preferences, theme, last used agent, and per-agent UI settings.

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
  "lastAgentId": "ronaldo",
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

### `GET /api/model-pricing`

Lists model pricing records used for estimated LLM cost calculation.

Optional query parameters:

- `provider`
- `model`
- `status`: `active`, `superseded`, or `unverified`

### `POST /api/model-pricing`

Creates a model pricing record.

Body:

```json
{
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "inputCostPerMillionTokens": 0.4,
  "outputCostPerMillionTokens": 1.6,
  "cachedInputCostPerMillionTokens": 0.1,
  "currency": "USD",
  "sourceUrl": "https://openai.com/api/pricing/",
  "sourceName": "OpenAI API pricing",
  "status": "active"
}
```

New records default to `unverified`. Creating or activating an `active` record supersedes the previous active record for the same provider and model.

### `PATCH /api/model-pricing/:pricingId`

Updates a pricing record status, `validUntil`, or notes.

Body:

```json
{
  "status": "active",
  "notes": "Verified manually from the official pricing page."
}
```

### `GET /api/tools`

Returns registered tools and their availability.

- `research` is the recommended Deep Agents researcher subagent capability. It is available when `TAVILY_API_KEY` and `OPENAI_API_KEY` are configured.
- `internet_search` is a low-level Tavily search primitive and is available when `TAVILY_API_KEY` is configured.
- `read_web_page` is a low-level public web page reader.

The protected operator agent, `scotty`, also receives controlled admin tools during chat runs for managing agents, `soul.md`, and normal tool grants. Those admin tools are injected by the backend only for the protected operator agent and are not part of the normal assignable tool catalog returned here.

## Observability

### `GET /api/llm-calls`

Lists recorded LLM calls.

Optional query parameters:

- `agentId`
- `threadId`
- `runId`
- `provider`
- `model`
- `purpose`: `chat`, `research_parent`, `research_subagent`, `research_verification`, `thread_summary`, `memory_retrieval`, `memory_maintenance`, `operator`, or `unknown`
- `status`: `success`, `error`, or `cancelled`
- `startedFrom` and `startedTo`: ISO timestamp or `YYYY-MM-DD`
- `limit`

### `GET /api/llm-calls/:callId`

Returns one recorded LLM call, including token usage, duration, pricing snapshot, and estimated cost when available.

### `GET /api/costs/summary`

Summarizes estimated LLM costs from recorded calls.

Optional query parameters:

- `groupBy`: `day`, `agent`, `model`, or `purpose`
- `agentId`
- `threadId`
- `provider`
- `model`
- `purpose`
- `status`
- `startedFrom` and `startedTo`

## Memories

### `GET /api/memories`

Lists and searches memory records.

Query parameters:

- `agentId`
- `scope`: `agent`, `agent_user`, or `user`
- `type`: `fact`, `preference`, `conversation_summary`, `open_task`, or `tracked_topic`
- `lifetime`: `permanent`, `active`, or `temporary`
- `status`: `active`, `archived`, or `superseded`
- `tag`: exact tag filter
- `createdFrom` and `createdTo`: ISO timestamp or `YYYY-MM-DD`
- `updatedFrom` and `updatedTo`: ISO timestamp or `YYYY-MM-DD`
- `query`
- `limit`

When `agentId` is provided without `scope`, the response includes that agent's memories and global user memories.

### `POST /api/memories`

Body:

```json
{
  "scope": "agent",
  "agentId": "scotty",
  "type": "fact",
  "lifetime": "active",
  "content": "The user prefers concise status updates.",
  "tags": ["preference"]
}
```

Creates a memory. Agent-scoped memories require `agentId`.

### `GET /api/memories/:memoryId`

Returns one memory record.

### `PATCH /api/memories/:memoryId`

Body:

```json
{
  "status": "archived"
}
```

Updates a memory. This is also how clients archive or supersede a memory.

### `DELETE /api/memories/:memoryId`

Deletes one memory record.

### `POST /api/memories/maintenance`

Body:

```json
{
  "agentId": "scotty",
  "model": "gpt-4.1-mini",
  "limitPerAgent": 25
}
```

Runs visible memory maintenance. For now this consolidates thread summaries for one agent or, when `agentId` is omitted, all agents. Summaries are created by an LLM. If no summary model or API key is available, summaries cannot be created. Agents with memory writes disabled are skipped and reported.

### `GET /api/memories/maintenance/settings`

Returns the memory maintenance scheduler settings.

### `PATCH /api/memories/maintenance/settings`

Body:

```json
{
  "enabled": true,
  "intervalMinutes": 1440,
  "agentId": "scotty",
  "model": "gpt-4.1-mini",
  "limitPerAgent": 25
}
```

Updates the scheduler settings. Scheduled memory maintenance is disabled by default and runs only when explicitly enabled.

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

Agent profiles also include visibility metadata:

- `kind`: `chat`, `operator`, or `internal`
- `chatEnabled`: whether the agent appears in the normal chat selector

Normal created agents default to `kind: "chat"` and `chatEnabled: true`. The built-in `scotty` agent is an operator agent.

### `GET /api/agents/:agentId`

Returns one agent profile.

### `PATCH /api/agents/:agentId`

Body:

```json
{
  "name": "Researcher",
  "memory": {
    "canWrite": true
  }
}
```

Updates agent settings. `memory.canWrite` controls whether the agent receives the `save_memory` tool and whether memory maintenance may create thread-summary memories for that agent.

The `models` object stores backend-owned model settings:

```json
{
  "models": {
    "chat": "gpt-4.1-mini",
    "research": {
      "researcher": "gpt-4.1"
    }
  }
}
```

`models.chat` is the normal chat model for the agent. `models.research.researcher` is used by the internal researcher subagent when the `research` capability is enabled.

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
  "enabledTools": ["research"]
}
```

Replaces the agent's enabled tool list.

Use `research` for normal agents that need current external information. Use
`internet_search` and `read_web_page` only when you explicitly want the
low-level primitives.

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

When possible, this also creates a one-time summary for the previous latest non-empty thread for the same agent. The new thread is still created if summary creation is unavailable.

### `GET /api/agents/:agentId/threads/:threadId`

Returns one full thread with messages.

### `DELETE /api/agents/:agentId/threads/:threadId`

Deletes one thread.

### `POST /api/agents/:agentId/threads/:threadId/summary`

Creates the `conversation_summary` memory for one thread if it does not already exist.

If the thread already has a summary, the existing summary is returned and no new summary is generated. This is useful after a thread is complete enough to make available for future recall.

Optional body:

```json
{
  "model": "gpt-4.1-mini"
}
```

New summaries are created by an LLM. Use `model` to request a specific summary model. If no summary model or API key is available, a missing summary cannot be created. The response includes the model that created the summary, or an existing memory when the thread was already summarized.

### `POST /api/agents/:agentId/threads/summaries`

Creates missing `conversation_summary` memories for multiple non-empty threads of one agent.

Optional body:

```json
{
  "model": "gpt-4.1-mini",
  "limit": 25
}
```

The response includes updated summaries and `skippedEmptyThreads`.

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
- `run-activity`
- `message`
- `thread-updated`
- `error`
- `run-finished`

`run-activity` reports friendly live progress from the agent runtime. Example:

```json
{
  "type": "run-activity",
  "label": "Researcher is searching the web",
  "detail": "Angular latest stable version"
}
```

### `GET /api/runs/:runId/context`

Returns optional run-context transparency details for one run. The `runId` is emitted by `POST /api/agent-runs` as the `run-started` event.

The frontend exposes this data at `/settings/runs/:runId`.

### `GET /api/agents/:agentId/threads/:threadId/latest-run-context`

Returns the latest run context for one thread, or `null` when the thread has no runs yet.

### `GET /api/agents/:agentId/threads/:threadId/run-contexts`

Returns all run contexts for one thread, newest first. The chat UI uses this to attach research sources to the specific assistant message they support after live runs and page reloads.

The response includes:

- agent id and display name
- thread id and title
- selected model
- user prompt and assistant response
- loaded `soul.md` content
- user profile snapshot
- thread messages included in the run
- memories injected into the run, including retrieval scores, tags, source metadata, status, and lifetime
- tools available in the run, including labels, providers, descriptions, and whether they were assigned or controlled
- tool calls and tool results when returned by the Deep Agents run
- token usage when returned by the model/runtime
- LLM call records, including purpose, status, token usage, duration, pricing snapshot id, and estimated cost when active pricing exists
- whether memory writes were enabled
