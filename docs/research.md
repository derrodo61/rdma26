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
- consider local-language and regional sources when broad search is weak;
- distinguish confirmed, reported, disputed, unsupported, false, and unclear
  claims;
- return partial or unresolved results rather than guess;
- expose only sources that directly support its final answer.

These are current implementation facts, not proof that the behavior is reliable
enough.

## Known Limitations

The researcher has produced both excellent and incorrect answers in manual
testing. Current limitations include:

- too many model turns and repeated context for some simple questions;
- model-dependent adherence to source and uncertainty instructions;
- a large prescriptive prompt that attempts to anticipate many failure modes;
- structured output that can repeat more evidence than the parent needs;
- no general interpreter for calculations and transformations;
- no stable evaluation suite proving accuracy across different question types;
- Tavily and public-page extraction quality varying by source.

The project deliberately removed later experimental adaptive-depth budgets and
dedicated time-zone/elapsed-time workflow tools. Those experiments made the
researcher more rigid without solving the general flexibility problem.

## Direction For The Architecture Rework

The next implementation should be driven by the evaluation baseline. The
intended direction is:

- simplify research to source discovery, reading, evidence selection, and
  uncertainty;
- give agents a small set of general capabilities;
- use a Deep Agents interpreter for general calculation and structured
  transformation where evaluation supports it;
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
