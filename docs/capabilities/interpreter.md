# Interpreter Capability

**Status:** Current implementation
**Audience:** Product and engineering
**Canonical for:** Interpreter behavior, boundaries, observability, and tests

The interpreter is an assignable agent capability for deterministic code-backed
work. It lets an agent run small JavaScript snippets inside the Deep Agents
QuickJS interpreter when code is a better fit than model-only reasoning.

Use it for calculations, validation, and structured transformations such as
sorting, filtering, grouping, comparing, aggregating, or checking parsed data.
Do not use it for browsing, filesystem work, shell commands, package-backed
scripts, application automation, or private/local resource access.

## What It Is

The application capability is named `interpreter`.

Internally, `interpreter` is not a normal local tool implementation in
`CapabilityRegistry.createRunnableTools()`. It is Deep Agents middleware added
by `createEnabledAgentMiddleware()` when the selected agent has the
`interpreter` capability enabled. The middleware comes from
`@langchain/quickjs` and exposes an `eval` tool to the agent runtime.

This distinction matters for testing and debugging:

- In agent settings and capability configuration, look for `interpreter`.
- In run context tool calls, look for the runtime tool name `eval`.
- In unit tests, `createRunnableTools(['interpreter'])` should return no normal
  runnable tools, while `createEnabledAgentMiddleware(['interpreter'])` should
  add one middleware entry.

## Boundary

The current interpreter is intentionally small and isolated:

- language: JavaScript through QuickJS;
- execution timeout: 5 seconds;
- result limit: 4,000 characters;
- memory limit: 64 MiB;
- stack limit: 320 KiB;
- subagents: enabled;
- host filesystem access: none;
- network access: none;
- shell access: none;
- package installation/imports: none;
- credential access: none;
- clock access: none.

It is not the future general sandbox described in the product vision. If a task
needs files, npm packages, shell commands, HTTP requests, local app control, or
long-running execution, this interpreter is the wrong mechanism.

## When It Is Called

The agent decides whether to call `eval` during a run. The bootloader prompt
only includes interpreter guidance when the configured agent has the
`interpreter` capability enabled.

The guidance tells the agent to use the interpreter for deterministic work, but
to answer directly for trivial one-step arithmetic where running code adds no
value. So the expected behavior is:

- enabled + structured deterministic task: likely `eval`;
- enabled + trivial arithmetic: direct answer is acceptable;
- disabled: no `eval` tool should be available or called.

Examples that should encourage interpreter use:

- "Sort these records by score descending and calculate the average."
- "Validate whether these JSON rows have duplicate ids."
- "Group these transactions by month and sum the amounts."
- "Check this small truth table and report failing cases."

Examples that should not use this interpreter:

- "Open this file and analyze it."
- "Fetch current prices from the web."
- "Run this npm package."
- "Execute a shell command."

## Observability

Interpreter calls are captured through the normal run tool-call observer. In the
run details page or `runs:context`, a successful interpreter use should appear
as a tool call named `eval`, with compact input and output metadata.

The interpreter itself is not an LLM call. It should not create model usage or
cost records. Any LLM call that planned or summarized the result is still
recorded through the normal LLM accounting path.

## How To Enable It

Enable the `interpreter` capability for an agent through the same capability
management path used for other normal agent capabilities.

Typical checks:

- the capability list includes `interpreter`;
- the agent's enabled capabilities include `interpreter`;
- the run bootloader prompt contains `Interpreter guidance`;
- the run context contains `eval` only when the agent actually used it.

## How To Test It

### Unit Tests

Run the focused backend tests:

```bash
npm run server:test -- --run \
  server/src/capabilities/capability-registry.spec.ts \
  server/src/agents/agent-middleware.spec.ts \
  server/src/agents/agent-prompt.spec.ts \
  server/src/agents/personal-agent.spec.ts
```

These verify that:

- `interpreter` is registered as configurable middleware, not a normal tool;
- middleware is added only when `interpreter` is enabled;
- the bootloader prompt describes the interpreter boundary only when enabled;
- nested `eval` tool calls are collected into run context.

### Evaluation Case

Run the focused interpreter case:

```bash
npm run rdma26 -- evals:run \
  --cases interpreter-structured-transformation \
  --model gpt-5.4-mini \
  --keep-data true
```

The case asks the agent to sort three score records and calculate the average.
Its assertions require:

- ordered names: Atlas, Cedar, Birch;
- average score: 82;
- required tool call: `eval`;
- forbidden tool call: `web_search`.

After the run, inspect the generated report under
`.assistant-data/evaluations/` and open the preserved run context.

### Manual CLI Test

Create or use an agent that has `interpreter` enabled, then send:

```bash
npm run rdma26 -- chat:send \
  --agent <agent-id> \
  --thread <thread-id> \
  --model gpt-5.4-mini \
  --prompt "Use the interpreter to sort these records by score descending and calculate the average score: Atlas 91, Birch 73, Cedar 82. Return the ordered names and average."
```

Then inspect the run context:

```bash
npm run rdma26 -- runs:context --run <run-id>
```

Expected result:

- final answer contains `Atlas`, `Cedar`, `Birch`, and `82`;
- `toolCalls` contains a call named `eval`;
- no `web_search` call appears;
- no extra interpreter-specific LLM cost is recorded.

### Behavioral Choice Tests

The evaluation case above proves the happy path: when the prompt explicitly
asks for the interpreter, the agent can call `eval` and use the result. It does
not prove that the agent will choose the interpreter on its own.

Use the following manual CLI tests to check that behavior. Run each test in a
fresh thread so previous prompts do not bias tool choice:

