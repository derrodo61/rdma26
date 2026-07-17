# OpenAI ChatGPT/Codex Provider

## Decision

rdma26 treats subscription-backed ChatGPT/Codex access as a separate model
provider from the public OpenAI Platform API:

- `openai-api` uses `OPENAI_API_KEY` and the public OpenAI API.
- `openai-chatgpt` uses a ChatGPT login, OAuth tokens, and the Codex Responses
  backend.

The two providers may expose the same model name, but they have different
credentials, transport contracts, entitlements, accounting semantics, and
supported capabilities. A ChatGPT subscription is not represented as an API
key and does not make general OpenAI Platform endpoints available.

## Support Boundary

OpenAI officially documents two Codex sign-in modes: ChatGPT subscription
access and API-key usage-based access. It also documents ChatGPT authentication
for trusted private automation when a workflow specifically needs to run as a
Codex account.

References:

- [Codex authentication](https://developers.openai.com/codex/auth)
- [Codex authentication in CI/CD](https://developers.openai.com/codex/auth/ci-cd-auth)
- [Codex access tokens](https://developers.openai.com/codex/enterprise/access-tokens)

OpenAI does not document the first-party Codex OAuth client id or
`chatgpt.com/backend-api/codex` as a stable, general-purpose third-party API.
The concrete protocol used here is derived from the open-source OpenWiki
implementation and may stop working when Codex changes. The UI labels this
provider experimental for that reason.

Source studied:

- [langchain-ai/openwiki](https://github.com/langchain-ai/openwiki)
- `src/agent/openai-chatgpt-oauth.ts` in that repository
- `src/agent/index.ts` in that repository

## Model Identifiers

Public API models retain their existing ids, for example `gpt-5.4`.
ChatGPT/Codex selections use `chatgpt:<model>`, for example
`chatgpt:gpt-5.4`. The prefix makes the provider unambiguous while preserving
existing saved API model selections.

`OPENAI_MODELS` configures public API model names.
`OPENAI_CHATGPT_MODELS` configures ChatGPT/Codex model names and defaults to the
same names as `OPENAI_MODELS`. Availability is still controlled by the signed-in
ChatGPT account and Codex backend.

## Authentication Flow

1. The backend creates a PKCE verifier, challenge, and random OAuth state.
2. It binds a temporary callback server to `localhost:1455` only.
3. The UI or CLI opens the OpenAI authorization URL.
4. The callback validates state and exchanges the code at
   `https://auth.openai.com/oauth/token`.
5. The backend extracts the ChatGPT account id and display metadata from the
   returned access token.
6. Tokens are stored under
   `.assistant-data/provider-auth/openai-chatgpt.json` with directory mode
   `0700` and file mode `0600`.
   The callback reports success only after exchange and persistence complete.
7. Before each model construction, the backend refreshes a token that is
   expired or within 60 seconds of expiry and atomically persists rotated
   tokens.
8. Logout deletes the stored credentials and cancels a pending login.

Tokens never enter the Angular bundle, API responses, logs, run context, or LLM
accounting records.

## Model Transport

The central model factory resolves the provider from the selected model id.
For `openai-chatgpt`, it creates LangChain's `ChatOpenAI` Responses integration
with:

- base URL `https://chatgpt.com/backend-api/codex`;
- the OAuth access token as the bearer credential;
- the `chatgpt-account-id`, `originator`, and experimental Responses headers;
- streaming enabled because the Codex backend requires it;
- zero-data-retention mode so requests use `store: false`;
- a request adapter that maps `system` input roles to `developer` roles.

Every call still passes through rdma26's central model factory and accounting
callback. Accounting records provider `openai-chatgpt` and the raw model name.
No API-price estimate is inferred for subscription-backed calls.

## Capability Matrix

| Capability                               | `openai-api`   | `openai-chatgpt`         |
| ---------------------------------------- | -------------- | ------------------------ |
| Chat and Deep Agents tool calls          | Yes            | Experimental             |
| Token refresh                            | Not applicable | Yes                      |
| OpenAI hosted web search                 | Yes            | Yes for supported models |
| Embeddings and semantic memory index     | Yes            | No                       |
| Pricing sync and Platform administration | Yes            | No                       |

The ChatGPT provider is deliberately limited to model calls verified through
the Codex Responses transport. Hosted web search grants are passed through to
that transport, which validates support for the selected model. Embeddings,
pricing, and other public Platform APIs continue to require `OPENAI_API_KEY`.

## Application Surfaces

- API: provider status, login start, and logout routes under
  `/api/model-providers`.
- CLI: `providers:list`, `providers:login --provider openai-chatgpt`, and
  `providers:logout --provider openai-chatgpt`.
- UI: a Model Providers settings page shows both providers and starts or clears
  the ChatGPT login.
- Agent model selectors show provider-qualified labels and store the unique
  model selection id.

## Failure Handling

- Missing API key or ChatGPT login returns the existing local fallback with
  provider-specific setup guidance.
- OAuth state mismatch, callback timeout, token exchange failure, missing
  account identity, and refresh failure are surfaced without token contents.
- Only one login flow may be pending in a backend process.
- Starting a second process while port 1455 is occupied returns a clear error.
- A stored `web_search` grant is passed to ChatGPT/Codex runs without changing
  the agent configuration. The Codex Responses backend remains authoritative
  for model-specific support.
- Citation extraction is scoped to the current conversation turn and retained
  for observability. The completed hosted-search answer is returned directly;
  the application does not add a citation-counting rejection gate or a separate
  repair turn.

## Acceptance Criteria

- API-key model behavior remains unchanged for existing model ids.
- ChatGPT/Codex models are distinguishable and selectable per agent.
- OAuth tokens are backend-only, persisted with restrictive permissions, and
  refreshed before expiry.
- Model construction carries the required Codex endpoint and headers.
- Accounting records the correct provider and raw model.
- API, CLI, and UI expose consistent provider status and login/logout behavior.
- Hosted web search works with supported ChatGPT/Codex models; embeddings remain
  API-key-only.
- Unit tests cover identity decoding, expiry, completed OAuth persistence,
  request adaptation, model resolution, hosted search source passthrough, and
  provider status.
- Formatting, linting, frontend tests, backend tests, build, and type checking
  pass.
