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

### Set agent memory write permission

```bash
rdma26 agents:memory:set --agent research --can-write false
```

When memory writes are disabled, the agent does not receive `save_memory` and memory maintenance skips that agent.

### Set agent model settings

```bash
rdma26 agents:model:set --agent research --model gpt-4.1-mini
rdma26 agents:research-model:set --agent research --model gpt-4.1
```

`agents:model:set` changes the normal chat model. `agents:research-model:set` changes the model used by the internal researcher subagent when the `research` capability is enabled.

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

The protected operator agent cannot be deleted.

## Profile

### Read the synced user profile

```bash
rdma26 profile:read
```

### Update profile fields

```bash
rdma26 profile:update --name "Rolf" --time-zone Europe/Berlin --locale de-DE --language de --date-style medium --time-style short --theme system --last-agent ronaldo
```

All options are optional. Omitted fields keep their current values.

### Set an agent model preference

```bash
rdma26 profile:agent-model:set --agent scotty --model gpt-4.1-mini
```

## Pricing

### List model pricing records

```bash
rdma26 pricing:list --provider openai --model gpt-4.1-mini
```

Useful filters:

- `--provider openai`
- `--model gpt-4.1-mini`
- `--status active|superseded|unverified`

### Create a model pricing record

```bash
rdma26 pricing:create --provider openai --model gpt-4.1-mini --input 0.40 --output 1.60 --source-url "https://openai.com/api/pricing/" --status active
```

New records default to `unverified`. Use `--status active` only after checking the source.

Optional fields:

- `--cached-input <cost-per-million-tokens>`
- `--reasoning <cost-per-million-tokens>`
- `--currency USD`
- `--source-name "OpenAI API pricing"`
- `--source-retrieved-at <iso-timestamp>`
- `--valid-from <iso-timestamp>`
- `--valid-until <iso-timestamp>`
- `--notes "..."`

### Activate or supersede pricing

```bash
rdma26 pricing:activate --pricing <pricing-id>
rdma26 pricing:supersede --pricing <pricing-id>
```

Activating a pricing record supersedes the previous active record for the same provider and model.

## Observability

### List LLM calls

```bash
rdma26 llm-calls:list --agent scotty --limit 20
```

Useful filters:

- `--agent scotty`
- `--thread <thread-id>`
- `--run <run-id>`
- `--provider openai`
- `--model gpt-4.1-mini`
- `--purpose chat|research_parent|research_subagent|research_verification|thread_summary|memory_retrieval|memory_maintenance|operator|unknown`
- `--status success|error|cancelled`
- `--started-from <iso-timestamp-or-date>`
- `--started-to <iso-timestamp-or-date>`
- `--limit 100`

### Read one LLM call

```bash
rdma26 llm-calls:show --call <call-id>
```

### Summarize estimated costs

```bash
rdma26 costs:summary --started-from 2026-07-01 --group-by model
```

`--group-by` supports `day`, `agent`, `model`, and `purpose`. The same filters as `llm-calls:list` are available, except `--run` and `--limit`.

## Memories

### List or search memories

```bash
rdma26 memories:list --agent scotty --query "football" --tag world-cup --updated-from 2026-07-01
```

Useful filters:

- `--scope agent|agent_user|user`
- `--type fact|preference|conversation_summary|open_task|tracked_topic`
- `--lifetime permanent|active|temporary`
- `--status active|archived|superseded`
- `--tag <tag>`
- `--created-from YYYY-MM-DD`
- `--created-to YYYY-MM-DD`
- `--updated-from YYYY-MM-DD`
- `--updated-to YYYY-MM-DD`
- `--limit 20`

### Read one memory

```bash
rdma26 memories:read --memory <memory-id>
```

### Create a memory

```bash
rdma26 memories:create --agent scotty --scope agent --type fact --content "The user prefers concise status updates."
```

Use `--file ./memory.md` instead of `--content "..."` for longer content. Use `--tags football,preference` to add tags.

### Update a memory

```bash
rdma26 memories:update --memory <memory-id> --content "Updated memory content"
```

You can also update `--type`, `--status`, `--lifetime`, or `--tags`.

### Archive a memory

```bash
rdma26 memories:archive --memory <memory-id>
```

### Delete a memory

```bash
rdma26 memories:delete --memory <memory-id>
```

### Run memory maintenance

```bash
rdma26 memories:maintenance --agent scotty --limit 25
```

This consolidates thread-summary memories for one agent. Omit `--agent` to run maintenance for all agents. Agents with memory writes disabled are skipped and reported.

### Read memory maintenance schedule

```bash
rdma26 memories:maintenance:settings
```

### Configure memory maintenance schedule

```bash
rdma26 memories:maintenance:configure --enabled true --interval-minutes 1440 --limit 25
```

Use `--agent scotty` to limit scheduled maintenance to one agent. Omit `--agent` to cover all agents. Scheduled maintenance is disabled by default.

## Tools

### List registered tools

```bash
rdma26 tools:list
```

### Show tools for one agent

```bash
rdma26 agents:tools --agent research
```

For the protected operator agent, the response also includes `controlledTools`, which are read-only admin capabilities injected by the backend.

### Replace an agent's enabled tools

```bash
rdma26 agents:tools:set --agent ronaldo --tools research
```

Use a comma-separated list for multiple tools.

### Grant one tool

```bash
rdma26 agents:tools:grant --agent ronaldo --tool research
```

### Revoke one tool

```bash
rdma26 agents:tools:revoke --agent ronaldo --tool research
```

`research` is the recommended Deep Agents researcher subagent capability for normal agents. `internet_search` and `read_web_page` are lower-level primitives for specialized or debugging workflows.

## Threads

### List threads

```bash
rdma26 threads:list --agent scotty
```

### Create a thread

```bash
rdma26 threads:create --agent scotty --title "Planning"
```

`--title` is optional.

When possible, creating a new thread also creates a one-time summary for the previous latest non-empty thread for the same agent. The new thread is still created if summary creation is unavailable.

### Read a thread

```bash
rdma26 threads:read --agent scotty --thread <thread-id>
```

### Delete a thread

```bash
rdma26 threads:delete --agent scotty --thread <thread-id>
```

### Consolidate a thread summary memory

```bash
rdma26 threads:summary --agent scotty --thread <thread-id>
```

Creates the `conversation_summary` memory for the thread using an LLM if it does not already exist. Use `--model` to request a specific summary model.

If the thread already has a summary, the existing summary is returned. If no LLM provider is configured and the thread does not have a summary yet, no summary is created and the command returns an error.

### Create missing thread summary memories for an agent

```bash
rdma26 threads:summaries --agent scotty --limit 25
```

Creates missing summaries for multiple non-empty threads and reports skipped empty threads.

## Chat

### Send a message

```bash
rdma26 chat:send --agent scotty --thread <thread-id> --model gpt-4.1-mini --prompt "Hello"
```

The command appends the user message, runs the selected agent, stores the assistant response, and prints the result as JSON.

### Inspect run context

```bash
rdma26 runs:context --run <run-id>
```

The run id is included in `chat:send` output and in the API `run-started` event.

Run context includes LLM calls, token usage, and estimated costs when active model pricing exists.

## Options

### `--agent`

Agent id. Defaults to `ASSISTANT_AGENT_ID` or `scotty`.

### Environment

The CLI reads the same `.env` configuration as the backend, including:

- `ASSISTANT_DATA_DIR`
- `ASSISTANT_AGENT_ID`
- `ASSISTANT_AGENT_NAME`
- `OPENAI_API_KEY`
- `OPENAI_MODELS`
- `TAVILY_API_KEY`
