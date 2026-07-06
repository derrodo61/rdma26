# CLI Commands

The CLI is named `rdma26`. It calls the same `AssistantRuntime` service as the HTTP API.

From the repository, use either:

```bash
./bin/rdma26 <command>
```

or:

```bash
npm run --silent rdma26 -- <command>
```

## Agents

### List agents

```bash
rdma26 agents:list
```

### Create an agent

```bash
rdma26 agents:create --id research --name "Research assistant"
```

`--id` is optional. When omitted, the backend derives the id from the name.

### Update an agent display name

```bash
rdma26 agents:update --agent research --name "Researcher"
```

### Read an agent soul.md

```bash
rdma26 agents:soul:read --agent research
```

### Update an agent soul.md

```bash
rdma26 agents:soul:write --agent research --file ./soul.md
```

Use `--content "..."` instead of `--file` for short inline updates.

### Delete an agent

```bash
rdma26 agents:delete --agent research
```

The default agent cannot be deleted.

## Profile

### Read the synced user profile

```bash
rdma26 profile:read
```

### Update profile fields

```bash
rdma26 profile:update --name "Rolf" --time-zone Europe/Berlin --locale de-DE --language de --date-style medium --time-style short --theme system
```

All options are optional. Omitted fields keep their current values.

### Set an agent model preference

```bash
rdma26 profile:agent-model:set --agent default --model gpt-4.1-mini
```

## Tools

### List registered tools

```bash
rdma26 tools:list
```

### Show tools for one agent

```bash
rdma26 agents:tools --agent research
```

For the protected default operator agent, the response also includes `controlledTools`, which are read-only admin capabilities injected by the backend.

### Replace an agent's enabled tools

```bash
rdma26 agents:tools:set --agent research --tools internet_search
```

Use a comma-separated list for multiple tools.

### Grant one tool

```bash
rdma26 agents:tools:grant --agent research --tool internet_search
```

### Revoke one tool

```bash
rdma26 agents:tools:revoke --agent research --tool internet_search
```

## Threads

### List threads

```bash
rdma26 threads:list --agent default
```

### Create a thread

```bash
rdma26 threads:create --agent default --title "Planning"
```

`--title` is optional.

### Read a thread

```bash
rdma26 threads:read --agent default --thread <thread-id>
```

### Delete a thread

```bash
rdma26 threads:delete --agent default --thread <thread-id>
```

## Chat

### Send a message

```bash
rdma26 chat:send --agent default --thread <thread-id> --model gpt-4.1-mini --prompt "Hello"
```

The command appends the user message, runs the selected agent, stores the assistant response, and prints the result as JSON.

## Options

### `--agent`

Agent id. Defaults to `ASSISTANT_AGENT_ID` or `default`.

### Environment

The CLI reads the same `.env` configuration as the backend, including:

- `ASSISTANT_DATA_DIR`
- `ASSISTANT_AGENT_ID`
- `ASSISTANT_AGENT_NAME`
- `OPENAI_API_KEY`
- `OPENAI_MODELS`
- `TAVILY_API_KEY`
