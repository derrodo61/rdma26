# rdma26 Product Vision

Status: authoritative product direction

This document defines what rdma26 is intended to become and how progress is
judged. Architecture documents and implementation specifications must support
this vision. When a lower-level document conflicts with this one, update or
remove the lower-level document instead of silently changing the product goal.

## Product Goal

rdma26 is a local-first, multi-agent personal AI assistant. Agents have
configurable identities, job descriptions, models, capabilities, and scoped
memory. They should flexibly plan tasks using general-purpose capabilities,
provide reliable answers with appropriate sources and uncertainty, remember
relevant information across conversations, and make model usage and costs
transparent.

Core functionality must be available consistently through the UI, API, and
CLI. These interfaces use the same application services and must not implement
different versions of the same behavior.

## User-Facing Promises

### Distinct agents

The user can create agents for different roles. Each agent keeps a stable
identity and can have its own model, capabilities, instructions, conversations,
and local memory. Information intended for all agents can be stored separately
as global user memory.

### Reliable assistance

Agents should answer ordinary questions directly and plan multi-step work when
needed. They should use external sources for current or otherwise uncertain
facts, distinguish evidence from derived results, and state uncertainty instead
of filling gaps with confident guesses.

### Flexible capabilities

Agents should combine a small set of general capabilities to solve new tasks.
The application should not require a new tool for every variation of a user
question. Skills may teach repeatable workflows, while deterministic code may
perform calculations, validation, and structured transformations.

### Useful memory

The assistant should reduce repeated explanations by recalling relevant facts,
preferences, decisions, and prior work. Memory must remain scoped, inspectable,
editable, and removable. Irrelevant or stale information should not silently
flood the context window or override current evidence.

### Cost transparency and control

Every LLM and embedding request should be attributable to the agent, thread,
run, purpose, and model that produced it. The user should be able to inspect
calls, tokens, context, latency, and estimated cost, then configure models and
capabilities accordingly.

### First-class interfaces

Anything the product exposes as core functionality should be available through
the API and CLI as well as the Angular UI. All three interfaces should call the
same domain services.

## Design Principles

- Prefer general capabilities over tools designed for individual questions or
  examples.
- Let agents plan how capabilities are combined. Use fixed orchestration only
  where deterministic product behavior genuinely requires it.
- Use skills for reusable workflow guidance, domain knowledge, and operating
  constraints.
- Use deterministic code for calculations, validation, and structured
  transformations.
- Prefer documented LangChain, LangGraph, and Deep Agents mechanisms before
  creating custom runtime behavior.
- Preserve clear boundaries between sourced facts, assumptions, calculations,
  memory, and final answers.
- Do not present unsupported claims as verified. Communicate uncertainty in
  plain language.
- Keep agent identity, conversations, models, capabilities, and local memory
  correctly scoped.
- Keep memory relevant, inspectable, and cost-conscious.
- Route all LLM and embedding requests through accounting-aware factories.
- Evaluate behavior with stable test cases rather than relying on one successful
  conversation.
- Remove superseded behavior instead of accumulating unused compatibility paths
  during early development.

## Current Non-Goals

The next milestone does not require:

- unrestricted shell or host-filesystem access for ordinary agents;
- a dedicated tool for every calculation, domain, or question shape;
- perfect factual knowledge without external evidence;
- autonomous high-impact actions without appropriate permissions or approval;
- production multi-user tenancy;
- cloud-first deployment;
- support for every model provider;
- a fully autonomous memory system that cannot be inspected or corrected;
- preserving compatibility with experimental behavior that has no external
  users.

These may be reconsidered later, but they must not distract from proving the
core personal-assistant experience.

## Long-Term Product Direction

rdma26 should become the user's primary personal AI interface across desktop
and mobile. It should support conversation, multimodal content, files,
controlled code execution, external applications, and long-running tasks while
keeping agent identity, memory, permissions, costs, and data ownership under the
user's control.

This direction is broader than the next milestone. It should guide architecture
without causing unfinished foundational work to be bypassed by additional
features.

### Mobile access

- Provide a responsive interface that works comfortably on smartphones and
  tablets.
- Allow authenticated remote access to the locally running backend without
  making cloud hosting mandatory.
- Keep agents, threads, profile settings, memory, and generated artifacts
  consistent across devices.
- Support streaming, reconnection, and eventually notifications for long-running
  work.
- Preserve the option to add a progressive web app or native mobile client
  later.

### Multimodal interaction

- Understand uploaded images and screenshots.
- Generate and edit images.
- Read and create audio where supported, including a possible voice interface.
- Work with PDFs and other documents without reducing them to unstructured chat
  text when richer handling is available.

### File work

- Upload, inspect, create, edit, and download files.
- Create useful artifacts such as documents, spreadsheets, presentations, PDFs,
  images, source code, and archives.
- Keep file access explicitly scoped to approved locations or isolated
  workspaces.
- Make generated and modified artifacts inspectable through UI, API, and CLI.

