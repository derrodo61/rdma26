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

### Set agent memory permissions

```bash
rdma26 agents:memory:set --agent research --can-read false
rdma26 agents:memory:set --agent research --can-write false
rdma26 agents:memory:set --agent research --can-read true --can-write true
```

When memory reads are disabled, pinned memory, on-demand memory directories, and past-conversation tools are unavailable to that agent. When memory writes are disabled, the agent does not receive `save_memory`.

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

Protected system agents cannot be deleted.

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
- `--active true|false`

### Create a model pricing record

```bash
rdma26 pricing:create --provider openai --model gpt-4.1-mini --input 0.40 --output 1.60 --source-url "https://developers.openai.com/api/docs/pricing"
```

New records are active immediately. A provider/model combination can have only one pricing record.

Optional fields:

- `--cached-input <cost-per-million-tokens>`
- `--reasoning <cost-per-million-tokens>`
- `--currency USD`
- `--source-name "OpenAI API pricing"`
- `--source-retrieved-at <iso-timestamp>`
- `--notes "..."`

### Update or deactivate pricing

```bash
rdma26 pricing:update --pricing <pricing-id> --input 0.40 --output 1.60
rdma26 pricing:active --pricing <pricing-id> --active false
rdma26 pricing:delete --pricing <pricing-id>
```

Updating prices automatically activates the record. Use `pricing:active` to deactivate or reactivate it explicitly.

`pricing:update` accepts the same editable fields as `pricing:create`. Use `none` for optional fields such as `--cached-input`, `--reasoning`, `--source-name`, or `--notes` when you want to clear a value.

### Check saved OpenAI prices against the official source

```bash
rdma26 pricing:sync-openai
```

This is a direct deterministic check, not an agent run. It fetches the configured official OpenAI pricing source, extracts the OpenAI pricing table, compares it with active saved OpenAI pricing records, and returns a compact diff without using an LLM.

Use `--apply true` to update input, cached-input, output, source, and retrieval data for existing model records. Missing official models are not created automatically.

```bash
rdma26 pricing:sync-openai --apply true
```

### List pricing source pages

```bash
rdma26 pricing-sources:list --provider openai --active true
```

Useful filters:

- `--provider openai`
- `--trust-level official|third_party|user_added`
- `--active true|false`

### Add or update a pricing source page

```bash
rdma26 pricing-sources:add --provider openai --name "OpenAI API pricing" --url "https://developers.openai.com/api/docs/pricing" --trust-level official
rdma26 pricing-sources:update --source <source-id> --active false
```

The default database seed includes the official OpenAI pricing page.

### Check or delete a pricing source page

```bash
rdma26 pricing-sources:check --source <source-id>
rdma26 pricing-sources:delete --source <source-id>
```

Checking a source updates its last checked, last success, and last error fields.

Cost Analyst can use configured pricing sources through its controlled tools and `pricing-source-analysis` Deep Agents skill. For OpenAI model-price checks it has a dedicated `admin_sync_openai_model_pricing` tool that fetches the official OpenAI pricing page, extracts model prices deterministically, and returns a compact comparison without changing saved pricing records.

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

### Ask the Cost Analyst

```bash
rdma26 optimizer:ask --prompt "Which agent cost the most this week, and what should I optimize first?"
```

Optional flags:

- `--title "Cost review"`
- `--model gpt-4.1-mini`

This uses the same internal optimizer runtime as the API. The Cost Analyst can inspect local LLM call records, pricing records, run context, and model settings through protected tools. It can compare saved OpenAI pricing against the configured official OpenAI pricing source with a deterministic sync tool and research other provider pricing. It changes pricing only when the user explicitly approves the change.

## Memories

### List or search memories

```bash
rdma26 memories:list --agent scotty --query "football" --tag world-cup --pinned true --updated-from 2026-07-01
```

Useful filters:

- `--scope agent|agent_user|user`
- `--pinned true|false`
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

### Inspect pinned startup budgets

```bash
rdma26 memories:budgets --agent scotty
```

Returns used and maximum characters for each applicable memory scope.

### Create a memory

```bash
rdma26 memories:create --agent scotty --scope agent --content "The user prefers concise status updates." --pinned true
```

Use `--file ./memory.md` instead of `--content "..."` for longer content. Use `--tags football,preference` to add tags. Pinned memories are included in every applicable memory-enabled run.

### Update a memory

```bash
rdma26 memories:update --memory <memory-id> --content "Updated memory content" --pinned false
```

You can also update `--pinned` or `--tags`.

### Delete a memory

```bash
rdma26 memories:delete --memory <memory-id>
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

For protected system agents, the response also includes `controlledTools`, which are controlled admin and inspection capabilities injected by the backend.

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

`research` is the recommended Deep Agents researcher subagent capability for normal agents. `internet_search`, `read_web_page`, and `read_web_page_structure` are lower-level primitives for specialized or debugging workflows. `read_web_page_structure` preserves page structure through focused modes such as `tables`, `headings`, `links`, `lists`, `markdown`, and `full`.

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

### Read a thread

```bash
rdma26 threads:read --agent scotty --thread <thread-id>
```

### Delete a thread

```bash
rdma26 threads:delete --agent scotty --thread <thread-id>
```

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

## Evaluation

### List versioned evaluation cases

```bash
rdma26 evals:list
```

This command does not call a model. It returns the suite version, case metadata,
required capabilities, prompts, and assertions.

### Run an evaluation suite

```bash
rdma26 evals:run --suite smoke --model gpt-5.4-mini
```

Suites are `smoke`, `research`, `memory`, and `core`. The default is `smoke`.
The current `core` suite also contains a focused interpreter transformation
case; list cases to see their required capabilities and assertions.

Run selected cases instead of a complete suite:

```bash
rdma26 evals:run --cases direct-known-fact,thread-follow-up
```

Use `--keep-data true` to preserve temporary evaluation agents, threads, run
contexts, and LLM calls for debugging. Without it, temporary data is removed
after the JSON report is written.

Reports are stored under `.assistant-data/evaluations/`. Live evaluations
require `OPENAI_API_KEY`; research cases also require `TAVILY_API_KEY`.

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
