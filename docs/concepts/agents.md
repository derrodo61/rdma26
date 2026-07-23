# Agents

**Status:** Current product model
**Audience:** Product and engineering
**Canonical for:** Agent identity, configuration, capabilities, conversations,
and isolation

An agent is a configured assistant with a stable identity and a defined scope.
Different agents can serve different roles without sharing all of their
instructions or private context.

## What Belongs To An Agent

Each configured agent can have its own:

- name, identity, and job description;
- model selection;
- granted capabilities;
- threads and conversation history;
- local long-term memory;
- Deep Agents filesystem state.

Global user memory is separate. It contains information deliberately made
available across the intended agents.

## Identity And Configuration

An agent's durable identity is stored in
`.assistant-data/agents/<agent-id>/configuration/soul.md`. Stable role,
personality, and operating principles belong there. Temporary facts,
conversation history, and arbitrary memories do not.

Agent profiles hold structured settings such as the display name, selected
model, enabled capabilities, and whether long-term memory is enabled.

## Isolation

Threads belong to one agent and can only be continued through that agent.
Agent-local memory and filesystem state must not leak into another agent's
context. Shared information must use an explicitly global scope.

Protected system agents may receive controlled administrative tools that are
not available through the ordinary capability catalog.

## Capabilities, Tools, And Skills

A capability gives an agent permission and runtime support to perform a class
of work. A tool is a concrete operation made available by a capability or by
protected system behavior. A skill teaches a reusable workflow but does not
grant permission by itself.

## Related Pages

- [Product vision](../product/vision.md)
- [Context windows](./context-window.md)
- [Memory](./memory.md)
- [Skills](./skills.md)
- [Architecture overview](../architecture/README.md)