```bash
npm run rdma26 -- threads:create \
  --agent <agent-id> \
  --title "<test title>"
```

Then send one of the prompts below:

```bash
npm run rdma26 -- chat:send \
  --agent <agent-id> \
  --thread <thread-id> \
  --model gpt-5.4-mini \
  --prompt "<prompt>"
```

Inspect `agentResponse.toolCalls` in the output, or inspect the stored context:

```bash
npm run rdma26 -- runs:context --run <run-id>
```

#### Small Transformation

Prompt:

```text
Sort these records by score descending and calculate the average score: Atlas 91, Birch 73, Cedar 82. Return the ordered names and average.
```

Expected behavior:

- correct answer: Atlas, Cedar, Birch; average 82;
- `eval` is optional;
- no `web_search`.

This is intentionally small. A direct answer is acceptable because the
bootloader says to avoid interpreter calls for trivial one-step work. On 18 July
2026, `gpt-5.4-mini` answered directly with no tool call in run
`e6c65ca3-d2ca-4737-bb80-47638e6d4e45`.

#### Larger Grouping Transformation

Prompt:

```text
Given these order records, exclude cancelled orders, group the remaining orders by region, calculate total revenue per region, and list the top 3 customers by revenue overall. Records: Aster North 1280 shipped; Birch South 740 cancelled; Cedar North 990 shipped; Drift West 430 shipped; Elm South 1510 shipped; Fern East 875 shipped; Grove West 1250 cancelled; Harbor East 1325 shipped; Iris North 610 shipped; Juniper South 940 shipped; Kestrel East 450 cancelled; Lumen West 1185 shipped. Return the regional totals sorted descending and the top 3 customers sorted descending.
```

Expected behavior:

- tool call: `eval`;
- regional totals: North 2880, South 2450, East 2200, West 1615;
- top customers: Elm 1510, Harbor 1325, Aster 1280;
- no `web_search`.

On 18 July 2026, `gpt-5.4-mini` used `eval` and returned the expected result in
run `8be4c6de-905f-4a71-8768-a4567a161c32`.

#### Validation Transformation

Prompt:

```text
Validate this event list. Find duplicate ids, count valid events by type, and list ids whose duration is outside the allowed range of 1 to 120 minutes inclusive. Events: e101 login 5; e102 upload 48; e103 export 121; e104 login 3; e102 upload 51; e105 delete 0; e106 export 90; e107 upload 118; e108 login 2; e109 export 120; e110 delete 12; e111 upload 130. Return duplicate ids, counts by type for valid-duration events only, and invalid-duration ids.
```

Expected behavior:

- tool call: `eval`;
- duplicate ids: e102;
- valid-duration counts: login 3, upload 3, export 2, delete 1;
- invalid-duration ids: e103, e105, e111;
- no `web_search`.

On 18 July 2026, `gpt-5.4-mini` used `eval` and returned the expected result in
run `031c3525-27ec-4c97-9c94-b82bb872ab59`.

#### Reconciliation Transformation

Prompt:

```text
Reconcile this transaction batch. Rules: include only status=paid or status=refunded; failed rows are ignored; paid rows add quantity and revenue; refunded rows subtract quantity and revenue; flag any order id where cumulative quantity becomes negative after applying rows in timestamp order. Transactions: 09:00 o100 alpha paid qty 3 unit 19.99; 09:02 o101 beta paid qty 2 unit 45.50; 09:05 o102 alpha failed qty 5 unit 19.99; 09:08 o103 gamma paid qty 1 unit 120.00; 09:10 o100 alpha refunded qty 1 unit 19.99; 09:12 o104 beta paid qty 4 unit 45.50; 09:14 o105 gamma refunded qty 1 unit 120.00; 09:16 o105 gamma refunded qty 1 unit 120.00; 09:18 o106 alpha paid qty 7 unit 19.99; 09:20 o101 beta refunded qty 1 unit 45.50; 09:22 o107 delta paid qty 6 unit 12.25; 09:24 o108 delta failed qty 2 unit 12.25; 09:26 o109 beta paid qty 1 unit 45.50. Return product totals sorted by net revenue descending with net units and net revenue to 2 decimals, the grand total revenue, and any negative-quantity order ids.
```

Expected behavior:

- tool call: `eval`;
- product totals: beta 6 units / 273.00, alpha 9 units / 179.91, delta 6
  units / 73.50, gamma -1 units / -120.00;
- grand total revenue: 406.41;
- negative-quantity order ids: o105;
- no `web_search`.

On 18 July 2026, `gpt-5.4-mini` used `eval` and returned the expected result in
run `1f64fa2e-1ccb-454a-a105-21cf0dda5f36`.

### Manual UI Test

1. Enable `interpreter` for the test agent.
2. Ask the same structured-transformation prompt in the chat UI.
3. Open the run details page for the latest run.
4. Check the `Overview` or `Timeline` tab for an `eval` tool call.
5. Check the answer and the run metadata.

Also test the negative case by disabling `interpreter` for the same agent and
repeating the prompt. The run should not contain `eval`; the agent may answer
with model-only reasoning or explain that the interpreter is unavailable,
depending on its model behavior.

## Known Limitations

- The interpreter is JavaScript-only.
- It cannot read or write files.
- It cannot access the network.
- It cannot install packages or use Node.js APIs.
- It cannot run shell commands.
- It is best for small bounded snippets, not large programs.
- The model still decides when to call `eval`; the application does not force
  interpreter use for every calculation-like prompt.

## Related Pages

- [Architecture overview](../architecture/README.md)
- [Agent evaluation](../architecture/evaluation.md)
- [Web research](./web-research.md)
