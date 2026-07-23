# Documentation Instructions

These instructions apply to every file under `docs/`. Treat this directory as
the project wiki and maintain its information architecture whenever
documentation changes.

## Read Before Writing

Before adding or moving documentation:

1. Read [the wiki home](./README.md).
2. Read the canonical page for the subject being changed.
3. Check nearby pages for overlapping information and existing links.

Do not create a new page until you have confirmed that the information does not
belong on an existing canonical page.

## Information Architecture

Place documentation according to its purpose:

- `product/`: vision, roadmap, current milestone, scope, and product decisions.
- `project/`: repository-local issue tracking and other project-wide records.
- `concepts/`: explanations of durable domain concepts.
- `architecture/`: implemented system structure and technical decisions.
- `capabilities/`: behavior and boundaries of agent capabilities.
- `reference/`: exact API and CLI reference material.
- `development/`: setup, testing, release checks, and contributor workflows.

The repository root `README.md` is the front door. Keep it short. Detailed
information belongs in this wiki.

## Canonical Ownership

- Keep one canonical page per subject.
- Link to canonical information instead of copying it into multiple pages.
- State whether a page describes current implementation, future direction, or
  temporary validation work.
- Keep the product vision stable and long-lived. Put active delivery criteria
  in `product/current-milestone.md`, not in the vision.
- Put exact commands and endpoint details in reference or development pages,
  not in conceptual overviews.
- Remove superseded documents after incorporating any durable information.
  Do not accumulate an archive of obsolete plans in `docs/`.

## Issue Register

[The issue register](./project/issues.md) is the only issue-tracking system for
this repository. Do not create or mirror issues in another tracker.

- Read the register before investigating or changing an area with known
  problems.
- Add a problem when it is observed but cannot be fixed in the current work.
- Record problems, not feature ideas or general roadmap items.
- Search for duplicates before assigning a new issue ID.
- Use the next unused sequential `ISSUE-NNN` identifier and never reuse an ID.
- Keep entries concise and include impact, observed behavior, expected
  behavior, and available evidence.
- Reference the issue ID in related commits and documentation.
- When an issue is fixed, record the fix in the changelog when appropriate,
  then remove the resolved entry from the register.

## Page Shape

Every substantial page should begin with:

```md
# Clear Human-Readable Title

**Status:** Current implementation | Authoritative direction | Active | Temporary
**Audience:** Who should read this
**Canonical for:** The information this page owns
```

Use plain language before technical detail. Prefer headings that match the
questions a reader would ask. Keep paragraphs short, define project-specific
terms, and avoid compressed descriptions that require implementation knowledge
to understand.

End substantial pages with a `Related Pages` section containing useful
two-way links to neighboring subjects.

## Navigation And Links

- Add every durable page to [the wiki home](./README.md).
- When moving a page, update all repository links in the same change.
- Use relative Markdown links within the repository.
- Use descriptive link labels rather than “here” or raw paths.
- Link a concept on its first meaningful mention when another page owns its
  explanation.
- Preserve historical paths written as history in `CHANGELOG.md`; do not rewrite
  past release notes merely because a file moved later.
- Check local links before considering a documentation change complete.

## Maintenance With Code Changes

When behavior changes, update the canonical documentation in the same change.
In particular:

- architecture changes update the relevant `architecture/` page;
- user-visible capability changes update `capabilities/` and relevant
  references;
- API or CLI changes update `reference/`;
- setup or verification changes update `development/`;
- product scope changes update the roadmap, milestone, or non-goals without
  silently changing the vision.
- newly discovered unresolved problems update `project/issues.md`, and fixes
  remove the corresponding entry.

Update [the changelog](../CHANGELOG.md) when the repository's normal change
discipline calls for it.
