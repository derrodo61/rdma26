# Context and Cost Optimization Notes

This is a temporary project document for tracking context and cost optimization work. Delete it after every topic below has been resolved and the durable decisions have been moved into the appropriate product documentation.

## Baseline Test

Date: 2026-07-11

Agent: Ronaldo

Question:

> Wann beginnt das Spiel England gegen Norwegen bei der Fußball-Weltmeisterschaft 2026? Bitte nenne mir Datum und Anstoßzeit in meiner lokalen Zeitzone.

The response was factually correct: Saturday, 11 July 2026 at 23:00 CEST in Europe/Berlin.

Run ID: `f17642ff-08e9-4742-bce0-615018953563`

### LLM usage

- 6 LLM calls for the chat run
- 2 parent-agent calls
- 4 researcher-subagent calls
- 48,542 input tokens
- 29,568 cached input tokens
- 18,974 uncached input tokens
- 435 output tokens
- Approximately 15.7 seconds end to end
- Approximately USD 0.0112 based on the official `gpt-4.1-mini` input, cached-input, and output prices
- Tavily or other external tool costs are not included

Creating the new thread also triggered a separate summary call for the previous thread:

- 443 input tokens
- 142 output tokens

## Topics to Resolve

### Effective model selection

The user profile configured Ronaldo to use `gpt-5.4-mini`, but `rdma26 chat:send` used the application-wide default `gpt-4.1-mini` when no explicit `--model` option was supplied.

Expected direction:

- API, UI, and CLI should resolve the effective agent model consistently.
- An explicit request-level model override may still take precedence.

Status: resolved on 2026-07-11. The backend now resolves an omitted request model from the saved user-profile agent setting, then the backend agent setting, and finally the application default. The CLI no longer replaces an omitted model with the application default before calling the runtime.

### Pricing coverage

No saved pricing record existed for `gpt-4.1-mini`, so rdma26 could not calculate the estimated cost of the run.

Expected direction:

- Every model that can be selected or selected implicitly should have an active pricing record when its official pricing is available.
- Missing pricing should remain visible as an observability problem.

### Memory retrieval relevance

The run loaded eight conversation summaries totaling approximately 6,500 characters. Most were unrelated to the fixture question, including local news and incident summaries. Some summaries appeared to duplicate the same source thread.

Expected direction:

- Retrieve only memories that are materially relevant to the current request.
- Prevent or consolidate duplicate thread summaries.
- Do not spend context tokens on unrelated memories merely because they have broad lexical overlap.

### Research call count

A simple fixture lookup required four researcher-model calls in addition to two parent-agent calls.

Questions to investigate:

- What did each researcher call do?
- Could the researcher stop after finding a strong official source?
- Is a full research workflow necessary for a narrow factual lookup?
- Can call count be reduced without weakening factual reliability?

### Parent and subagent context

The first parent call already contained 9,872 input tokens. Researcher input then grew from 5,229 to 8,578 tokens, and the final parent call contained 10,104 input tokens.

Questions to investigate:

- Which prompt, memory, profile, tool, and message sections account for the initial context?
- Which research outputs are repeatedly carried into later calls?
- Can tool and subagent results be represented more compactly?
- Can static prompt content make better use of provider prompt caching?

### Thread-summary trigger cost

Creating a new thread triggered summary generation for the previous thread. This is intentional behavior, but it creates an additional LLM request before the first chat message.

Questions to investigate:

- Is thread creation the correct trigger?
- Can summary generation be deferred or queued without harming memory quality?
- Are summaries generated only once and only when useful content exists?

## Completion Criteria

Delete this file when:

- Effective model selection is consistent across UI, API, and CLI.
- Pricing coverage behavior is defined and implemented.
- Memory retrieval no longer injects clearly irrelevant or duplicate summaries.
- Research and parent-agent call counts have been reviewed and optimized where appropriate.
- Context composition is measurable and unnecessary context has been reduced.
- Thread-summary generation behavior and cost are accepted or improved.
- Durable behavior and decisions are documented in the appropriate permanent documentation.
