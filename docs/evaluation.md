# Agent Evaluation

rdma26 uses a versioned live evaluation set to measure behavior before and after
agent-architecture changes. A successful conversation is useful evidence, but
it is not a reliability test by itself.

## Goals

The evaluation harness measures:

- answer assertions that can be checked deterministically;
- source presence and source domains;
- tool use and unnecessary tool use;
- parent and subagent LLM calls;
- input, output, and cached-input tokens;
- maximum input tokens in one model call as an initial context-size proxy;
- estimated cost by currency;
- unpriced calls;
- end-to-end latency;
- behavior that still requires human review.

It uses the same `AssistantRuntime` as the UI, API, and ordinary CLI commands.

## Case Version

The initial case set is `2026-07-12-v1`. Definitions live in
`server/src/evaluation/evaluation-cases.ts` and are covered by unit tests.

Changing a prompt, expected result, setup, or assertion changes what the suite
measures. Material changes should therefore create a new suite version rather
than rewriting historical baseline meaning.

## Suites

### `smoke`

Low-cost checks that do not require internet research:

- stable direct fact;
- deterministic arithmetic;
- explicit uncertainty;
- follow-up context in the same thread.

### `research`

Live external-information checks:

- current Angular major version from an official source;
- current sports result supported by multiple sources;
- official pricing plus a derived calculation;
- a multi-step fixture and local-time question.

### `memory`

Long-term and episodic context checks:

- agent-local semantic recall;
- global memory recall from two agents;
- irrelevant-memory exclusion;
- cross-agent local-memory isolation;
- past-conversation recall.

### `core`

Runs every case. This suite has real provider and search cost and should be used
for deliberate baselines and release-quality comparisons, not on every local
edit.

## Isolation And Cleanup

Every evaluation creates two temporary, chat-disabled agents with neutral
identities. They receive the selected model and only the capabilities required
by the selected cases. They are ordinary deletable agents rather than protected
system agents, so normal cleanup removes them and all associated data.

Memory seeds use unique marker values. The harness deletes seeded memories and
temporary agents after the suite. Agent deletion also removes evaluation
threads, runs, LLM calls, and checkpoints.

Use `--keep-data true` when a failed run needs inspection. The report then lists
the retained agent ids so they can be deleted after debugging.

Global memory seeds are explicitly deleted even though they are not owned by an
evaluation agent.

## Running Evaluations

List the versioned definitions without making provider calls:

```bash
./bin/rdma26 evals:list
```

Run the smoke suite with the application default model:

```bash
./bin/rdma26 evals:run --suite smoke
```

Select a model:

```bash
./bin/rdma26 evals:run --suite smoke --model gpt-5.4-mini
```

Run selected cases:

```bash
./bin/rdma26 evals:run \
  --cases direct-known-fact,thread-follow-up \
  --model gpt-5.4-mini
```

Retain temporary agents and their run contexts for debugging:

```bash
./bin/rdma26 evals:run \
  --cases current-angular-version \
  --model gpt-5.4-mini \
  --keep-data true
```

`OPENAI_API_KEY` is required for every live suite. Research cases also require
`TAVILY_API_KEY`.

## Reports

Reports are written to:

```text
.assistant-data/evaluations/<evaluation-id>.json
```

A report contains:

- suite and case version;
- model and timestamps;
- overall and per-case status;
- every prompt and response;
- run, thread, and temporary agent ids;
- source URLs and top-level tool calls;
- automatic assertion failures;
- human-review questions;
- token, call, cost, and context proxy measurements.

Status meanings:

- `passed`: all automatic assertions passed and no human review is required;
- `failed`: at least one automatic assertion or runtime step failed;
- `review`: automatic assertions passed, but current facts or evidence quality
  still need a human judgment.

Live-current questions cannot have permanent golden answers. Their automatic
checks verify research and source behavior, while the report asks a reviewer to
confirm freshness and factual correctness at run time.

## Context Measurement

Provider-reported input tokens are currently the most consistent comparable
measurement for model context. Reports include:

- total input tokens across the case;
- cached input tokens;
- `maxInputTokensPerCall`, the largest input-token count of one provider call.

This does not replace detailed run-context inspection. It provides a stable
numeric baseline for detecting context growth or reduction between
architectures.

## Baseline Procedure

1. Run `smoke` with the intended default chat model.
2. Record the report id and summary.
3. Run `research` with the same chat and researcher model.
4. Review every current fact and displayed source.
5. Run `memory` only after confirming embedding pricing and expected provider
   cost.
6. Run `core` before and after the architecture rework.
7. Compare failures, review findings, calls, tokens, maximum call context,
   estimated cost, and latency.

The first baseline records current behavior; it does not define acceptable
budgets. Cost and latency budgets should be agreed from baseline evidence and
then added to case assertions.

## Initial Smoke Baseline

The first successful smoke baseline was recorded on 12 July 2026 with suite
`2026-07-12-v1` and model `gpt-5.4-mini`:

- report: `evaluation-2026-07-12T09-49-57-072Z-e39f029c`;
- result: 4 of 4 cases passed;
- runs and LLM calls: 5 each;
- tokens: 38,472 input, 21,888 cached input, and 142 output;
- largest single model input: 7,753 tokens;
- estimated cost: USD 0.0147186;
- end-to-end duration: 4,984 ms;
- unpriced calls: 0;
- temporary agents remaining after cleanup: 0.

The report is local runtime data under `.assistant-data/evaluations/` and is not
part of the repository. These numbers are a comparison point, not a performance
budget or a guarantee about future provider latency and pricing.

## Adding A Case

A new case should represent a reusable product behavior, not a patch for one
failed wording. It must define:

- a stable id and category;
- the suites it belongs to;
- required capabilities;
- isolated setup data;
- prompts and automatic assertions;
- explicit human-review questions where automation cannot establish truth.

Do not add a case merely to force one model response. Add it when the behavior
matters across agents or architectures.
