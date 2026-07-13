# Architecture

This document describes the implemented rdma26 architecture on the current
branch. Product direction and future acceptance criteria are defined in
[vision.md](./vision.md).

## System Shape

rdma26 is a local-first application with three interfaces over one backend
runtime:

```mermaid
flowchart LR
    UI["Angular UI"] --> HTTP["Fastify API and SSE"]
    CLI["rdma26 CLI"] --> RT["AssistantRuntime"]
    HTTP --> RT
    RT --> AG["Agent and chat services"]
    RT --> DATA["Storage and observability services"]
    AG --> DA["Deep Agents runtime"]
    DA --> LLM["OpenAI models"]
    DA --> CAP["Granted capabilities and skills"]
```

The Angular frontend does not contain model credentials, filesystem access, or
Deep Agents runtime behavior. HTTP routes and CLI commands delegate to the same
`AssistantRuntime` methods.

## Frontend

The Angular application uses standalone components, signals, routing, Tailwind
CSS, and shared API contracts.

Major user surfaces include:

- agent and thread selection;
- streamed chat runs;
- agent identity, model, tool, and memory settings;
- user profile and theme settings;
- long-term memory management;
- run-context inspection;
- LLM usage, pricing, and estimated costs.

The frontend treats the backend as the source of truth for shared profile,
agent, thread, memory, and observability data. Local storage is limited to
client-side convenience and synchronization behavior.

## Backend Runtime

`server/src/runtime.ts` composes the application services. It owns the shared
operations exposed through HTTP and CLI, including:

- agent lifecycle and configuration;
- thread lifecycle;
- chat runs;
- long-term memory CRUD and retrieval;
- profile synchronization;
- capability grants;
- run-context inspection;
- LLM call and cost queries;
- pricing and pricing-source management.

Fastify routes validate HTTP input and call this runtime. The CLI parses command
arguments and calls the same runtime directly.

## Agent Runtime

Each chat run creates a configured Deep Agent on the backend. The configuration
includes:

- the selected accounting-aware model;
- the agent's generated system prompt and `soul.md` identity;
- granted application tools;
- enabled Deep Agents middleware and skills;
- scoped memory backends and permissions;
- skills;
- the persistent LangGraph checkpointer.

Agents are stored separately by id. Threads belong to exactly one agent. Model,
capability, memory permission, identity, and chat visibility settings are
agent-specific.

The protected `scotty` operator receives controlled application administration
tools. It does not receive unrestricted shell access. The internal
`cost-analyst` agent receives controlled cost and pricing tools and has
long-term memory disabled.

## Chat Run Flow

```mermaid
sequenceDiagram
    participant C as UI or CLI
    participant R as AssistantRuntime
    participant S as ChatRunService
    participant A as Deep Agent
    participant L as Model and tools
    participant D as Local storage

    C->>R: Send agent, thread, prompt, optional model
    R->>S: Start shared chat workflow
    S->>D: Validate agent and thread, load configuration
    S->>A: Create and stream configured Deep Agent
    A->>L: Model and capability calls
    L-->>A: Responses and tool results
    A-->>S: Streamed activity and final response
    S->>D: Save message, run context, and accounting
    S-->>C: Final response and run id
```

LangGraph checkpoints preserve the Deep Agent state for a thread. The
application database separately stores messages as a UI/API/CLI read model.

## Capabilities And Skills

The capability registry owns application capabilities and their configuration
requirements. Normal capabilities can be granted or revoked per agent.
Protected capabilities are injected only for their system agent.

The `web_search` capability adds OpenAI's provider-hosted search tool to the
selected agent model. A built-in `web-research` skill supplies reusable source,
recency, and uncertainty guidance without introducing a second research model
or custom orchestration layer. Details are documented in
[research.md](./research.md).

The assignable `interpreter` capability adds the official Deep Agents QuickJS
middleware. It gives an agent an isolated `eval` tool for calculations and
deterministic structured-data transformations. Programmatic tool calling is not
enabled, and the interpreter has no host filesystem, network, shell, package,
credential, or clock access. It is not a replacement for a future sandbox used
for file work or controlled application execution.

## Memory And Context

The runtime keeps distinct context layers:

1. `soul.md` for stable agent identity;
2. skills for reusable instructions;
3. LangGraph checkpoint state for the current thread;
4. scoped Markdown files for curated long-term memory;
5. stored past conversations searched on demand.

Long-term memory details are documented in [memory.md](./memory.md).

## Models And Accounting

Chat models and embedding requests are created through accounting-aware
factories or adapters. Call records include model, purpose, agent, thread, run,
tokens, timing, and pricing snapshots where available.

This makes chat, maintenance, and embedding work separately inspectable. See
[observability.md](./observability.md).

Behavioral changes to prompts, tools, memory retrieval, delegation, or context
construction are measured with the versioned harness documented in
[evaluation.md](./evaluation.md).

## Storage

rdma26 uses:

- `.assistant-data/rdma26.sqlite` for application records and derived indexes;
- `.assistant-data/langgraph-checkpoints.sqlite` for LangGraph thread state;
- agent configuration and memory files under `.assistant-data/agents/`;
- global user memory under `.assistant-data/user/`.

See [storage.md](./storage.md) for ownership and lifecycle details.

## Current Architectural Boundaries

- The backend is local-first and currently designed for one authenticated user.
- OpenAI is the implemented model provider.
- OpenAI hosted web search is the implemented search provider.
- The QuickJS interpreter is available as an agent capability; a general
  execution sandbox is not yet enabled.
- Mobile access, multimodality, broad file work, and controlled script execution
  are long-term directions, not current features.
