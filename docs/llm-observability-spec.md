# LLM Observability And Cost Control Spec

This document describes the planned observability, pricing, and cost-control system for `rdma26`.

The current project already stores chat threads, messages, memories, run contexts, tool calls, and token usage when the agent runtime returns it. This spec defines the next layer: a reliable way to see which LLM calls happened, why they happened, what they cost, and how to optimize model choices and context usage.

## Goal

The user should be able to understand and optimize LLM usage across the whole local multi-agent system.

The system should answer questions such as:

- How many LLM requests did this chat message trigger?
- How many LLM requests did a delegated research task trigger?
- Which agent, model, tool, or subagent is most expensive?
- How much did this thread, day, agent, or capability cost?
- Which model was used for normal chat, research planning, researcher subagent work, memory summaries, and maintenance?
- How large was the context window for a run?
- Which memories, thread summaries, messages, tools, and profile data were included in the model context?
- Would a cheaper model be good enough for summaries, research planning, or maintenance?

The first implementation should focus on trustworthy raw accounting. Optimization agents and dashboards should build on top of that data, not replace it.

## Non-Goals

The first version should not:

- depend on a cloud analytics service
- require sending usage data outside the local machine
- guess costs without recording the pricing source and pricing date
- optimize prompts or model choices automatically without user approval
- hide subagent calls inside one opaque parent run
- treat provider billing estimates as exact financial accounting

## Conceptual Model

```text
User message
  -> chat run
      -> one or more LLM calls
      -> optional tool calls
      -> optional subagent task
          -> one or more child LLM calls
          -> optional search/read/tool calls
      -> assistant message
      -> run context
      -> cost and usage records
```

The important idea is that a chat run is not always one LLM request.

Example:

```text
Ronaldo receives a current sports question
  -> domain agent LLM call decides research is needed
  -> researcher subagent LLM call plans search
  -> search/read tools run
  -> researcher subagent LLM call verifies sources
  -> domain agent LLM call writes the final answer
```

The UI should be able to show this as one user-visible answer with several internal LLM calls.

## Data Model

### LLM Call Record

Every provider model request should create one structured record.

```ts
type LlmCallStatus = 'success' | 'error' | 'cancelled';

interface LlmCallRecord {
  id: string;
  runId: string;
  parentCallId?: string;
  agentId?: string;
  threadId?: string;
  messageId?: string;
  provider: string;
  model: string;
  purpose: LlmCallPurpose;
  status: LlmCallStatus;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  requestStartedAt: string;
  requestFinishedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  pricingSnapshotId?: string;
  estimatedInputCost?: number;
  estimatedOutputCost?: number;
  estimatedTotalCost?: number;
  metadata?: Record<string, unknown>;
}
```

`parentCallId`

Used when a call is made because of another LLM call, for example a parent agent delegating to a researcher subagent.

`runId`

Links the call to the user-visible run context.

`purpose`

Explains why the call happened. See the purpose taxonomy below.

`pricingSnapshotId`

Links the usage record to the pricing values that were used to calculate estimated cost at the time.

### Purpose Taxonomy

The first version should support these purposes:

```ts
type LlmCallPurpose =
  | 'chat'
  | 'research_parent'
  | 'research_subagent'
  | 'research_verification'
  | 'thread_summary'
  | 'memory_retrieval'
  | 'memory_maintenance'
  | 'operator'
  | 'unknown';
```

The purpose should be assigned by the backend runtime at the point where the call is made. It should not be inferred later from free-form logs.

### Pricing Record

Model prices change. The system stores one current pricing record per provider and model, with source metadata.

```ts
interface ModelPricingRecord {
  id: string;
  provider: string;
  model: string;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  cachedInputCostPerMillionTokens?: number;
  reasoningCostPerMillionTokens?: number;
  currency: string;
  sourceUrl: string;
  sourceName?: string;
  sourceRetrievedAt: string;
  status: 'active' | 'inactive';
  notes?: string;
}
```

Costs should be calculated from the pricing record that was active when the LLM call finished. Creating or updating a pricing record makes it active. The user can deactivate it explicitly. If no active pricing is known, the call should still be logged with token usage and `estimatedTotalCost` left empty.

### Context Snapshot

Token counts alone are not enough. The user also needs to understand what was sent to the model.

The existing run-context inspector already stores many useful parts. The observability system should extend or normalize this information so every LLM call can show:

- system or bootloader prompt identity
- agent `soul.md` virtual path and content hash
- user profile settings included
- memory ids included
- thread summary ids included
- message ids included
- enabled tools and controlled tools
- subagent name when applicable
- context token estimate if available

