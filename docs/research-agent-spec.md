# Research Agent Spec

This document describes the shared research capability for `rdma26`.

The current implementation has primitive web tools (`internet_search`, `read_web_page`) and the high-level `research` capability. The `research` capability attaches a Deep Agents researcher subagent and is the recommended path for normal agents that need current external information.

## Goal

Agents should be able to answer questions that require current external information without each agent having to become good at search.

The research agent owns the work of finding, reading, checking, and summarizing external sources. Domain agents such as a sports agent, coding agent, or personal assistant keep their own identity and context, but delegate internet research when needed.

## Non-Goals

The first version is not a full autonomous deep research product.

It should not:

- browse indefinitely
- produce long reports by default
- replace normal agent identity or domain behavior
- hide uncertainty
- store memories automatically unless a later memory workflow explicitly does so
- require every internet question to use a long-running workflow

## Background

The project already proved that current factual questions need more than a raw search call.

Useful behavior includes:

- translating the user's question into search-friendly queries
- preferring official or authoritative sources when appropriate
- reading source pages instead of relying only on snippets
- rejecting off-topic sources with similar names
- following up when required fields are missing
- returning `verified`, `partial`, or `unresolved`

This is agent-like behavior. It is better to put it in one shared research capability than to teach every agent the same search craft.

LangChain Deep Agents support this direction. Their subagent model is intended for delegated work and context isolation. Web research is a strong fit because search and page-reading outputs can become large and noisy.

## Conceptual Model

```text
User
  -> domain agent
      -> decides internet research is needed
      -> delegates to research agent
          -> plans search
          -> searches
          -> reads sources
          -> extracts candidate facts
          -> verifies answer
          -> returns structured result
      -> domain agent answers in its own voice
```

Examples:

```text
Ronaldo
  -> asks Research Agent for current match facts
  -> answers in Ronaldo's football voice

Scotty
  -> asks Research Agent for current package/version facts
  -> answers in operator/admin style

Agent1
  -> asks Research Agent for current external facts
  -> answers using Agent1's own context
```

## Public Capability

The domain agent should get one simple research capability instead of several detailed research instructions.

In the UI and CLI this is configured as the `research` capability. Internally it
is not a normal callable tool. Enabling `research` attaches a Deep Agents
subagent named `researcher` to the domain agent.

```text
Domain agent
  -> Deep Agents task tool
  -> researcher subagent
  -> search/read/verify sources
  -> structured research result
  -> domain agent answers the user
```

The public contract should stay simple:

- user question in through the parent agent
- structured research result out
- sources included
- uncertainty explicit

## Result Model

The research result should be structured enough for a domain agent to answer safely.

```ts
type ResearchStatus = 'verified' | 'partial' | 'unresolved';

interface ResearchResult {
  status: ResearchStatus;
  answer: string;
  findings: ResearchFinding[];
  unresolved: string[];
  sources: ResearchSource[];
  searches: ResearchSearch[];
  notes: string[];
}
```

`verified`

The required answer is supported by sources.

`partial`

Some useful facts are verified, but one or more required fields, requested items, or ordering/currentness checks are missing.

`unresolved`

The workflow could not find enough relevant evidence.

## Caching

Research results should not be cached in the first implementation.

The value of caching is unclear for current external facts because cached answers
can become stale and create trust problems. Correctness and freshness are more
important than saving a search or model call at this stage.

Caching can be revisited later if cost or latency becomes a real problem. If it
is added later, it must be explicit, freshness-aware, and easy to bypass.

## Research Traces And Memory

Research results are not memories by default.

The research agent should store run traces for audit and debugging, but those
traces must not be reused automatically as truth in future conversations.

A research trace records what happened:

- question asked
- mode used
- searches run
- sources read
- verifier result
- unresolved facts

A memory records something that should influence future context.

The research agent should not automatically create memory records in the first
implementation. A domain agent may save a memory only when the result is
future-useful and fits the normal memory rules, or when the user explicitly asks
an agent to remember something.

## Source Display

Research-backed chat answers should stay readable by default, but sources should
be easy to inspect.

The normal chat UI should not inline long citations, raw excerpts, search
queries, or verifier details into every answer. If a research result includes
sources, the UI should show a compact source affordance such as:

```text
Sources 2
```

Opening it should show a concise source list with:

- source title
- domain or publisher when available
- URL

Each source should be clickable so the user can open the original page. Later,
the source list may support expanding a source to show the excerpt used,
extraction warnings, or source quality notes.

Full research traces belong in the run inspector or debug/admin views. That
includes planned queries, searches, tool calls, raw excerpts, verification
status, unresolved facts, and notes.

## Research Workflow

The first implementation uses one Deep Agents subagent named `researcher`.

