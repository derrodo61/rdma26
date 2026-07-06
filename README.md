# rdma26

Local-first Angular and Fastify app for rdma26, a personal multi-agent Deep Agents assistant.

The backend runs currently on a MacBook and exposes a browser-friendly API for any frontend that can reach it. The first frontend is Angular. Conversations are organized as agent-specific threads, model selection starts with OpenAI model IDs, and each configured agent gets its own local memory spine at `.assistant-data/agents/<agent-id>/deepagent/memories/soul.md`.

Agents can also have tools assigned dynamically. The first registered normal tool is `internet_search`, backed by Tavily when `TAVILY_API_KEY` is configured. The protected default agent is `Scotty`, a local operator agent with controlled admin tools for managing agents and tool grants.

The project is designed around one shared backend runtime. API endpoints and CLI commands call the same `AssistantRuntime` service, so functionality exposed through the browser is also available from the command line without maintaining a second implementation.

## Documentation

- [API endpoints](./docs/api.md)
- [CLI commands](./docs/cli.md)
- [Changelog](./CHANGELOG.md)

## License

This repository is public, but it is not open source. The code is source-available for reference only. Copying, modifying, distributing, hosting, or using it requires prior written permission from Rolf Dohrmann. See [LICENSE](./LICENSE).

## Run Locally

```bash
npm install
cp .env.example .env
npm run server
npm start
```

Open `http://localhost:4200`.

Without `OPENAI_API_KEY`, the backend still starts and stores messages, but agent replies use a local fallback. Add the key to `.env` and restart the backend to run Deep Agents through OpenAI.

Authentication is optional in local development. Set both values in `.env` to enable the single-user login screen:

```bash
RDMA26_USERNAME=username
RDMA26_PASSWORD=userpassword
RDMA26_SESSION_SECRET=use-a-long-random-string
```

When those credentials are configured, the backend protects `/api/*` with an HTTP-only signed session cookie. Leave `RDMA26_USERNAME` or `RDMA26_PASSWORD` empty to run without authentication.

To reach the app from another computer on the same network, run these on the MacBook:

```bash
npm run server:lan
npm run start:lan
```

Then open `http://<macbook-lan-ip>:4200` from the other computer.

## Backend

All backend routes delegate to the shared runtime used by the CLI. The API reference lives in [docs/api.md](./docs/api.md).

Thread JSON files live under the configured agent folder. Deep Agents filesystem memory also lives under the configured agent folder, with `soul.md` mounted as `/memories/soul.md`.

## Agent Configuration

The first/default agent is configured from `.env`:

```bash
ASSISTANT_AGENT_ID=default
ASSISTANT_AGENT_NAME=Scotty
```

At runtime the backend uses a small generated bootloader prompt that points Deep Agents to the configured agent's `/memories/soul.md`. The agent's role, identity, preferences, and working agreements belong in that `soul.md`, not in hardcoded TypeScript.

The protected default agent keeps the internal id `default`, but its built-in display name is `Scotty`. Scotty receives controlled backend admin tools during chat runs so Rolf can ask him to list agents, create agents, rename agents, delete non-default agents, read or update agent `soul.md`, list normal tools, and grant or revoke normal tools. These are application tools backed by `AssistantRuntime`, not shell or unrestricted CLI access.

Default local paths:

- threads: `.assistant-data/agents/default/threads/`
- memory root: `.assistant-data/agents/default/deepagent/`
- soul file: `.assistant-data/agents/default/deepagent/memories/soul.md`

Older data from `.assistant-data/threads/` and `.assistant-data/deepagent/memories/soul.md` is copied into the default agent layout if the new files do not exist yet.

Additional agents are created through `POST /api/agents`:

```json
{
  "id": "research",
  "name": "Research assistant"
}
```

Each agent gets isolated threads, history, Deep Agents filesystem state, and `soul.md`:

```text
.assistant-data/agents/research/threads/
.assistant-data/agents/research/deepagent/memories/soul.md
```

`POST /api/agent-runs` requires `agentId`, so a thread can only be read and continued through the agent it belongs to.

Tool grants are agent-specific too. The agent profile stores `enabledTools`, while the backend registry owns the tool implementation and required secrets. Scotty's admin tools are injected only for the protected default agent and are not part of the normal tool grant list. To enable Tavily search for an agent:

```bash
TAVILY_API_KEY=tvly-...
```

Then grant `internet_search` through the UI, API, or CLI. If a tool is enabled but its provider is not configured, the tool list reports it as unavailable and a chat run fails with a clear configuration error instead of silently pretending the tool exists.

## CLI

The CLI uses the same `AssistantRuntime` service as the HTTP endpoints. Any workflow that should be available in the frontend should also have a CLI path backed by the same runtime code.

Run it directly from the repo:

```bash
./bin/rdma26 agents:list
```

See [docs/cli.md](./docs/cli.md) for the command reference.