By default, LLM call records should store structured context references, not the full prompt payload.

Example:

```json
{
  "llmCallId": "call-123",
  "contextItems": [
    {
      "type": "soul",
      "agentId": "ronaldo",
      "path": "configuration/soul.md",
      "contentHash": "..."
    },
    { "type": "user_profile", "profileVersion": "2026-07-09T12:00:00.000Z" },
    { "type": "memory", "memoryId": "mem-1", "tokens": 120 },
    { "type": "message", "messageId": "msg-1", "tokens": 42 },
    { "type": "tool_schema", "toolId": "research", "tokens": 300 }
  ]
}
```

Structured references make it possible to inspect what shaped a model call without duplicating sensitive text into every accounting record. They also make cost optimization easier because the app can show how many tokens came from memories, thread history, tool schemas, profile data, and agent identity.

Full prompt capture should exist, but only as an explicit local debug setting. When enabled, the system may store the exact raw prompt or message payload sent to the provider in addition to the structured references.

Full prompt capture must be:

- off by default
- clearly marked as sensitive
- local-only
- visible in settings
- easy to disable
- easy to purge

This gives two modes:

```text
normal mode:
  structured context references + token counts

debug prompt-capture mode:
  structured context references + token counts + exact full prompt payload
```

## Storage

SQLite should be the source of truth.

Planned tables:

- `llm_calls`
- `model_pricing`
- `llm_call_context_items`

`llm_call_context_items` can map an LLM call to included memories, messages, summaries, tools, profile snapshot, and other context parts.

This should live in `.assistant-data/rdma26.sqlite` with the existing memory, thread, message, and run-context records.

## Retention And Cleanup

LLM call records should be kept indefinitely by default.

This is a local-first personal app, so long-term usage history is valuable for debugging, cost analysis, model comparison, and optimization. Records should not expire automatically in the first implementation.

The user must have manual cleanup controls through UI, CLI, and API. Cleanup should support:

- deleting LLM call records older than a chosen date
- deleting records for a specific agent
- deleting records for a specific thread
- deleting failed-call records if desired
- purging full prompt payloads independently from usage records

Full prompt payloads are more sensitive than usage records. If debug prompt capture is enabled, prompt payloads should be purgeable without deleting the corresponding usage, token, timing, and cost metadata.

Deleting a thread or agent should delete associated LLM call records and prompt payloads to avoid orphaned accounting data. Aggregated cost summaries can be recalculated from remaining detailed records unless a future implementation adds durable aggregate snapshots.

## Pricing Updates

The first version should support manual pricing records through API and CLI.

Pricing source pages should be stored separately from price records. The source registry is application data and should live in SQLite so it can be listed, checked, edited, deactivated, or deleted through UI/API/CLI and protected operator tools.

The initial source registry includes:

```text
Provider: openai
Name: OpenAI API pricing
URL: https://developers.openai.com/api/docs/pricing
Trust level: official
```

Pricing source records should store:

- provider
- name
- URL
- trust level: `official`, `third_party`, or `user_added`
- active flag
- notes
- last checked timestamp
- last successful check timestamp
- last error
- created and updated timestamps

For configured official pricing sources, Cost Analyst should prefer source-specific deterministic ingestion when the provider and page shape are known. OpenAI model-price comparison uses `admin_sync_openai_model_pricing`, which fetches the configured official OpenAI pricing page, extracts the model pricing table, compares saved active OpenAI pricing records against official standard short-context input/output prices, and returns a compact diff without changing saved records.

The generic `read_web_page_structure` tool still fetches a known source URL and supports focused extraction modes, including `tables`, `headings`, `links`, `lists`, `markdown`, and `full`. It is useful for known-page inspection, non-OpenAI providers, debugging source structure, and fallback work. It should not be forced to become a hidden one-use-case OpenAI pricing parser.

When a provider page lists multiple dimensions, such as short-context pricing, long-context pricing, cached input, or cache writes, the comparison must name those dimensions explicitly instead of flattening everything into one generic price verdict. The current local pricing schema stores flat input, cached-input, output, and optional reasoning costs, so cache-write and long-context prices are reported as metadata unless the schema is extended.

Later, a specialized cost/optimization agent can help maintain pricing by:

- reading configured official pricing pages first
- finding new official pricing pages when configured sources no longer work
- saving source URLs in the source registry
- reading pricing pages periodically
- extracting candidate prices for user review
- notifying the user/operator when prices may have changed