The parent domain agent decides when internet research is needed and delegates
to the researcher through the Deep Agents `task` tool. The researcher then:

- plan search queries
- search a small number of times
- read a small number of source pages
- verify required fields
- return concise structured facts
- stop quickly when verified or clearly unresolved

Later, the researcher can grow into a longer research workflow for broad
questions. That may include:

- split work into focused subquestions
- use subagents in parallel
- write intermediate notes into the Deep Agents filesystem
- return concise findings to the domain agent, not raw search/page outputs
- synthesize a longer report with citations when the user asks for report-style output

## Source Policy

The research agent should choose source strategy based on question type.

For software/product/version questions:

- prefer official project sites, docs, release notes, package registries, or official blogs
- include disambiguating terms for short or ambiguous names
- reject similarly named but wrong entities

For sports/current event questions:

- prefer official event pages, reputable sports/news sources, result pages, or schedules
- distinguish previews, schedules, live updates, completed results, and future fixtures
- verify ordering for latest/last/current requests

For finance/price questions:

- prefer market data providers or official exchange/company sources when available
- include timestamp or market status when relevant
- avoid stale snippets

For general current facts:

- prefer sources with clear dates
- read source pages for key facts
- mark uncertainty when sources conflict

## Subagent Role

The researcher should be a capability subagent, not primarily a personality agent.

It should have:

- a narrow system prompt
- search and page-reading tools
- a structured result contract
- no domain-specific persona
- no arbitrary memory writes in the first version

It may be exposed later as a normal chat-selectable agent, but the first purpose is delegation from other agents.

Agent records support metadata that distinguishes chat-enabled agents from
internal capability agents:

```ts
interface AgentVisibility {
  kind: 'chat' | 'operator' | 'internal';
  chatEnabled: boolean;
}
```

Normal domain agents are `chat` agents with `chatEnabled: true`. Scotty is an
`operator` agent with `chatEnabled: true`. If the project later creates a
persisted research agent record, it should be an `internal` agent with
`chatEnabled: false`.

The normal chat agent selector shows only chat-enabled agents. Admin,
settings, and debug views may show internal agents separately, for example under
system agents or capability agents.

## Relationship To Existing Tools

The system should keep all research-related tools configurable. The `research`
capability is the recommended default for normal agents, but primitive tools
remain available for explicit assignment.

Normal agents should not receive primitive web tools by default. If the user grants
`internet_search` or `read_web_page` to an agent, that is a deliberate power-user,
debugging, or specialized-agent choice.

Tool descriptions in the UI and CLI should make this distinction clear:

- `research`: recommended Deep Agents researcher subagent capability
- `internet_search`: low-level primitive search tool
- `read_web_page`: low-level primitive page extraction tool

### `internet_search`

Primitive tool. Runs search.

Keep it available for agents that need direct search.

### `read_web_page`

Primitive tool. Reads a public source page.

Keep it available for direct inspection and for the research agent.

## First Implementation Plan

Status: implemented as a Deep Agents subagent capability.

1. Added `research` as an assignable capability in the same UI/CLI list as tools.
2. When `research` is enabled, `PersonalAgent` attaches a Deep Agents subagent named `researcher`.
3. The domain agent delegates to `researcher` with Deep Agents' built-in `task` tool.
4. The researcher has private search and page-reading tools.
5. The researcher returns a structured result with findings, sources, searches, unresolved items, and notes.
6. Removed the older `verify_current_facts` compatibility tool after the researcher subagent became the primary research path.
7. Updated agent bootloader guidance:
   - use the researcher subagent for current external information
   - prefer researcher delegation over manual search chains
   - answer from the returned structured result
8. Research traces are stored in run-context snapshots through tool-call capture:
   - mode
   - searches
   - sources
   - status
   - unresolved facts
9. Added tests for:
   - researcher subagent configuration
   - structured research result schema
   - domain-agent bootloader guidance
   - agent visibility metadata

## Later Implementation Plan

After the first researcher subagent implementation is stable:

1. Add richer report-style research for broad questions.
2. Add configurable search/read limits.
3. Add configurable research models if quality/cost tradeoffs require it.
4. Stream subagent activity into the run inspector.
5. Add citations or source references to user-visible answers.
6. Add provider options beyond Tavily if needed.

## References

- LangChain Deep Agents overview: https://docs.langchain.com/oss/javascript/deepagents/overview
- LangChain Deep Agents subagents: https://docs.langchain.com/oss/javascript/deepagents/subagents
- LangChain Deep Agents context engineering: https://docs.langchain.com/oss/javascript/deepagents/context-engineering
- LangChain Deep Research tutorial: https://docs.langchain.com/oss/python/deepagents/deep-research
- Tavily agents documentation: https://docs.tavily.com/agents
