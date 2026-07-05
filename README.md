# rdma26

Local-first Angular and Fastify app for rdma26, a personal Deep Agents assistant.

The backend runs on the MacBook and exposes a browser-friendly API for any frontend that can reach it. The first frontend is Angular. Conversations are organized as threads, model selection starts with OpenAI model IDs, and each configured agent gets its own local memory spine at `.assistant-data/agents/<agent-id>/deepagent/memories/soul.md`.

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
RDMA26_USERNAME=rolf
RDMA26_PASSWORD=change-me
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

- `GET /api/health`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/models`
- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:agentId`
- `PATCH /api/agents/:agentId`
- `GET /api/agents/:agentId/threads`
- `POST /api/agents/:agentId/threads`
- `GET /api/agents/:agentId/threads/:threadId`
- `DELETE /api/agents/:agentId/threads/:threadId`
- `POST /api/agent-runs` streams Server-Sent Events

Thread JSON files live under the configured agent folder. Deep Agents filesystem memory also lives under the configured agent folder, with `soul.md` mounted as `/memories/soul.md`.

## Agent Configuration

The first/default agent is configured from `.env`:

```bash
ASSISTANT_AGENT_ID=default
ASSISTANT_AGENT_NAME=Default assistant
```

At runtime the backend uses a small generated bootloader prompt that points Deep Agents to the configured agent's `/memories/soul.md`. The agent's role, identity, preferences, and working agreements belong in that `soul.md`, not in hardcoded TypeScript.

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

## CLI

The CLI uses the same `AssistantRuntime` service as the HTTP endpoints.

Run it directly from the repo:

```bash
./bin/rdma26 agents:list
```

Or through npm:

```bash
npm run --silent rdma26 -- agents:list
npm run --silent rdma26 -- agents:create --id research --name "Research assistant"
npm run --silent rdma26 -- agents:update --agent research --name "Researcher"
npm run --silent rdma26 -- threads:list --agent default
npm run --silent rdma26 -- threads:create --agent default --title "Planning"
npm run --silent rdma26 -- threads:read --agent default --thread <thread-id>
npm run --silent rdma26 -- threads:delete --agent default --thread <thread-id>
npm run --silent rdma26 -- chat:send --agent default --thread <thread-id> --model gpt-4.1-mini --prompt "Hello"
```
