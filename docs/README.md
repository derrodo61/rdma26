# Documentation

The documentation is organized by purpose. Product direction is separate from
implemented behavior so that future plans are not mistaken for working
features.

## Product Direction

- [Product vision](./vision.md): authoritative goal, principles, long-term
  direction, milestone, and acceptance criteria.

## Implemented Architecture

- [Architecture](./architecture.md): current frontend, backend, agent runtime,
  data flow, and service boundaries.
- [Backend structure](./backend.md): backend folder ownership and dependency
  direction.
- [OpenAI ChatGPT/Codex provider](./architecture/openai-chatgpt-provider.md):
  OAuth flow, support boundary, model transport, and capability matrix.
- [Storage](./storage.md): SQLite databases, files, migrations, and deletion
  boundaries.
- [Memory](./memory.md): current thread state, long-term memory, semantic
  retrieval, and user controls.
- [Web research](./research.md): hosted search, source handling, and known-URL readers.
- [Observability and costs](./observability.md): LLM and embedding accounting,
  pricing, run context, and cost estimates.
- [Agent evaluation](./evaluation.md): versioned cases, reproducible live runs,
  reports, and baseline comparisons.

## Interfaces

- [API reference](./api.md)
- [CLI reference](./cli.md)
- Interactive OpenAPI documentation is available from a running backend at
  `http://localhost:3000/docs`.

## Project History

- [Changelog](../CHANGELOG.md)

The repository intentionally does not keep completed implementation plans or
superseded specifications. Durable decisions belong in the current-state or
vision documents above.
