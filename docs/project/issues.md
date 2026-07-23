# Issue Register

**Status:** Current project record
**Audience:** Everyone
**Canonical for:** Known problems that cannot be fixed immediately

This is the repository's only issue tracker. Use it to preserve problems that
have been observed but cannot be fixed as part of the current work. Do not use
it for feature ideas, roadmap items, or speculative improvements.

## Next Issue ID

`ISSUE-001`

Increase this value whenever an issue is added. Never reuse an earlier ID, even
after its entry has been removed.

## Open Issues

There are no recorded open issues.

## Entry Template

```md
### ISSUE-NNN: Short, specific description

**Status:** Open
**Area:** Affected part of the product
**Impact:** Low | Medium | High
**Found:** YYYY-MM-DD

#### Problem

Describe what was observed in plain language.

#### Expected Behavior

Describe what should happen instead.

#### Evidence

Add concise reproduction steps, logs, screenshots, or links when available.

#### Notes

Record useful constraints, suspected causes, or investigation results.
```

## Workflow

1. Search this page to avoid duplicates.
2. Copy the template under `Open Issues`.
3. Replace `ISSUE-NNN` with the next issue ID and increment the value above.
4. Update the entry as evidence or understanding improves.
5. Reference the issue ID in related commits.
6. After fixing the problem, update the changelog when appropriate and remove
   the issue entry. Git history remains the record of resolved issues.

## Related Pages

- [Wiki home](../README.md)
- [Current milestone](../product/current-milestone.md)
- [Testing and verification](../development/testing.md)
- [Changelog](../../CHANGELOG.md)
