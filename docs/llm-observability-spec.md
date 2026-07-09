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

Model prices change. The system should store pricing as versioned records with source metadata.

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
  validFrom?: string;
  validUntil?: string;
  status: 'active' | 'superseded' | 'unverified';
  notes?: string;
}
```

Costs should be calculated from the pricing record that was active when the LLM call finished. If no pricing is known, the call should still be logged with token usage and `estimatedTotalCost` left empty.

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

The first implementation does not need to store the full raw prompt for every internal call if that becomes too large or sensitive. It should at least store structured references plus token counts. Full prompt capture can be a debug setting.

## Storage

SQLite should be the source of truth.

Planned tables:

- `llm_calls`
- `model_pricing`
- `llm_call_context_items`

`llm_call_context_items` can map an LLM call to included memories, messages, summaries, tools, profile snapshot, and other context parts.

This should live in `.assistant-data/rdma26.sqlite` with the existing memory, thread, message, and run-context records.

## Pricing Updates

The first version should support manual pricing records through API and CLI.

Later, a specialized cost/optimization agent can help maintain pricing by:

- finding official pricing pages
- saving source URLs
- reading pricing pages periodically
- suggesting updated pricing records
- marking old pricing as superseded

The agent should not silently change pricing without leaving a trace. Price updates affect cost reporting, so they should be auditable.

## Cost Calculation

Estimated cost:

```text
inputCost = inputTokens / 1_000_000 * inputCostPerMillionTokens
outputCost = outputTokens / 1_000_000 * outputCostPerMillionTokens
totalCost = inputCost + outputCost
```

If cached input or reasoning-token pricing is available, those token categories should be calculated separately.

All costs are estimates. Provider billing can include details not visible to the app, such as discounts, cached-token rules, batch pricing, failed-call billing, or future provider-specific token categories.

## UI Surfaces

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
rdma26 pricing:supersede --pricing <id>
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

- Add model settings for research subagents, summaries, and maintenance.
- Expose these settings in UI and CLI.
- Store settings in backend profile or system configuration instead of hardcoding.

### Phase 5: Cost/Optimization Agent

- Add an internal agent that can inspect LLM calls, pricing, and settings.
- Let it answer cost and optimization questions.
- Later, let it propose pricing updates based on official pricing pages.

## Open Questions

### Where should model settings live?

Options:

- per-agent settings
- global system settings
- user profile settings
- a dedicated model-configuration table

The answer may differ for normal chat models, research models, and maintenance models.

### Should full prompts be stored?

Full prompts are useful for debugging and optimization, but can contain sensitive user data and can grow large.

Options:

- never store full prompts
- store only context item references and token counts
- store full prompts only when debug mode is enabled
- store full prompts for local-only operator users

### How exact should cost calculations be?

Provider pricing can include cached tokens, batch discounts, model-specific token categories, and billing details not exposed by the API response. We need to decide whether `rdma26` reports approximate cost, billing-like cost, or both.

### How should pricing updates be approved?

If a cost/optimization agent finds a new price, should it:

- only suggest the change
- create an unverified pricing record
- update pricing after explicit user approval
- periodically check and notify

### How long should LLM call records be kept?

Options:

- keep forever
- keep detailed records forever because the app is local-first
- keep aggregates forever but expire detailed context after a time
- allow manual cleanup only

### Should failed calls count toward estimated cost?

Some providers may bill failed or partial calls differently. We need a provider-aware policy.

### Should cost be visible in normal chat?

Possibilities:

- only in run inspector
- small cost indicator under each assistant message
- dashboard only
- configurable visibility

### Should optimization ever happen automatically?

The first answer should probably be no. The system can suggest cheaper model choices, but changing model configuration should require user approval.
