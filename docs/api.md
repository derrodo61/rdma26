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

Returns backend status, configured agents, the initial/protected operator agent id, auth status, data directory, and whether the OpenAI API and ChatGPT/Codex providers are authenticated.

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

Returns configured model options and the default model. Public API model ids
remain unqualified, while ChatGPT/Codex model ids use `chatgpt:<model>`.

### `GET /api/model-providers`

Returns authentication and account-display status for the OpenAI API and
experimental ChatGPT/Codex providers. OAuth tokens are never returned.

### `POST /api/model-providers/openai-chatgpt/login`

Starts a loopback OAuth login and returns the OpenAI authorization URL. Open the
URL in a browser, then poll `GET /api/model-providers` for completion.

### `DELETE /api/model-providers/openai-chatgpt/session`

Cancels a pending login and deletes the locally stored ChatGPT/Codex OAuth
credentials.

### `GET /api/model-pricing`

Lists model pricing records used for estimated LLM cost calculation.

Optional query parameters:

- `provider`
- `model`
- `status`: `active` or `inactive`

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
  "sourceUrl": "https://developers.openai.com/api/docs/pricing",
  "sourceName": "OpenAI API pricing"
}
```

There can be only one pricing record for each provider/model combination. New records are active immediately.

### `PATCH /api/model-pricing/:pricingId`

Updates a pricing record.

Body:

```json
{
  "inputCostPerMillionTokens": 0.4,
  "outputCostPerMillionTokens": 1.6,
  "notes": "Verified manually from the official pricing page."
}
```

Updating a pricing record automatically makes it active. Optional nullable fields such as `cachedInputCostPerMillionTokens`, `reasoningCostPerMillionTokens`, `sourceName`, and `notes` can be set to `null` to clear them.

### `PATCH /api/model-pricing/:pricingId/active`

Activates or deactivates a pricing record without changing its prices.

```json
{
  "active": false
}
```

When inactive, token usage is still recorded but new calls for that model have no estimated monetary cost.

### `DELETE /api/model-pricing/:pricingId`

Deletes a pricing record.

### `GET /api/pricing-sources`

Lists provider pricing source pages that humans, CLI workflows, and protected agents can use when researching prices.

Optional query parameters:

- `provider`
- `trustLevel`: `official`, `third_party`, or `user_added`
- `active`: `true` or `false`

The default database seed includes the official OpenAI pricing source:

```text
https://developers.openai.com/api/docs/pricing
```

### `POST /api/pricing-sources`

Creates a provider pricing source page.

Body:

```json
{
  "provider": "openai",
  "name": "OpenAI API pricing",
  "url": "https://developers.openai.com/api/docs/pricing",
  "trustLevel": "official",
  "active": true,
  "notes": "Official OpenAI API pricing page."
}
```

### `PATCH /api/pricing-sources/:sourceId`

Updates a provider pricing source page. Supported fields are `provider`, `name`, `url`, `trustLevel`, `active`, and `notes`.

### `DELETE /api/pricing-sources/:sourceId`

Deletes a provider pricing source page.

### `POST /api/pricing-sources/:sourceId/check`

Checks whether a pricing source URL is reachable and updates `lastCheckedAt`, `lastSuccessAt`, and `lastError`.

### `POST /api/model-pricing/openai/sync`

Runs the direct deterministic OpenAI pricing check without an agent run or LLM call. It fetches the configured official OpenAI pricing source, extracts the OpenAI pricing table, and compares it with active saved OpenAI pricing records.

Set `apply` to `true` to update the input, cached-input, output, source URL, and retrieval timestamp of existing records from the official short-context prices. Apply mode does not create missing models.

```json
{
  "apply": true
}
```

Optional body:

```json
{
  "sourceId": "pricing-source-uuid"
}
```

Cost Analyst can use configured pricing sources through controlled tools and its `pricing-source-analysis` Deep Agents skill before falling back to general web research. For OpenAI model-price comparison, it has a dedicated `admin_sync_openai_model_pricing` controlled tool that fetches the official OpenAI pricing page, extracts the model pricing table deterministically, and returns a compact comparison without changing saved pricing records.

### `GET /api/tools`

Returns registered tools and their availability.

- `web_search` is OpenAI's provider-hosted search capability. It is available when `OPENAI_API_KEY` is configured and uses the model selected for the chat run.
- `read_web_page` is a low-level public web page reader.
- `read_web_page_structure` fetches a known public web page and returns structured content with focused modes: `overview`, `markdown`, `article`, `headings`, `links`, `lists`, `tables`, and `full`. Use a narrow mode and optional `query` when page structure matters.

Protected system agents such as `scotty` and the internal `cost-analyst` also receive controlled admin tools during chat runs for managing agents, `soul.md`, normal tool grants, memory, and observability data. Those admin tools are injected by the backend only for protected system agents and are not part of the normal assignable tool catalog returned here.

## Observability

### `GET /api/llm-calls`

Lists recorded LLM calls.

Optional query parameters:

- `agentId`
- `threadId`
- `runId`
- `provider`
- `model`
- `purpose`: `chat`, `thread_summary`, `memory_retrieval`, `memory_maintenance`, `operator`, or `unknown`
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

### `POST /api/optimizer-runs`

Creates a hidden internal Cost Analyst thread and asks the protected optimization agent to inspect local LLM usage, pricing, run context, and model settings. The Cost Analyst has the `web_search` capability, a dedicated OpenAI pricing sync/compare tool, and controlled pricing tools. Pricing changes require explicit approval.

Body:

```json
{
  "prompt": "Which agent cost the most this week, and what should I optimize first?",
  "title": "Cost dashboard",
  "model": "gpt-4.1-mini"
}
```

`prompt` is required. `title` and `model` are optional. The response includes the optimizer run id, thread, run context, and answer content.

## Memories

### `GET /api/memories`

Lists and searches memory records.

Query parameters:

- `agentId`
- `scope`: `agent`, `agent_user`, or `user`
- `pinned`: `true` or `false`
- `tag`: exact tag filter
- `createdFrom` and `createdTo`: ISO timestamp or `YYYY-MM-DD`
- `updatedFrom` and `updatedTo`: ISO timestamp or `YYYY-MM-DD`
- `query`
- `limit`

When `agentId` is provided without `scope`, the response includes that agent's memories and global user memories.

### `GET /api/memories/pinned-budgets`

Requires `agentId`. Returns the used and maximum startup-memory characters for global user, agent-user, and agent scopes as they apply to that agent.

### `POST /api/memories`

Body:

```json
{
  "scope": "agent",
  "agentId": "scotty",
  "pinned": false,
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
  "pinned": true,
  "content": "Updated memory content."
}
```

Updates a memory's content, tags, source metadata, or pinned state.

### `DELETE /api/memories/:memoryId`

Deletes one memory record.

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
    "canRead": true,
    "canWrite": true
  }
}
```

