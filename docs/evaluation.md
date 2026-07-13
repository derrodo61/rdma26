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

The current case set is `2026-07-12-v5`. Definitions live in
`server/src/evaluation/evaluation-cases.ts` and are covered by unit tests.

Version `2026-07-12-v5` adds a regional-news case covering same-day event
matching, local-language sources, direct-report citations, and explicit human
review of freshness. Version `2026-07-12-v4` records the hosted-search
architecture. Version `2026-07-12-v3` corrects the explicit-uncertainty
assertion to accept the equivalent wording "cannot be known". Version
`2026-07-12-v2` added an isolated interpreter transformation case. The initial
smoke, research, and memory baselines below remain identified as
`2026-07-12-v1` so their historical meaning does not change.

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
- current regional news with same-day and direct-source checks;
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

Runs every case, including the focused QuickJS interpreter transformation case.
This suite has real provider and search cost and should be used for deliberate
baselines and release-quality comparisons, not on every local edit.

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

Run research cases with the selected model:

```bash
./bin/rdma26 evals:run \
  --suite research \
  --model gpt-5.4
```

Research cases use OpenAI's provider-hosted `web_search` tool. Generated search
and page-opening actions are recorded as `web_search` calls and final URL
citations are preserved. Hosted-search runs currently use final Deep Agents
invocation results because the v3 stream projection removes provider-hosted
tool metadata and citation annotations from the projected final message.

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

`OPENAI_API_KEY` is required for every live suite.

## Reports

Reports are written to:

```text
.assistant-data/evaluations/<evaluation-id>.json
```

A report contains:

- suite and case version;
- selected model and timestamps;
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
3. Run `research` with the intended chat model.
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

## Initial Research Baseline

The first research baseline was recorded on 12 July 2026 with suite
`2026-07-12-v1` and model `gpt-5.4-mini`:

- report: `evaluation-2026-07-12T11-48-12-802Z-4d151ae0`;
- automatic result: 4 cases reached human review with no assertion failures;
- human review: 2 answers accepted and 2 answers rejected as unreliable;
- runs: 4;
- LLM calls: 33;
- tokens: 305,734 input, 223,488 cached input, and 7,334 output;
- largest single model input: 15,643 tokens;
- estimated cost: USD 0.1114491;
- end-to-end duration: 110,347 ms;
- unpriced calls: 0;
- temporary agents remaining after cleanup: 0.

The Angular-version and OpenAI-pricing answers were supported by authoritative
sources and their calculations were correct. The current-sports answer selected
a match even though the cited FIFA schedule contained a later match on the same
day. The next-fixture answer identified the teams but reported a source kickoff
of `19:00` while FIFA's schedule listed `15:00` at Dallas Stadium. These findings
show why current-fact cases remain `review` until a person verifies them; source
presence alone does not prove that the agent interpreted the source correctly.

This baseline establishes two architecture targets: improve evidence comparison
and temporal ordering, and reduce the number of research calls and aggregate
context without sacrificing verification quality.

## Hosted Search Experiment

The finalized hosted-search architecture was checked on 12 July 2026 with suite
`2026-07-12-v4` and model `gpt-5.4`:

- report: `evaluation-2026-07-12T20-33-43-869Z-5af722b1`;
- runs and LLM calls: 4 each;
- tokens: 73,431 input, 34,944 cached input, and 1,357 output;
- largest single model input: 20,667 tokens;
- estimated cost: USD 0.1253085;
- end-to-end duration: 22,368 ms;
- unpriced calls: 0.

Angular version, latest completed match, and OpenAI pricing answers were
accepted on human review. The next-match answer was rejected: it selected the
June opening match even though the evaluation ran on 12 July. This confirms
that the architecture and source capture work with one model call per case, but
that `gpt-5.4` is not consistently reliable for temporal ordering. Selecting a
stronger model remains the user's quality and cost choice.

On 12 July 2026, suite `2026-07-12-v3` compared the existing Tavily researcher
with OpenAI hosted web search. These are live, time-dependent observations, not
permanent quality guarantees.

| Mode          | Model        | LLM calls | Input tokens | Estimated cost | Human review                                                                                           |
| ------------- | ------------ | --------: | -----------: | -------------: | ------------------------------------------------------------------------------------------------------ |
| Researcher    | gpt-5.4-mini |        32 |      278,758 |  USD 0.1036677 | Angular correct; latest match incomplete/wrong; pricing unresolved; next match wrong                   |
| OpenAI hosted | gpt-5.4-mini |         4 |       79,086 |   USD 0.034434 | Angular and pricing correct; both time-sensitive football answers wrong                                |
| OpenAI hosted | gpt-5.4      |         4 |       79,165 |  USD 0.1398325 | Angular, latest match, and pricing correct; next match omitted teams and inferred the source time zone |
| OpenAI hosted | gpt-5.5      |         4 |      156,204 |    USD 0.76815 | All four answers accepted, including explicit FIFA schedule time-zone evidence                         |

Relevant reports:

- researcher: `evaluation-2026-07-12T19-53-40-704Z-9b482a2a`;
- hosted gpt-5.4-mini: `evaluation-2026-07-12T19-49-24-971Z-ac353342`;
- hosted gpt-5.4: `evaluation-2026-07-12T19-50-04-748Z-7700c266`;
- hosted gpt-5.5: `evaluation-2026-07-12T19-51-05-697Z-887f12bf`.

The experiment shows that provider-hosted search removes most orchestration
calls and substantially reduces context compared with the custom researcher.
Model capability still matters: hosted search did not make the mini model
reliable on temporal ordering, while gpt-5.5 produced the best answers at a
much higher token cost.

## Post-Rework Evaluation

The completed hosted-search, interpreter, memory, and observability architecture
was evaluated on 12 July 2026 with suite `2026-07-12-v5`.

| Suite    | Model        | Result                       | Calls | Input tokens | Max call context | Estimated cost | Duration |
| -------- | ------------ | ---------------------------- | ----: | -----------: | ---------------: | -------------: | -------: |
| Smoke    | gpt-5.4-mini | 4 passed                     |     5 |       38,711 |            7,788 |   USD 0.009978 |    5.4 s |
| Research | gpt-5.4      | 1 failed, 4 review           |    12 |      224,296 |           35,998 |   USD 0.312703 |   55.9 s |
| Memory   | gpt-5.4-mini | 4 passed, 1 review           |    18 |      102,126 |            8,154 |   USD 0.029189 |   15.9 s |
| Core     | gpt-5.4-mini | 8 passed, 2 failed, 5 review |    29 |      400,411 |           25,139 |   USD 0.133458 |   61.4 s |

Reports:

- smoke: `evaluation-2026-07-12T21-53-02-240Z-5aab6d83`;
- research: `evaluation-2026-07-12T21-53-40-364Z-c721e8ba`;
- memory: `evaluation-2026-07-12T22-30-54-098Z-4d35f0c0`;
- core: `evaluation-2026-07-12T21-55-31-026Z-5ab9c666`.

Smoke behavior was correct and did not perform unnecessary web searches. The
isolated memory suite recalled agent-local and global memory, excluded
irrelevant memory, preserved cross-agent isolation, and found the earlier
conversation marker. After adding official embedding pricing, all 18 calls in
the repeated memory suite were priced.

The `gpt-5.4` research run correctly identified Angular 22, the latest completed
World Cup match, and the current GPT-5.4 prices and calculation. It nevertheless
failed the sports assertion because the final response did not preserve any
source URLs. The regional-news answer substituted an event from 10 July for a
request about 12 July. The next-match response did not identify the now-known
teams and could not support its time-zone conversion. The pricing values were
correct, but the response cited a general OpenAI API page rather than the
canonical developer pricing page.

The complete `gpt-5.4-mini` core run was not reliable for live research. It
reported Angular 20 instead of Angular 22, selected an older World Cup result,
and used a 2 July event as news for 12 July. It also returned `ORBIT-742` from a
different evaluation thread instead of the newer `HISTORY-731` marker. This
shows that past-conversation retrieval needs stronger recency and relevance
handling, and that reusing one temporary agent across the complete suite can
create realistic but important cross-case competition.

The baseline identified follow-up work in source-citation preservation,
same-day news compliance, episodic retrieval ranking, embedding pricing, and
context/cost reduction. The focused follow-ups below resolve the first four;
context and cost reduction remains open. Model selection remains an explicit
quality and cost tradeoff; hosted search alone does not make a smaller model
reliable on time-sensitive research.

### Citation Preservation Follow-Up

After the baseline, hosted-search requests were configured to include OpenAI's
provider-reported `web_search_call.action.sources` metadata. Source extraction
now combines that metadata with citation annotations across the complete Deep
Agents result instead of requiring citations to appear in the same message as
the search action.

The previously failing `multi-source-current-fact` case was repeated with
`gpt-5.4`:

- report: `evaluation-2026-07-12T22-06-01-140Z-90b2004b`;
- result: automatic assertions passed and the case reached human review;
- sources: direct AP match reporting and the FIFA schedule/results page;
- answer: Argentina 3-1 Switzerland after extra time;
- LLM calls: 2;
- input tokens: 39,084;
- maximum single-call context: 26,922 tokens;
- estimated cost: USD 0.080220;
- duration: 13.9 seconds.

This resolves the technical source-preservation failure. It does not by itself
resolve the separate news-date, episodic-retrieval, embedding-pricing, or
context-cost findings.

### Same-Day Regional News Follow-Up

The first focused rerun exposed two distinct date failures: hosted search
selected a 22 June article from a current topic page, and the final answer
called it 12 July reporting even though the user's Berlin date was already 13
July. Strengthening the skill to require a direct dated article was not enough;
a second run still relabeled a 12 July story as today's news.

The runtime now supplies an explicit ISO local calendar date as the
authoritative meaning of "today", in addition to the localized date and time.
The web-research skill requires same-day claims to confirm the displayed date
on a direct article or official statement and forbids inferring freshness from
search ranking, snippets, homepages, or topic pages.

The final focused rerun with `gpt-5.4` behaved correctly:

- report: `evaluation-2026-07-12T22-43-59-839Z-31df165e`;
- result: automatic assertions passed and the case reached human review;
- answer: explicitly stated that no 13 July Bremen lead story could be verified
  because accessible local reporting was dated 12 July or earlier;
- LLM calls: 2;
- input tokens: 41,983;
- maximum single-call context: 29,787 tokens;
- estimated cost: USD 0.064488;
- duration: 14.6 seconds.

This resolves the incorrect substitution of an older story for same-day news.
The large hosted-search context remains a cost-optimization target.

### Context Composition Baseline

Aggregate context-composition accounting was added before changing prompts or
tools. It records message and tool-definition counts and character sizes, not
raw prompt copies. Provider input tokens remain the authoritative total.

A retained `gpt-5.4` regional-news run showed:

- report: `evaluation-2026-07-13T04-31-41-026Z-8b4ffbe2`;
- first call: 12,198 input tokens, 11,035 system-message characters, 202
  user-message characters, and 27,639 characters across 12 tool definitions;
- second call: 24,298 input tokens, adding 157 visible assistant characters and
  3,605 visible tool-result characters;
- the provider-side hosted-search expansion is therefore substantially larger
  than the compact visible tool result captured by the application.

A separate direct-known-fact run with `gpt-5.4-mini` established the fixed
baseline without web search:

- report: `evaluation-2026-07-13T04-32-55-632Z-5788c6fd`;
- result: correct direct answer with no tool calls;
- input tokens: 7,758;
- system-message characters: 10,746;
- tool definitions: 11 definitions totaling 27,575 characters;
- largest definitions: `write_todos` at 12,175 characters and `task` at 7,483
  characters;
- estimated cost: USD 0.005864.

The two Deep Agents orchestration definitions account for about 71 percent of
the serialized tool-definition characters in the direct run. The next
optimization decision is whether agents that do not need planning or
delegation should receive these built-ins on every request.

### Episodic Retrieval Follow-Up

The core failure was reproduced with the thread-follow-up and
past-conversation cases in sequence. The retained run showed that the older
`ORBIT-742` thread scored higher because generic navigation words such as
`previous` and `thread` counted as topic matches, while the newer
`HISTORY-731` thread contained the actual subject term `historical`.

Past-conversation search now excludes navigation words from relevance scoring
and explicitly prioritizes the newest prior thread when the query asks for the
previous or last thread. Ordinary topic searches continue to rank subject
relevance first and use recency as a tie-breaker. This is deterministic and
does not add embedding or LLM calls.

The two-case sequence was repeated with `gpt-5.4-mini`:

- report: `evaluation-2026-07-12T22-15-57-016Z-d828e321`;
- result: both thread-follow-up and past-conversation recall passed;
- recalled value: `HISTORY-731`;
- LLM calls: 5 across four runs;
- input tokens: 39,016;
- maximum single-call context: 7,981 tokens;
- estimated cost: USD 0.015199;
- duration: 5.1 seconds.

The retained diagnostic agents were deleted after inspection.

## Initial Memory Baseline

The first memory baseline was recorded on 12 July 2026 with suite
`2026-07-12-v1` and model `gpt-5.4-mini`:

- report: `evaluation-2026-07-12T11-55-27-066Z-1a2e1903`;
- result: 4 cases passed automatically and 1 case passed human review;
- runs: 7;
- recorded model and embedding calls: 18;
- tokens: 101,102 input, 80,256 cached input, and 407 output;
- largest single model input: 8,061 tokens;
- partial estimated cost: USD 0.0234507;
- end-to-end duration: 22,511 ms;
- unpriced calls: 5;
- temporary agents remaining after cleanup: 0.

Agent-local semantic recall, shared global recall from both agents, irrelevant
memory exclusion, cross-agent isolation, and past-conversation recall all
behaved correctly. The isolation case did not reveal the other agent's local
marker, although it searched unpinned memory and past conversations before
answering. This is correct behavior with avoidable retrieval work.

The estimated cost is incomplete because five embedding calls had no active
pricing record. Embedding pricing must be configured before this result can be
used as a complete cost baseline. The seed response in the past-conversation
case also repeated its acknowledgement, which should be watched in later runs
even though retrieval returned the correct historical marker.

## Initial Interpreter Check

The focused interpreter case was recorded on 12 July 2026 with suite
`2026-07-12-v2` and model `gpt-5.4-mini`:

- report: `evaluation-2026-07-12T12-09-07-722Z-c0469a54`;
- result: 1 of 1 case passed;
- tool behavior: the agent called `eval` and did not delegate or research;
- runs: 1;
- LLM calls: 2;
- tokens: 20,700 input, 9,856 cached input, and 136 output;
- largest single model input: 10,430 tokens;
- estimated cost: USD 0.0094842;
- end-to-end duration: 3,461 ms;
- unpriced calls: 0;
- temporary agents remaining after cleanup: 0.

The interpreter correctly sorted three structured records and calculated their
average inside isolated QuickJS. The two-call and context overhead confirms that
it should be used for meaningful multi-step transformations, not forced onto
trivial arithmetic that the agent can answer directly.

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