Pricing updates use a suggestion, review, approve flow. A suggestion is presented to the user without creating another pricing record. After explicit approval, the existing record is updated in place and becomes active. New provider/model combinations create one active record. The user can deactivate a record manually when its prices should not be used.

Periodic checks may create suggestions or notifications, but must not automatically alter active cost calculations. Source URL and retrieval date remain on the record so the current values are auditable. Historical LLM calls retain their already-calculated cost estimates.

## Cost Calculation

The system distinguishes usage from cost.

`Usage`

Token counts, call counts, model ids, durations, and statuses. Usage is factual when the provider or runtime returns it.

`Estimated cost`

Cost calculated from usage plus the model-pricing record active at the time of calculation.

Estimated cost:

```text
inputCost = inputTokens / 1_000_000 * inputCostPerMillionTokens
outputCost = outputTokens / 1_000_000 * outputCostPerMillionTokens
totalCost = inputCost + outputCost
```

If cached input or reasoning-token pricing is available, those token categories should be calculated separately.

All costs must be labeled as estimates in UI, API, and CLI output. Provider billing can include details not visible to the app, such as discounts, cached-token rules, batch pricing, failed-call billing, account-level discounts, rounding, or future provider-specific token categories.

Cost displays should include or link to:

- provider
- model
- usage values used in the calculation
- pricing snapshot id
- pricing source URL
- pricing retrieval date
- unknown or unpriced token categories

Exact billing reconciliation is out of scope for the first implementation. The system should prefer honest partial estimates over pretending to know exact provider bills.

Failed LLM calls should still be logged with `status: 'error'`. If provider usage metadata is available for a failed call, estimated cost should be calculated normally from that usage. If usage metadata is unavailable, estimated cost remains empty or unknown. The first implementation does not need provider-specific failure billing rules.

## UI Surfaces

Estimated cost should not be shown inline in normal chat by default.

Normal chat should stay focused on the conversation. Most individual message costs are small, and always-visible cost labels would add noise. Detailed cost belongs in inspection and dashboard surfaces.

The app can add an optional compact per-message cost indicator later for users who want constant visibility, but it should be off by default.

### Run Context Page

The run-context page should show:

- total estimated cost for the run
- total LLM calls
- total input/output tokens
- calls grouped by parent agent, subagent, and purpose
- model used for each call
- duration and status for each call
- sources and tool calls alongside the LLM calls that caused them

For research runs, the user should be able to see whether the answer required one, two, or several LLM calls.

### Cost Dashboard

A later dashboard should show:

- cost by day/week/month
- cost by agent
- cost by model
- cost by purpose
- most expensive runs
- most expensive threads
- token trends
- failed-call counts

### Agent Settings

Agent settings should expose model choices that affect cost:

- normal chat model
- research coordinator/domain model when applicable
- researcher subagent model
- thread-summary model
- memory-maintenance model

LLM-backed capabilities should declare their model slots so the UI, CLI, API, and cost accounting can all refer to the same settings.

Examples:

```text
research:
  researcherModel
  verificationModel

thread_summary:
  summaryModel

memory_maintenance:
  maintenanceModel
```

The first version may show only the settings that already exist and add the research model settings next.

## CLI Surfaces

Potential commands:

```bash
rdma26 llm-calls:list --agent ronaldo --since 2026-07-09
rdma26 llm-calls:show --call <id>
rdma26 costs:summary --since 2026-07-01 --group-by agent
rdma26 costs:runs --limit 20
rdma26 pricing:list
rdma26 pricing:create --provider openai --model gpt-5.4-mini --input 0.00 --output 0.00 --source-url "..."
rdma26 pricing:active --pricing <id> --active false
```

The exact command names can change, but API, CLI, and UI should use the same backend services.

## API Surfaces

Potential endpoints:

```http
GET /api/llm-calls
GET /api/llm-calls/:callId
GET /api/runs/:runId/llm-calls
GET /api/costs/summary
GET /api/model-pricing
POST /api/model-pricing
PATCH /api/model-pricing/:pricingId
```

The OpenAPI docs should include these endpoints once implemented.

## Cost/Optimization Agent

A specialized internal agent can be useful after raw logging and pricing exist.

Possible name ideas:

- `cost-analyst`
- `accountant`
- `quartermaster`
- `optimizer`

This agent should be an internal or operator-style agent, not a normal chat personality by default.

It may be allowed to:

