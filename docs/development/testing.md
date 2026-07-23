# Testing And Verification

**Status:** Current workflow
**Audience:** Contributors
**Canonical for:** Repository-wide automated and manual verification

Run verification in proportion to the change. Before considering an
implementation complete, run the checks relevant to every area it touched.

## Automated Checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run server:test
```

- `npm run format:check` verifies formatting.
- `npm run lint` runs Angular linting.
- `npm run typecheck` builds Angular and checks backend TypeScript.
- `npm test` runs Angular tests through the Angular CLI.
- `npm run server:test` runs backend tests.

## Behavioral Evaluation

Changes to agent prompts, capabilities, tools, skills, memory retrieval,
delegation, context construction, or model behavior also require relevant
stable behavioral evaluations. One successful conversation is not enough to
establish reliability.

See [agent evaluation](../architecture/evaluation.md) and the
[current milestone](../product/current-milestone.md).

## Browser Verification

For user-interface work, run the application and verify the affected flow at
desktop and mobile widths. When local authentication is enabled, sign in
through the login interface using credentials from `.env`; never print those
credentials in logs or reports.

## Documentation Verification

Check that:

- new or moved pages are linked from the [wiki home](../README.md);
- relative Markdown links resolve;
- current behavior and future direction remain clearly distinguished;
- canonical information has not been duplicated.

## Related Pages

- [Local development](./local-development.md)
- [Agent evaluation](../architecture/evaluation.md)
- [Current milestone](../product/current-milestone.md)
- [Documentation instructions](../AGENTS.md)
