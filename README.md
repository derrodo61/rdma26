# rdma26

Local-first Angular and Fastify app for rdma26, a personal multi-agent Deep Agents assistant.

The backend runs currently on a MacBook and exposes a browser-friendly API for any frontend that can reach it. The first frontend is Angular. Conversations are organized as agent-specific threads, model selection starts with OpenAI model IDs, and each configured agent gets its own stable identity file at `.assistant-data/agents/<agent-id>/configuration/soul.md`.

Agents can also have capabilities and tools assigned dynamically. The recommended internet research capability is `research`, which attaches a Deep Agents researcher subagent when `TAVILY_API_KEY` and `OPENAI_API_KEY` are configured. Lower-level `internet_search` and `read_web_page` tools remain available for specialized or debugging workflows. The protected operator agent is `Scotty` with id `scotty`, a local operator agent with controlled admin tools for managing agents and tool grants.

The project is designed around one shared backend runtime. API endpoints and CLI commands call the same `AssistantRuntime` service, so functionality exposed through the browser is also available from the command line without maintaining a second implementation.

## Documentation

- [API endpoints](./docs/api.md)
- [Backend structure](./docs/backend.md)
- [CLI commands](./docs/cli.md)
- [Memory system](./docs/memory.md)
- [Memory system design spec](./docs/memory-spec.md)
- [Research agent design spec](./docs/research-agent-spec.md)
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

Thread/message records, memory records, and run-context records live in the local SQLite database at `.assistant-data/rdma26.sqlite`. Older JSON thread, memory, and run-context files are imported once on startup and removed after successful import. Agent identity lives in `configuration/soul.md`. Deep Agents filesystem state remains under the configured agent folder in `deepagent/`.

## Agent Configuration

The protected operator agent is configured from `.env`:

```bash
ASSISTANT_AGENT_ID=scotty
ASSISTANT_AGENT_NAME=Scotty
```

At runtime the backend loads the configured agent's `configuration/soul.md` and injects it into the generated bootloader prompt. The agent's stable identity, role, personality, and operating principles belong in that `soul.md`, not in hardcoded TypeScript. Arbitrary memories, transient facts, game results, project notes, and conversation history do not belong in `soul.md`.

The built-in protected operator agent has id `scotty` and display name `Scotty`. Scotty receives controlled backend admin tools during chat runs so Rolf can ask him to list agents, create agents, rename agents, delete non-protected agents, read or update agent `soul.md`, list normal tools, and grant or revoke normal tools. These are application tools backed by `AssistantRuntime`, not shell or unrestricted CLI access.

Scotty's local file paths:

- identity file: `.assistant-data/agents/scotty/configuration/soul.md`
- Deep Agents root: `.assistant-data/agents/scotty/deepagent/`

Additional agents are created through `POST /api/agents`:

```json
{
  "id": "research",
  "name": "Research assistant"
}
```

Each agent gets isolated threads, history, identity configuration, and Deep Agents filesystem state:

```text
.assistant-data/rdma26.sqlite
.assistant-data/agents/research/configuration/soul.md
.assistant-data/agents/research/deepagent/
```

`POST /api/agent-runs` requires `agentId`, so a thread can only be read and continued through the agent it belongs to.

Tool grants are agent-specific too. The agent profile stores `enabledTools`, while the backend registry owns the capability/tool implementation and required secrets. Scotty's admin tools are injected only for the protected operator agent and are not part of the normal tool grant list. To enable internet research for an agent:

```bash
TAVILY_API_KEY=tvly-...
OPENAI_API_KEY=sk-...
```

Then grant `research` through the UI, API, or CLI. If a capability or tool is enabled but its provider is not configured, the tool list reports it as unavailable and a chat run fails with a clear configuration error instead of silently pretending the capability exists.

## CLI

The CLI uses the same `AssistantRuntime` service as the HTTP endpoints. Any workflow that should be available in the frontend should also have a CLI path backed by the same runtime code.

Run it directly from the repo:

```bash
./bin/rdma26 agents:list
```

See [docs/cli.md](./docs/cli.md) for the command reference.
