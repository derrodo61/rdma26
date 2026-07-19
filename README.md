# rdma26

Local-first Angular and Fastify app for rdma26, a personal multi-agent Deep Agents assistant.

The authoritative product direction is [docs/vision.md](./docs/vision.md).

The backend runs currently on a MacBook and exposes a browser-friendly API for any frontend that can reach it. The first frontend is Angular. Conversations are organized as agent-specific threads, model selection starts with OpenAI model IDs, and each configured agent gets its own stable identity file at `.assistant-data/agents/<agent-id>/configuration/soul.md`.

Agents can also have capabilities assigned dynamically. Internet research uses OpenAI's hosted `web_search` capability with the model selected for the chat. The `web_page_access` capability provides the low-level `read_web_page` and `read_web_page_structure` tools for known-URL inspection workflows. The protected operator agent is `Scotty` with id `scotty`, a local operator agent with controlled admin tools for managing agents and capability grants. The internal `cost-analyst` agent uses the same protected tool mechanism for advisory LLM usage and cost optimization.

The project is designed around one shared backend runtime. API endpoints and CLI commands call the same `AssistantRuntime` service, so functionality exposed through the browser is also available from the command line without maintaining a second implementation.

## Documentation

- [Documentation index](./docs/README.md)
- [Product vision](./docs/vision.md)
- [Current architecture](./docs/architecture.md)
- [Skills](./docs/skills.md)
- [API reference](./docs/api.md)
- [CLI reference](./docs/cli.md)
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

Thread/message records, run contexts, LLM accounting, pricing, profile data, and rebuildable semantic-memory vectors live in `.assistant-data/rdma26.sqlite`. LangGraph checkpoint state lives in `.assistant-data/langgraph-checkpoints.sqlite`. Curated long-term memory uses scoped Markdown files, while agent identity lives in `configuration/soul.md`. See [docs/storage.md](./docs/storage.md) and [docs/memory.md](./docs/memory.md).

## Agent Configuration

The protected operator agent is configured from `.env`:

```bash
ASSISTANT_AGENT_ID=scotty
ASSISTANT_AGENT_NAME=Scotty
```

At runtime the backend loads the configured agent's `configuration/soul.md` and injects it into the generated bootloader prompt. The agent's stable identity, role, personality, and operating principles belong in that `soul.md`, not in hardcoded TypeScript. Arbitrary memories, transient facts, game results, project notes, and conversation history do not belong in `soul.md`.

The built-in protected operator agent has id `scotty` and display name `Scotty`. Scotty receives controlled backend admin tools during chat runs so the user can ask him to list agents, create agents, rename agents, delete non-protected agents, read or update agent `soul.md`, list normal tools, and grant or revoke normal tools. These are application tools backed by `AssistantRuntime`, not shell or unrestricted CLI access. The internal `cost-analyst` agent is chat-enabled and uses protected tools for cost optimization and pricing inspection. It has long-term memory disabled to avoid stale personal or pricing context.

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

Capability grants are agent-specific too. The agent profile stores `enabledCapabilities`, while the backend registry resolves each capability into its tools, middleware, instructions, and provider requirements. Protected system tools are injected only for protected system agents and are not part of the normal capability catalog. To enable internet research for an agent, configure OpenAI:

```bash
OPENAI_API_KEY=sk-...
```

Then grant `web_search` through the UI, API, or CLI. It uses the model selected for that chat run. If a capability is enabled but its provider is not configured, the capability list reports it as unavailable and a chat run fails with a clear configuration error instead of silently pretending the capability exists.

## CLI

The CLI uses the same `AssistantRuntime` service as the HTTP endpoints. Any workflow that should be available in the frontend should also have a CLI path backed by the same runtime code.

Run it directly from the repo:

```bash
./bin/rdma26 agents:list
```

See [docs/cli.md](./docs/cli.md) for the command reference.
