# Observability And Cost Control

This document describes the implemented LLM, embedding, run-context, pricing,
and cost-accounting behavior.

## Goals

rdma26 records model work so the user can answer:

- which agent or internal job made a call;
- which model and provider were used;
- how many tokens were reported;
- how long the call took;
- what context was sent when prompt inspection is available;
- what the call approximately cost;
- how a run expanded into model, tool, or embedding work.

Cost values are estimates based on saved pricing, not provider invoices.

## Accounted Work

The central model factory and accounting adapters cover:

- normal chat calls;
- protected operator calls;
- hosted web-search chat calls;
- memory and thread maintenance calls where still applicable;
- optimizer/cost-analysis calls;
- OpenAI embedding requests used by semantic memory retrieval.

New LLM or embedding integrations must use the same accounting-aware creation
path. Direct provider clients in feature code would make usage incomplete.

## LLM Call Records

Each provider request can record:

- call id and parent run id;
- provider run and parent-provider-run identifiers;
- agent and thread;
- purpose;
- provider and model;
- started and finished timestamps;
- duration and status;
- input, cached-input, output, reasoning, and total tokens when reported;
- error details;
- selected metadata;
- the pricing snapshot and estimated cost components.

Calls begin in a non-success state and are finalized after the provider returns
or fails. Failed and cancelled calls remain observable instead of disappearing.

## Purposes

Purpose labels separate different kinds of work, including chat, operator work,
memory retrieval, optimization, and other internal jobs. Purpose is an
accounting dimension, not an agent identity.

## Embedding Observability

Semantic memory search records only real embedding-provider requests:

- indexing a new or changed memory records an embedding call;
- embedding a semantic query records an embedding call;
- reusing a cached memory vector does not create a fake provider call;
- exact-text matches can avoid semantic embedding work;
- metadata distinguishes indexing from query work.

Embedding calls appear in the Usage and Run context pages. They can remain
unpriced when no active pricing record exists for their model.

## Run Context

A run-context snapshot associates the final chat result with the information
needed for debugging and evaluation, including:

- agent, thread, model, prompt, and assistant response;
- agent identity and user-profile context;
- messages supplied to the run;
- memory included or retrieved;
- enabled tools and recorded tool calls;
- hosted-search actions, provider-reported source URLs, and final citations;
- skill files actually loaded through progressive disclosure;
- token totals;
- linked LLM and embedding calls.

Run context may contain sensitive prompts, messages, memory, and tool data. It
is local application data and should not be exposed without authentication.

The `skillsUsed` list records a skill only when the agent reads its full
`SKILL.md` file. Skill metadata advertised in the system prompt is not counted
as use. The Run context page shows the loaded skill name and virtual path.

## Model Pricing

Pricing records are unique by provider and model. A record contains the prices
needed by the current estimator, its currency, source URL, retrieval metadata,
and active state.

The OpenAI sync path reads the configured official pricing source and updates
saved model prices. Updated records become active automatically; the user can
deactivate a record manually.

Pricing sources are stored separately so official source URLs can be inspected,
checked, changed, and extended for additional providers later.

## Cost Calculation

When a call finishes, the backend looks up the active pricing record applicable
to its provider and model and stores a pricing snapshot with the call.

The estimate uses provider-reported token classes where prices are available:

```text
input cost = uncached input tokens / 1,000,000 × input price
cached cost = cached input tokens / 1,000,000 × cached-input price
output cost = output tokens / 1,000,000 × output price
estimated total = input cost + cached cost + output cost
```

If required pricing is unavailable, the call remains recorded and is marked
unpriced. Later price changes do not silently rewrite the snapshot attached to
an older call.

## User Surfaces

### UI

The Costs area provides Usage and Pricing views. Run context exposes the calls
for an individual run. Agent settings control the chat model, which also powers
hosted web search when that capability is granted.

### API

The API exposes LLM calls, cost summaries, run contexts, pricing records,
pricing sources, and OpenAI pricing synchronization. See [api.md](./api.md).

### CLI

The CLI can list and inspect calls, summarize costs, manage pricing and sources,
inspect run context, and ask the Cost Analyst. See [cli.md](./cli.md).

## Retention And Cleanup

Deleting a thread removes its dependent run contexts and LLM-call records.
Startup removes orphaned records whose owning thread no longer exists.

Long-term aggregation and configurable telemetry retention are not implemented.
They should be added only when real data volume requires them.

## Current Limitations

- Estimates depend on complete provider usage metadata and correct active
  pricing.
- External search, scraping, and sandbox-provider costs are not included unless
  separately integrated.
- Prompt/context inspection is intended for debugging and may not reconstruct
  every provider-internal transformation.
- Hosted search quality and cost depend strongly on the user-selected model and
  must be tracked with the stable evaluation suite.
- Pricing synchronization currently targets OpenAI.
