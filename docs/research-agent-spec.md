# Research Agent Spec

This document describes the planned shared research capability for `rdma26`.

The current implementation has primitive web tools (`internet_search`, `read_web_page`) and a bounded factual verification workflow (`verify_current_facts`). The next step is to treat internet research as a first-class capability agent that can be reused by all normal agents.

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

Initial shape:

```ts
research({
  question: string;
  mode?: "auto" | "quick" | "deep";
  expectedOutput?: "answer" | "structured_facts" | "report";
  requiredItems?: number;
  requiredFields?: string[];
  topic?: "general" | "news" | "finance";
  maxSearches?: number;
  maxSources?: number;
})
```

The exact TypeScript shape can evolve, but the public contract should stay simple:

- question in
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
  modeUsed: 'quick' | 'deep';
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

## Modes

### Auto

Default mode. The research agent chooses quick or deep.

Heuristics:

- use `quick` for precise facts, versions, dates, prices, latest scores, current lists, and next events
- use `deep` for comparisons, broad summaries, market research, multi-source reports, or unclear questions with many subquestions

### Quick

Bounded factual verification.

This is the current `verify_current_facts` behavior promoted into the research agent.

Quick mode should keep query planning and source verification as separate LLM
steps. They happen at different phases of the workflow:

- planning happens before search and produces search-friendly queries
- verification happens after search/page reading and checks whether the evidence
  answers the question

The planner and verifier models should be configurable separately because they
have different quality, latency, and cost profiles. The default implementation
may use the same model for both, but the architecture should support separate
configuration later.

Example future configuration:

```bash
RESEARCH_PLANNER_MODEL=gpt-5.4-mini
RESEARCH_VERIFIER_MODEL=gpt-5.4
```

Quick mode should:

- plan search queries
- search a small number of times
- read a small number of source pages
- verify required fields
- return concise structured facts
- stop quickly when verified or clearly unresolved

### Deep

Longer research workflow.

Deep mode is not required for the first implementation. It is reserved for broader research tasks.

Deep mode may later:

- create a research plan
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

The research agent should be a capability agent, not primarily a personality agent.

It should have:

- a narrow system prompt
- search and page-reading tools
- a structured result contract
- no domain-specific persona
- no arbitrary memory writes in the first version

It may be exposed later as a normal chat-selectable agent, but the first purpose is delegation from other agents.

Agent records should support metadata that distinguishes chat-enabled agents from
internal capability agents. The exact field names can be decided during
implementation, but the model should support this concept:

```ts
interface AgentVisibility {
  kind: 'chat' | 'operator' | 'internal';
  chatEnabled: boolean;
}
```

Normal domain agents are `chat` agents with `chatEnabled: true`. Scotty is an
`operator` agent with `chatEnabled: true`. The research agent is an `internal`
agent with `chatEnabled: false`.

The normal chat agent selector should show only chat-enabled agents. Admin,
settings, and debug views may show internal agents separately, for example under
system agents or capability agents.

## Relationship To Existing Tools

The system should keep all research-related tools configurable. The high-level `research`
capability is the recommended default for normal agents, but primitive tools remain
available for explicit assignment.

Normal agents should not receive primitive web tools by default. If the user grants
`internet_search` or `read_web_page` to an agent, that is a deliberate power-user,
debugging, or specialized-agent choice.

Tool descriptions in the UI and CLI should make this distinction clear:

- `research`: recommended high-level internet research workflow
- `internet_search`: low-level primitive search tool
- `read_web_page`: low-level primitive page extraction tool

### `internet_search`

Primitive tool. Runs search.

Keep it available for agents that need direct search.

### `read_web_page`

Primitive tool. Reads a public source page.

Keep it available for direct inspection and for the research agent.

### `verify_current_facts`

Current bounded workflow.

Do not throw it away. Promote it into:

```text
ResearchAgent.quickFacts(...)
```

The existing public tool can remain temporarily as a compatibility wrapper.

## First Implementation Plan

1. Create a backend `ResearchAgent` service.
2. Move the current `verifyCurrentFacts()` workflow behind `ResearchAgent.quickFacts()`.
3. Add a generic `research` tool that normal agents can be granted.
4. Make `research` call the backend `ResearchAgent` service.
5. Keep `verify_current_facts` for now, but mark it internally as the quick factual workflow.
6. Update agent bootloader guidance:
   - use `research` for current external information
   - prefer `research` over manual search chains
   - answer from the returned structured result
7. Store research traces in run-context snapshots:
   - mode
   - searches
   - sources
   - status
   - unresolved facts
8. Add tests for:
   - quick factual success
   - off-topic source rejection
   - partial result
   - official-source preference
   - domain agent receives structured research output

## Later Implementation Plan

After quick mode is stable:

1. Add deep mode.
2. Add a dedicated Deep Agents subagent configuration named `researcher`.
3. Let the coordinator domain agent delegate broad research to that subagent.
4. Instruct the subagent to return concise findings and sources instead of raw search/page outputs.
5. Stream subagent activity into the run inspector.
6. Add citations or source references to user-visible answers.
7. Add provider options beyond Tavily if needed.

## References

- LangChain Deep Agents overview: https://docs.langchain.com/oss/javascript/deepagents/overview
- LangChain Deep Agents subagents: https://docs.langchain.com/oss/javascript/deepagents/subagents
- LangChain Deep Agents context engineering: https://docs.langchain.com/oss/javascript/deepagents/context-engineering
- LangChain Deep Research tutorial: https://docs.langchain.com/oss/python/deepagents/deep-research
- Tavily agents documentation: https://docs.tavily.com/agents
