# rdma26 Documentation

Welcome to the rdma26 project wiki. Start with the section that matches what
you are trying to learn or change.

## Start Here

### I Am New To The Project

1. Read the [product vision](./product/vision.md) to understand the destination.
2. Read the [current milestone](./product/current-milestone.md) to understand
   the present focus.
3. Use the [architecture overview](./architecture/README.md) to see how the
   application fits together.
4. Follow [local development](./development/local-development.md) to run it.

### I Am Making A Product Decision

- [Product vision](./product/vision.md): permanent product goal, promises, and
  principles.
- [Roadmap](./product/roadmap.md): ordered product outcomes.
- [Current milestone](./product/current-milestone.md): active outcome,
  evaluation, and definition of done.
- [Current non-goals](./product/non-goals.md): deliberately deferred work.

### I Am Changing The Implementation

- Begin with the [architecture overview](./architecture/README.md).
- Find the relevant concept, capability, or interface below.
- Read the [documentation rules](./AGENTS.md) before changing the wiki.
- Use [testing and verification](./development/testing.md) before handing off a
  change.

## Core Concepts

- [Agents](./concepts/agents.md): identity, models, capabilities, conversations,
  and isolation.
- [Context windows](./concepts/context-window.md): what an agent sees during a
  model call.
- [Memory](./concepts/memory.md): conversation state, long-term memory,
  retrieval, and user controls.
- [Skills](./concepts/skills.md): reusable guidance and skill packages.

## Implemented Architecture

- [Architecture overview](./architecture/README.md): system shape, data flow,
  and service boundaries.
- [Backend structure](./architecture/backend.md): backend ownership and
  dependency direction.
- [Storage](./architecture/storage.md): databases, files, migrations, and
  deletion boundaries.
- [Observability and costs](./architecture/observability.md): model accounting,
  run context, pricing, and estimates.
- [Agent evaluation](./architecture/evaluation.md): versioned cases, live runs,
  reports, and baseline comparisons.
- [OpenAI ChatGPT/Codex provider](./architecture/openai-chatgpt-provider.md):
  OAuth, transport, support boundary, and capability matrix.

## Capabilities

- [Web research](./capabilities/web-research.md): hosted search, sources, and
  known-URL readers.
- [Interpreter](./capabilities/interpreter.md): deterministic JavaScript
  calculations and transformations.

## Interface Reference

- [API](./reference/api.md)
- [CLI](./reference/cli.md)
- A running backend also provides interactive OpenAPI documentation at
  `http://localhost:3000/docs`.

## Development And Operations

- [Local development](./development/local-development.md)
- [Testing and verification](./development/testing.md)
- [Skills release checklist](./development/release-checklists/skills.md):
  temporary manual acceptance checks for the current skills release.
- [Changelog](../CHANGELOG.md)

## Documentation Policy

The wiki separates product direction, current implementation, concepts,
capabilities, reference material, and temporary work. Each subject has one
canonical page. Completed plans and superseded specifications are removed;
durable decisions are incorporated into the appropriate current page.

Agents and contributors must follow [docs/AGENTS.md](./AGENTS.md) when adding or
updating documentation.
