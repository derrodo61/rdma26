# Web Research

rdma26 uses OpenAI's provider-hosted web search as its normal internet-search capability. There is no separate research agent or research model.

## Configuration

Grant the `web_search` capability to an agent through the UI, API, or CLI. The capability uses the model selected for that chat run and works with configured OpenAI API models or supported ChatGPT/Codex models.

```bash
./bin/rdma26 agents:tools:grant --agent ronaldo --tool web_search
```

Agents without this grant cannot search the internet. The grant is not enabled automatically for newly created agents.

## Runtime Flow

```mermaid
flowchart LR
    U["User question"] --> A["Selected agent and model"]
    A --> D{"Current external information needed?"}
    D -->|No| R["Answer directly"]
    D -->|Yes| W["OpenAI hosted web_search"]
    W --> S["Search and open relevant pages"]
    S --> A
    A --> C["Answer with source citations"]
```

OpenAI formulates search queries, searches, opens pages when needed, and returns
citation annotations. rdma26 requests provider-reported search sources as
response metadata and stores them together with final-answer citations. This
preserves source URLs in run context and the UI even when a model omits citation
annotations from its final prose.

## Answer Handling

Hosted search remains part of the selected model's normal turn. rdma26 returns
the completed model answer directly and does not reject or rewrite it through a
separate citation-counting or research-repair workflow. Search actions,
provider-reported source URLs, final-answer citations, calls, tokens, and latency
remain available in run context for observability and evaluation.

The bootloader prompt only asks the model to use hosted search for current or
uncertain external facts, preserve citations, and state material uncertainty.
Ordinary web questions do not require a separate research skill.

## Known-URL Readers

`read_web_page` and `read_web_page_structure` remain optional low-level tools for cases where the target URL is already known. They are not search providers:

- `read_web_page` returns readable page text;
- `read_web_page_structure` returns focused tables, headings, links, lists, Markdown, or article content.

These readers use local HTTP fetching and reject localhost and private-network URLs.

## Streaming And Observability

Chat still streams run activity and the final answer through SSE. The current Deep Agents event stream does not preserve all hosted-search citation metadata, so hosted-search runs use the final invocation result to capture search actions and citations reliably. LLM calls remain routed through the accounting-aware model factory.

Research behavior, citations, calls, tokens, context size, cost, and latency are measured by the `research` evaluation suite described in [evaluation.md](./evaluation.md).
