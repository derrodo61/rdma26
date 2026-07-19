# Skill Management Implementation Plan

Status: active and temporary. Remove this file when all milestones are complete,
after moving lasting decisions into [skills.md](./skills.md) or
[architecture.md](./architecture.md).

The product behavior, terminology, trust boundaries, and acceptance criteria are
defined in [skills.md](./skills.md). This plan translates that design into
reviewable implementation work.

## Invariants

- The Agent Skills specification is the package contract. rdma26 does not create
  a private `SKILL.md` variant.
- A library package is stored once and may be attached to several agents.
- Installed, attached, and used remain distinct states.
- Attaching or loading a skill never grants a capability, tool, credential,
  network access, filesystem access, or script execution.
- Bundled and external packages are immutable. Customization creates a user-owned
  clone.
- UI, API, CLI, protected tools, and agent runs use the same backend services.
- Existing agent-local packages are preserved until migration is verified.
- Every model and embedding request continues to use the accounting-aware
  factories.

## Milestone 1: Library And Runtime Foundation

Status: implemented and verified on `codex/skill-management-foundation`; ready
for review before merge.

### Shared contracts

- Add required `attachedSkills: readonly string[]` to `AgentProfile`.
- Persist attachments in each agent's existing `agent.json` profile.
- Add internal skill types for metadata, ownership, package location, and runtime
  source. Public API response contracts wait for Milestone 3.
- Normalize skill ids as lowercase Agent Skills names and reject duplicates.

### Skill library

Create `server/src/skills/skill-library.ts` as the owner of package discovery and
runtime resolution.

It will:

- create `.assistant-data/skills/bundled/` and `.assistant-data/skills/user/`;
- materialize the bundled `pricing-source-analysis` package once in the shared
  bundled library;
- parse and validate required `SKILL.md` frontmatter with the installed `yaml`
  package;
- enforce Agent Skills name constraints and directory-name equality;
- list packages across bundled and user roots with deterministic precedence;
- reject duplicate ids across ownership roots;
- resolve an attachment id to a physical package directory and a virtual
  `/skills/<id>/` source;
- never expose an unattached package to an agent run.

External package storage and installation records are added in Milestone 2.

### Legacy migration

During `AgentRegistry.ensureReady()`:

1. Ensure the shared library and bundled packages exist.
2. Read every current agent profile, accepting a missing `attachedSkills` field.
3. Scan `.assistant-data/agents/<agent-id>/deepagent/skills/`.
4. Ignore and remove the already-obsolete `web-research` package.
5. Map the Cost Analyst's existing `pricing-source-analysis` package to the
   bundled package.
6. For every other valid package, copy it to the user library only when that id
   is not already present.
7. If an id already exists with identical content, reuse it. If content differs,
   stop with a clear collision error and overwrite nothing.
8. Add the migrated ids to the agent's normalized `attachedSkills` list and
   rewrite the profile.
9. Move the verified original package to the agent's `migration-backups/`
   directory so it remains recoverable but is no longer visible through the
   Deep Agents filesystem.

New Cost Analyst profiles receive `pricing-source-analysis` as a default
attachment. Other new agents start with no attached skills.

### Runtime mounting

- Inject `SkillLibrary` into `ChatRunService`.
- Resolve the current agent's attachments before creating `PersonalAgent`.
- Add one `CompositeBackend` route for each attached package at
  `/skills/<id>/`.
- Pass only the resolved direct skill paths to Deep Agents instead of scanning
  the broad `/skills/` directory.
- Keep progressive disclosure and existing `skillsUsed` observation unchanged.
- Fail a run clearly if an attached id is missing or invalid instead of silently
  omitting it.

### Milestone 1 tests

- bundled package creation and metadata parsing;
- valid user package discovery;
- invalid name, missing metadata, and duplicate-id rejection;
- migration of a legacy custom skill without deleting its source;
- reuse of identical legacy packages across agents;
- collision failure without overwriting either package;
- Cost Analyst bundled-skill attachment migration;
- profile-shape migration for agents with no skills;
- runtime resolution returns only attached packages;
- existing skill-use observation still recognizes mounted paths;
- full frontend and backend regression suites.

## Milestone 2: Installation And Compatibility

Status: implemented and verified on `codex/skill-installation-compatibility`;
ready for review.

- Add immutable external-package storage and installation records with source,
  revision, version, content hash, author, license, timestamps, and pin state.
- Implement safe local-directory and single-package archive import.
- Implement Git repository, subdirectory, and revision import without executing
  repository code.
- Add archive traversal, symlink, size, file-type, secret, and executable-content
  checks.
- Add compatibility reports: compatible, instructions only, missing
  capabilities, unsupported runtime, and unsafe or invalid.
- Preserve original package content; store rdma26 compatibility mappings
  separately.
- Add explicit update inspection, diffing, validation, approval, rollback, and
  version pinning.
- Add a catalog adapter interface and a ClawHub adapter.
- Verify representative public Anthropic and OpenAI/Codex packages through the
  common source paths.

## Milestone 3: Shared Service, API, And CLI

Status: implemented for installed-library inspection, agent attachment,
installation, catalog search, update inspection and apply, pinning, and
rollback. Clone operations remain part of later user-skill management, while
proposal operations belong to Milestone 4.

- Expose typed library, package, installation, update, clone, proposal, and
  attachment operations through `AssistantRuntime`.
- Add authenticated HTTP routes and OpenAPI schemas.
- Add CLI commands backed by the same runtime methods.
- Add protected read-only administration tools only where an operator genuinely
  needs them.
- Keep approval mutations out of ordinary agent tools.

## Milestone 4: Agent Proposals

- Implement persisted proposal states: pending, stale, quarantined, applied,
  rejected, and superseded.
- Bind proposals to source and target hashes.
- Add validation and scanning at proposal creation and again at apply time.
- Add the `skill_authoring` capability with proposal-only create and update
  tools.
- Add the `skill_acquisition` capability with catalog search, inspection,
  comparison, compatibility, and installation-proposal tools.
- Require installed-library and trusted-catalog search before authoring when both
  capabilities are enabled.
- Keep apply, attach, capability grant, dependency installation, and execution
  outside both capabilities.

## Milestone 5: Angular Experience

Status: implemented for installed-library management and per-agent attachment
on `codex/skill-management-ui`. Proposal review, clone/delete, and run-level
used-state presentation remain pending their corresponding backend milestones.

- Add a Skills section to the agent editor for attached skills.
- Add a library view for installed packages, catalog search, source inspection,
  install, update, pin, clone, and delete.
- Add a proposal review queue with files, evidence, diffs, scanner findings,
  compatibility, stale state, and explicit apply or reject actions.
- Show installed, attached, and used as separate states.
- Show missing capability or runtime requirements without granting them.
- Verify authenticated desktop and mobile flows with Playwright.

## Milestone 6: Observability And Evaluation

- Record attached-skill metadata in run context separately from skills actually
  loaded.
- Record supporting skill-file reads and future sandbox script executions with
  package provenance.
- Add stable evaluations for relevant selection, irrelevant non-selection,
  existing-before-new preference, capability boundaries, malicious package
  rejection, and migration behavior.
- Add cost and context-size measurements for large attached-skill catalogs.

## Completion

Before the final merge:

- satisfy every acceptance criterion in [skills.md](./skills.md);
- run formatting, linting, frontend tests, backend tests, and type checks;
- verify migration against a copy of representative local `.assistant-data`;
- verify agent settings, library, proposal review, and run details in an
  authenticated browser;
- remove this temporary plan and move any remaining durable decisions to the
  canonical documentation.
