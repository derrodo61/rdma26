# Repository Instructions

## Goal

This repository is a test Angular application for evaluating the LangChain Deep Agents SDK from TypeScript. Treat it as a real Angular app, not a throwaway script: keep the implementation small, idiomatic, testable, and easy to evolve.

## Angular Standards

- Use the current Angular CLI and official Angular documentation as the source of truth.
- Before adding LangChain or Deep Agents SDK code, verify the current TypeScript package names and APIs from official docs or package metadata.
- Prefer standalone Angular architecture. Do not introduce NgModules unless a dependency makes that necessary.
- Use strict TypeScript. Avoid `any`; use precise types or `unknown` plus narrowing.
- Use signals for local UI state and `computed()` for derived state.
- Use `input()` and `output()` APIs for component boundaries when creating new components.
- Use native Angular control flow in templates: `@if`, `@for`, and `@switch`.
- Keep templates simple. Move nontrivial logic into typed component methods, services, or computed signals.
- Prefer Reactive forms or Signal Forms for new forms. Do not use template-driven forms by default.
- Use `inject()` for dependency injection in new code.
- Keep services single-purpose and provided at the narrowest sensible scope; use root providers for app-wide singletons.
- Do not use `ngClass` or `ngStyle`; prefer class and style bindings.
- Use accessible HTML first, then ARIA only where needed. Keyboard flow, focus states, labels, and color contrast matter.
- Keep components focused. Split only when it improves clarity or testability.

## Project Intent

This repository is a focused Angular test app for evaluating the LangChain Deep Agents SDK from TypeScript. Keep the app oriented around a practical SDK test harness rather than a marketing page.

## App Architecture

- Keep the Angular frontend and TypeScript backend/proxy in one repository.
- Use a backend/proxy-first architecture for Deep Agents runtime code.
- Use a TypeScript Node backend so this repository evaluates the TypeScript Deep Agents SDK end to end.
- Prefer Fastify for backend HTTP routes unless another Node framework is clearly better for the task.
- Prefer Server-Sent Events for one-way agent run streaming unless bidirectional realtime communication is needed.
- Separate SDK integration from presentation.
- Keep LangChain/deepagent calls in backend services or small adapter modules, not directly inside Angular components.
- Share typed frontend/backend contracts through a small shared TypeScript layer when practical.
- Keep secrets and server-only credentials out of browser code. If an API key is required, use the backend/proxy.
- Show errors clearly in the UI without leaking secrets.
- Preserve the option to package the app with Electron later by keeping privileged agent runtime code behind a typed boundary that could move to Electron's main process.

## LangChain / Deep Agents Standards

- Use the `langchain-docs` MCP server as the preferred source for current LangChain, LangGraph, and Deep Agents documentation when implementing or debugging SDK examples.
- When unsure about Deep Agents, LangChain, or LangGraph TypeScript APIs, check the official SDK documentation or package metadata before writing code.
- Do not invent SDK imports, method names, event names, stream shapes, tool schemas, or configuration options.
- Prefer the documented TypeScript APIs and examples over inferred Python equivalents.
- Use the browser-safe Deep Agents entrypoint for Angular browser code when the SDK documentation requires it.
- Keep Node-only SDK behavior, filesystem access, model credentials, and privileged tools outside the Angular browser bundle.
- Create all backend LLM instances through the central accounting-aware model factory/registry once it exists. When adding a new agent, subagent, capability, tool workflow, summary job, or maintenance job that needs an LLM, do not instantiate provider models directly in feature code. This pattern is required so parent-agent and subagent requests can be measured consistently for token usage, cost, timing, and context inspection.
- Wrap SDK calls in a small typed adapter or Angular service so UI components do not depend directly on SDK internals.
- Model agent state, run state, streamed output, tool events, and errors with explicit TypeScript types.
- Validate tool input and output schemas at the boundary where application code calls the agent.
- Add focused tests for adapter behavior, error handling, and any custom tool integration.

## Styling And Theming

- Use Tailwind CSS as the default styling system.
- Prefer simple, accessible Angular components styled with Tailwind utilities.
- Keep theme values in CSS variables or Tailwind theme tokens rather than hard-coded one-off colors.
- Use Angular CDK for behavior-heavy primitives such as overlays, dialogs, menus, focus traps, and accessibility helpers.
- Do not add Angular Material, PrimeNG, or another component framework unless the app clearly needs it.
- Avoid large custom CSS files; use component styles only for layout or interaction details that are awkward in utilities.

## Testing And Verification

- Use npm as the package manager.
- Use the Angular CLI for project creation and code generation.
- Use strict TypeScript, standalone Angular APIs, routing, and Tailwind during bootstrap.
- Add formatting and linting early.
- Use the Angular CLI default unit test runner, currently Vitest for new projects.
- Run tests through Angular CLI commands such as `ng test`, not direct custom runner scripts unless needed.
- Add focused tests for adapter/service behavior and for user-visible component states.
- Run formatting, linting, type checking, and tests before considering implementation complete.
- For UI work, run the app locally and verify it in a browser at desktop and mobile widths.

## Change Discipline

- Keep changes reviewable and close to the requested scope.
- Do not silently add deployment, CI, or external automation.
- Preserve unrelated user changes.
- When public docs or SDK APIs may have changed, verify them live instead of relying on memory.