### Code and script execution

- Use a lightweight interpreter for calculations, structured transformations,
  and tool composition inside the agent loop.
- Use isolated sandboxes when tasks require scripts, packages, files, shell
  commands, or longer-running computation.
- Allow agents to create programs dynamically when a task does not justify a
  dedicated application tool.
- Record execution inputs, outputs, timing, failures, and resource usage.
- Do not give ordinary agents unrestricted access to the host operating system
  by default.

### Application integration

- Integrate with browsers, calendars, email, databases, messaging, and other
  applications through typed tools, MCP servers, plugins, or controlled APIs.
- Make capabilities grantable and revocable per agent.
- Require explicit permission or human approval for sensitive, destructive,
  externally visible, or financially significant actions.
- Keep an auditable record of application actions performed on the user's
  behalf.

### Security and control

The risk of a capability depends on what it can affect. Reading a document,
creating a file, executing code, sending a message, and purchasing something
must not be treated as equivalent operations.

Long-term capability expansion therefore requires:

- capability-specific permissions;
- sandboxing or equivalent isolation for untrusted execution;
- narrow access to credentials and user data;
- human approval where consequences warrant it;
- clear activity and audit history;
- limits on time, memory, network access, output, and spending;
- safe cleanup of temporary environments and generated data.

## Next Milestone

A configured agent can reliably answer a representative set of direct,
researched, calculated, multi-step, and memory-dependent questions using
general-purpose capabilities. Its sources, uncertainty, memory usage, model
calls, tokens, context size, latency, and estimated costs are inspectable.

The milestone is about repeatable behavior, not the number of implemented
features.

## Evaluation Set

The stable evaluation set should cover at least:

1. A direct question that does not require tools.
2. A current factual question requiring external research.
3. A question requiring more than one independent source.
4. A deterministic calculation using supplied values.
5. A task combining researched facts with a calculation.
6. A multi-step task requiring an explicit plan.
7. A question whose evidence is incomplete or contradictory.
8. Agent-local memory recalled in a new thread.
9. Global user memory recalled by more than one agent.
10. Irrelevant memory correctly excluded from a run.
11. Cross-agent local-memory isolation.
12. A follow-up that depends on the current thread.
13. Recall of a relevant earlier conversation.

Evaluation prompts and expected outcomes must be versioned. Tests involving
live external facts should define how freshness and changing source content are
handled instead of treating one historical answer as permanently correct.

## Measurements

For each evaluated run, record:

- required and returned facts;
- source URLs and whether they directly support the answer;
- uncertainty and unresolved fields;
- memory entries retrieved and included;
- parent-agent and subagent calls;
- tool and interpreter activity;
- input, output, cached, and embedding tokens;
- context size for every model call;
- estimated cost;
- latency for the complete run and its major steps;
- failures, retries, and fallback behavior.

The initial evaluation establishes a baseline. Before the milestone is declared
complete, each evaluation category must have an explicit cost and latency budget
based on that baseline and the quality required for the task.

## Acceptance Criteria

### Accuracy and evidence

- Every required factual field in the stable evaluation set is correct or
  explicitly unresolved.
- No evaluated answer presents an unsupported value as verified.
- Current external facts include directly relevant source links.
- A source shown to the user actually supports the answer associated with it.
- Calculated values are distinguishable from sourced facts and can be reproduced
  from their recorded inputs.

### Flexibility

- The calculation and multi-step evaluations are completed without adding
  question-specific tools.
- General capabilities can be combined differently for different prompts.
- A failed or unavailable capability produces a useful partial or unresolved
  answer rather than a fabricated result or a hung conversation.

### Memory

- Agent-local memory is recalled by the correct agent in a new thread.
- Global user memory is available to the intended agents.
- One agent cannot receive another agent's local memory.
- Irrelevant memory is not included merely because it exists.
- The user can inspect, edit, pin, and delete long-term memory.
- Memory retrieval and embedding activity is visible in run observability.

### Cost and observability

- Every LLM and embedding request in an evaluated run is recorded with its
  purpose, model, timing, and token usage.
- Parent-agent and subagent costs can be distinguished.
- Context inspection explains what was sent to each model call.
- The UI, API, and CLI expose consistent usage data.
- Each evaluation category stays within its agreed cost and latency budget.

### Interfaces and operation

- The same domain behavior is reachable through UI, API, and CLI where it is a
  core user function.
- Runs stream useful progress without changing their result.
- Deleting a thread removes or cleans up its dependent data according to the
  documented storage lifecycle.
- Errors are visible without exposing secrets.

## Definition Of Done For The Milestone

The milestone is complete only when:

1. The evaluation set is committed and reproducible.
2. Baseline and final measurements are recorded.
3. Acceptance criteria pass repeatedly, not only in a single demonstration.
4. The implemented architecture is documented as current behavior.
5. Obsolete specifications and superseded code have been removed.
6. README, API documentation, CLI documentation, and the changelog are current.