Updates agent settings. `memory.canRead` controls pinned startup memory, on-demand memory directories, and past-conversation tools. `memory.canWrite` controls whether the agent receives the `save_memory` tool.

The `models` object stores backend-owned model settings:

```json
{
  "models": {
    "chat": "gpt-4.1-mini"
  }
}
```

`models.chat` is the chat model for the agent. Hosted web search is included
only when that capability is enabled and the selected model uses the public
OpenAI API provider. Provider-incompatible grants are retained on the agent but
listed as withheld in the run context.

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

Deletes an agent and all related threads and Deep Agents data. Protected system agents cannot be deleted.

The built-in protected operator agent has id `scotty` and display name `Scotty`.

## Agent Tools

### `GET /api/agents/:agentId/tools`

Returns the agent's enabled tool ids, all registered normal tool definitions, and any read-only controlled tools injected for that agent.

### `PUT /api/agents/:agentId/tools`

Body:

```json
{
  "enabledTools": ["web_search"]
}
```

Replaces the agent's enabled tool list.

Use `web_search` for agents that need current external information. Use
`read_web_page` and `read_web_page_structure` only for known-URL inspection.

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
- `run-activity`
- `message`
- `thread-updated`
- `error`
- `run-finished`

`run-activity` reports friendly live progress from the agent runtime. Example:

```json
{
  "type": "run-activity",
  "label": "Ronaldo is searching the web",
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
- pinned memory files loaded at startup, including scope, virtual path, tags, source metadata, and content
- tools available in the run, including labels, providers, descriptions, and whether they were assigned or controlled
- tool calls and tool results when returned by the Deep Agents run
- skill files actually loaded through Deep Agents progressive disclosure; available but unread skills are not counted as used
- token usage when returned by the model/runtime
- LLM call records, including purpose, status, token usage, duration, pricing snapshot id, and estimated cost when active pricing exists
- whether memory writes were enabled
