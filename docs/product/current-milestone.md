# Current Milestone: Make The Assistant Dependable

**Status:** Active
**Audience:** Everyone
**Canonical for:** The current product outcome, evaluation set, acceptance
criteria, and definition of done

Our next goal is to make the assistant genuinely dependable. It should answer
simple questions, research information, perform calculations, work through
more involved tasks, and remember useful details from earlier conversations.
You should also be able to see how it reached its answer, what sources and
memories it used, how confident it is, and how much time and money the work
required.

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
complete, each evaluation category must have an explicit cost and latency
budget based on that baseline and the quality required for the task.

## Acceptance Criteria

### Accuracy And Evidence

- Every required factual field in the stable evaluation set is correct or
  explicitly unresolved.
- No evaluated answer presents an unsupported value as verified.
- Current external facts include directly relevant source links.
- A source shown to the user actually supports the answer associated with it.
- Calculated values are distinguishable from sourced facts and can be
  reproduced from their recorded inputs.

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

### Cost And Observability

- Every LLM and embedding request in an evaluated run is recorded with its
  purpose, model, timing, and token usage.
- Parent-agent and subagent costs can be distinguished.
- Context inspection explains what was sent to each model call.
- The UI, API, and CLI expose consistent usage data.
- Each evaluation category stays within its agreed cost and latency budget.

### Interfaces And Operation

- The same domain behavior is reachable through UI, API, and CLI where it is a
  core user function.
- Runs stream useful progress without changing their result.
- Deleting a thread removes or cleans up its dependent data according to the
  documented storage lifecycle.
- Errors are visible without exposing secrets.

## Definition Of Done

The milestone is complete only when:

1. The evaluation set is committed and reproducible.
2. Baseline and final measurements are recorded.
3. Acceptance criteria pass repeatedly, not only in a single demonstration.
4. The implemented architecture is documented as current behavior.
5. Obsolete specifications and superseded code have been removed.
6. README, API documentation, CLI documentation, and the changelog are current.

## Related Pages

- [Product vision](./vision.md)
- [Roadmap](./roadmap.md)
- [Current non-goals](./non-goals.md)
- [Agent evaluation](../architecture/evaluation.md)
- [Observability and cost control](../architecture/observability.md)
