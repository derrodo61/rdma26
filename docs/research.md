# Research

This document describes the current rdma26 internet-research capability. It is
not the design for the upcoming architecture rework.

## Capability Registration

Agents can be granted one or more web capabilities:

- `research`: attaches a Deep Agents researcher subagent;
- `internet_search`: exposes low-level Tavily search directly;
- `read_web_page`: reads readable text from a known public URL;
- `read_web_page_structure`: extracts focused tables, headings, links, lists,
  Markdown, article text, or debugging output from a known public URL.

The high-level `research` capability requires `OPENAI_API_KEY` and
`TAVILY_API_KEY`. The low-level tools remain available for specialized and
debugging use, but normal agents should not need all of them simultaneously.

The separate `interpreter` capability provides an isolated QuickJS `eval` tool
for deterministic calculations and structured transformations. It does not
provide web access itself. An agent may combine research results with the
interpreter, while sourced facts remain distinct from derived values.

Capability grants are agent-specific and managed through the same runtime from
UI, API, and CLI.

## Current Researcher

The `research` capability adds one Deep Agents subagent named `researcher`. It
receives:

- the configured researcher model;
- the user's locale, time zone, and current date context;
- `research_web_search` backed by Tavily;
- `research_read_web_page` backed by the local public-page reader;
- a structured response schema.

The parent agent delegates through Deep Agents' built-in `task` tool. Search and
page outputs remain in the subagent context, while the parent receives the
structured result.

## Result Shape

The current structured result contains:

- `status`: `verified`, `partial`, or `unresolved`;
- an optional claim-checking status;
- a concise answer;
- URLs intended to support that answer;
- structured findings;
- unresolved fields;
- source titles and excerpts;
- executed search queries;
- dated candidates for latest/last/current comparisons;
- warnings and notes.

The frontend derives source controls from the run associated with an assistant
message. Sources are not taken from an unrelated latest run.

## Page Retrieval

The page reader accepts only public HTTP or HTTPS URLs and rejects localhost and
private-network targets. It fetches a page, extracts readable content, focuses
the result when a query is supplied, and enforces output limits.

The structured page reader is a separate low-level capability for known pages.
It can return a selected representation instead of placing every available page
form in model context.

## Current Guidance

The researcher prompt currently tells the model to:

- translate conversational requests into concise search queries;
- resolve relative dates against the user profile;
- prefer primary or authoritative sources where appropriate;
- read source pages before trusting precise search snippets;
- continue when evidence is stale, incomplete, contradictory, or off-topic;
- use a focused follow-up query when a newer temporal candidate is missing a
  required answer field, and remain partial or unresolved if it cannot be
  verified;
- consider local-language and regional sources when broad search is weak;
- distinguish confirmed, reported, disputed, unsupported, false, and unclear
  claims;
- return partial or unresolved results rather than guess;
- expose only sources that directly support its final answer.
- include concrete supporting evidence text for every source exposed with the
  final answer.

These are current implementation facts, not proof that the behavior is reliable
enough.

Search discovery returns at most five candidates with bounded previews. The
researcher can issue a more focused query or read a candidate page when those
previews do not contain enough evidence. This keeps iterative context bounded
without treating snippets as verified sources.

## Known Limitations

The researcher has produced both excellent and incorrect answers in manual
testing. Current limitations include:

- too many model turns and repeated context for some simple questions;
- model-dependent adherence to source and uncertainty instructions;
- a large prescriptive prompt that attempts to anticipate many failure modes;
- structured output that can repeat more evidence than the parent needs;
- the initial research evaluation accepting only two of four answers at human
  review despite all four passing structural assertions;
- Tavily and public-page extraction quality varying by source.

The project deliberately removed later experimental adaptive-depth budgets and
dedicated time-zone/elapsed-time workflow tools. Those experiments made the
researcher more rigid without solving the general flexibility problem.

## Rejected Interpreter Experiment

On 12 July 2026, an experiment added an isolated QuickJS interpreter inside the
researcher with only search and page-reading tools available through
programmatic tool calling. It was removed after controlled evaluation:

- original `gpt-5.4-mini` baseline: 2 of 4 answers accepted at human review, 33
  calls, 305,734 input tokens, and USD 0.1114491;
- internal-interpreter `gpt-5.4-mini` run
  `evaluation-2026-07-12T12-41-50-325Z-c4d81eb4`: 2 of 4 answers accepted, 32
  calls, 324,664 input tokens, and USD 0.1241229;
- internal-interpreter run with `gpt-5.4-mini` parent and `gpt-5.4` researcher
  `evaluation-2026-07-12T12-36-07-265Z-9283c9b1`: 1 of 4 answers accepted, 23
  calls, 205,264 input tokens, and USD 0.2909592.

The experiment did not improve general reliability. The mini configuration
slightly reduced calls but increased context and estimated cost. The stronger
researcher solved one previously failed sports question in an isolated run, but
the complete suite produced incorrect Angular and next-match answers and left
the pricing question unresolved. No researcher runtime behavior from this
experiment remains enabled.

The evaluation runner retains independent chat and researcher model selection
because that is useful for future controlled comparisons.

## Direction For The Architecture Rework

The next implementation should be driven by the evaluation baseline. The
intended direction is:

- simplify research to source discovery, reading, evidence selection, and
  uncertainty;
- give agents a small set of general capabilities;
- evaluate the new Deep Agents interpreter for general calculation and
  structured transformation before connecting it to additional tools;
- keep sourced facts separate from derived results;
- avoid tools designed for individual questions;
- retain accounting, source provenance, and inspectable activity;
- compare accuracy, calls, context, latency, and cost before and after the
  redesign.

The concrete replacement behavior belongs in tested implementation and current
architecture documentation, not another speculative workflow specification.

## Primary References

- [Deep Agents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)
- [Deep Agents interpreters](https://docs.langchain.com/oss/javascript/deepagents/interpreters)
- [Deep Agents sandboxes](https://docs.langchain.com/oss/javascript/deepagents/sandboxes)
- [Deep Agents skills](https://docs.langchain.com/oss/javascript/deepagents/skills)