- inspect LLM call records
- inspect pricing records
- inspect run contexts
- inspect model settings
- suggest cheaper model configurations
- find official pricing sources
- draft pricing updates

It should not:

- silently change model settings
- silently change pricing
- delete accounting data
- send usage data to external services unless the user explicitly permits it

Optimization must be advisory by default.

The system and future optimization agent may:

- detect expensive runs
- explain why a run was expensive
- compare model usage and estimated cost
- suggest cheaper model choices
- suggest context-window reductions
- suggest different summary, maintenance, or research models
- draft configuration changes

But applying changes requires explicit user approval through UI, CLI, or API. The default optimization flow is:

```text
observe -> analyze -> suggest -> user approves -> apply
```

The system must not silently change agent chat models, research models, summary models, maintenance models, enabled tools, context selection rules, or pricing records.

Automatic optimization can be reconsidered later only as an explicit opt-in mode with clear boundaries, visible change history, and rollback.

## Model Call Interception

All backend LLM instances should be created through one central accounting-aware model factory or model registry.

Backend code should not instantiate provider models directly in feature modules. For example, direct `new ChatOpenAI(...)` usage should be limited to the factory. Chat runs, researcher subagents, summaries, memory maintenance, and future operator workflows should all receive model instances from the same factory.

Conceptually:

```ts
const model = modelRegistry.createModel({
  provider: 'openai',
  model: 'gpt-5.4-mini',
  purpose: 'research_subagent',
  runId,
  agentId,
  parentCallId,
});
```

The factory should return a wrapped model that records every invocation.

This is the project rule:

- every LLM call should pass through the accounting-aware model factory
- the factory assigns provider, model, purpose, run id, agent id, and parent/child relationship
- the wrapper records timestamps, status, token usage, duration, errors, and pricing snapshot when available
- parent agent calls and researcher subagent calls must both use the same accounting path
- direct provider model construction outside the factory should be treated as a bug

Implementation still needs to verify the exact LangChain and Deep Agents TypeScript hooks for token usage and subagent calls, but the design decision is settled: logging happens at model creation/invocation time through one shared factory path.

## Model Configuration

Model settings should be backend-owned and editable live through UI, CLI, and API.

The configuration should be layered:

```text
per-agent or per-capability override
  -> global system model default
  -> built-in fallback model
```

Examples:

```text
Ronaldo chat model:
  Ronaldo chat model override
  else global default chat model
  else built-in fallback

Ronaldo research model:
  Ronaldo research capability override
  else global default research model
  else built-in fallback

Thread-summary model:
  agent summary override if one exists
  else global default summary model
  else built-in fallback
```

The user profile should keep UI preferences and last-used selections. It should not be the main source of backend runtime model configuration.

Changing a model in the chat composer should update the backend-owned chat model setting for that agent. It should not live only in browser local storage.

Any LLM-backed capability or tool workflow must declare its configurable model slots. When the capability is enabled for an agent, those model slots should be visible and editable where the capability is configured. For example, enabling `research` should expose the research subagent model settings for that agent.

This gives:

- UI/API/CLI parity
- consistent behavior across computers
- predictable cost analysis
- a clean path for future optimization suggestions

## Implementation Phases

### Phase 1: Raw LLM Call Logging

- Add SQLite tables for LLM call records.
- Add a central accounting-aware model factory or model registry.
- Move direct provider model construction behind that factory.
- Wrap all backend model calls with a small accounting service at model invocation time.
- Store provider, model, purpose, run id, agent id, thread id, timestamps, status, and token usage when available.
- Link subagent calls to the parent run.
- Show LLM calls in the run-context page.

### Phase 2: Pricing Catalog

- Add model-pricing records.
- Add API and CLI for listing and editing prices.
- Calculate estimated cost for each LLM call when pricing is available.
- Show run-level estimated cost in the run-context page.

### Phase 3: Aggregated Statistics

- Add cost summary queries.
- Add CLI summaries by day, agent, model, and purpose.
- Add a first UI dashboard or memory/settings subpage for cost inspection.

### Phase 4: Configurable Internal Models

- Add backend-owned global model defaults.
- Add per-agent and per-capability model overrides.
- Expose these settings in UI, API, and CLI.
- Move composer-selected chat models from browser-only storage to backend-owned agent model settings.
- Store capability model slots explicitly so LLM-backed tools can declare and display their configurable models.

### Phase 5: Cost/Optimization Agent

- Add an internal agent that can inspect LLM calls, pricing, and settings.
- Let it answer cost and optimization questions.
- Later, let it propose pricing updates based on official pricing pages.
