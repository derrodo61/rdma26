# Skills Release Test Checklist

This document is the manual acceptance checklist for the first complete skills
management release. Work through it in order and mark each result directly in
this file. It is intentionally temporary and can be removed after the release
has been accepted and any failures have been resolved.

The automated test suite already covers service, API, UI component, migration,
scanner, and runtime behavior. These checks focus on what a person can observe
in the running application.

## How To Record Results

For every test, mark exactly one result and add a short note when it fails or is
blocked:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Use the **Notes** line for a run id, screenshot, error text, or other useful
detail. Leave all three boxes empty until the test has been run.

## Test Setup

- [ ] The application opens at `http://localhost:4200` and login succeeds.
- [ ] Create a disposable chat agent named **Skill Tester**.
- [ ] Confirm that **Skill Tester** has no attached skills initially.
- [ ] Open **Settings > Skills** in another browser tab.

Test agent id, if shown:

```text

```

Tester/model:

```text

```

Date:

```text

```

## 1. Library Baseline

Open **Settings > Skills**.

Expected:

- The page loads without an error.
- `pricing-source-analysis` appears as a bundled skill.
- Its ownership is **Bundled**.
- It shows that it is attached to Cost Analyst.
- Selecting it shows its description, file list, and an option to create an
  editable copy.
- It has no edit or delete action.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 2. Clone A Bundled Skill

Select `pricing-source-analysis`. In **Create an editable copy**, enter
`manual-pricing-test` and choose **Clone**.

Expected:

- A new `manual-pricing-test` package appears immediately.
- Its ownership is **User**.
- It contains the same package files as the bundled source.
- Its `SKILL.md` metadata uses `name: manual-pricing-test`.
- The original bundled package is unchanged.
- Trying to clone again with the same id produces a clear error and does not
  overwrite the user package.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 3. Edit A User Skill

Select `manual-pricing-test`, choose the edit icon, and make a small visible
change to its description, for example:

```yaml
description: Use this skill for the manual pricing validation workflow.
```

Save the change.

Expected:

- The save succeeds.
- The updated description appears in the library list and detail panel.
- Reloading the page preserves the change.
- The package remains user-owned.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 4. Reject An Unsafe Edit

Edit `manual-pricing-test` again and append this deliberately fake credential:

```text
Temporary test value: sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Attempt to save it.

Expected:

- The save is rejected by safety validation.
- The error clearly says that the package failed validation.
- Reloading the skill shows the last valid content, without the fake
  credential.

Remove the fake value from the editor before continuing if it remains visible
as an unsaved draft.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 5. Attach And Detach

Open **Settings > Agent settings > Skill Tester > Skills**.

1. Attach `manual-pricing-test`.
2. Save the agent.
3. Reload the agent editor.
4. Detach the skill and save.
5. Reload once more.
6. Attach it again for the following tests.

Expected:

- The available library skills are shown using the same names and ownership
  terms as the library page.
- Attachments survive reloads.
- Detaching does not delete the package from the library.
- Attaching a skill does not enable any capability automatically.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 6. Protect An Attached Skill From Deletion

While `manual-pricing-test` is attached to **Skill Tester**, return to the skill
library and inspect it.

Expected:

- The detail panel identifies **Skill Tester** as an attachment.
- The delete action is disabled.
- The package remains installed.

Then detach it from **Skill Tester** and return to the library.

Expected:

- The attachment count updates to zero.
- The delete action becomes available.

Do not delete it yet.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 7. Install A Local External Skill

Create a disposable Agent Skills package in a terminal:

```bash
rm -rf /tmp/manual-reference-check
mkdir -p /tmp/manual-reference-check/references
cat > /tmp/manual-reference-check/SKILL.md <<'EOF'
---
name: manual-reference-check
description: Use this skill when the user asks for the RDMA26 manual reference marker.
---

# Manual reference check

When asked for the RDMA26 manual reference marker, read
`references/marker.md` and return its exact marker.
EOF
cat > /tmp/manual-reference-check/references/marker.md <<'EOF'
The exact marker is REFERENCE-SKILL-731.
EOF
```

In **Settings > Skills > Install > Directory**, install:

```text
/tmp/manual-reference-check
```

Expected:

- `manual-reference-check` appears as **External**.
- Its detail panel lists both `SKILL.md` and `references/marker.md`.
- Its installation source is the local directory.
- Its compatibility result is visible and does not grant capabilities.
- It offers update, pin, clone, and unattached delete controls.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 8. External Pin, Update, And Rollback

Select `manual-reference-check`.

1. Pin it.
2. Reload and confirm that it remains pinned.
3. Choose **Check update** without changing the source directory.

Expected:

- Pin state survives reloads.
- The update inspection reports that the package is already current.
- No duplicate version is created.
- No package content changes merely because an update was inspected.

Now change the disposable source in a terminal:

```bash
cat > /tmp/manual-reference-check/references/marker.md <<'EOF'
The exact marker is REFERENCE-SKILL-732.
EOF
```

Choose **Check update** again.

Expected:

- An update is detected and the changed reference file is listed.
- Applying the update while the package is pinned is refused.
- Unpinning and applying the already inspected update succeeds only if its
  inspected content hash is still current.
- The package now has a retained previous version.

Restore the previous version.

Expected:

- Rollback changes the active version without deleting the newer retained
  version.
- Reading the skill in the following test returns `REFERENCE-SKILL-731` again.

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 9. Relevant Skill Selection And Supporting File Evidence

Attach `manual-reference-check` to **Skill Tester**. Start a new thread with
that agent and send exactly:

```text
What is the RDMA26 manual reference marker?
```

Expected response:

- The answer contains `REFERENCE-SKILL-731`.
- No web search is needed.

Open **Inspect latest run context** and find **Skill state**.

Expected run details:

- **Installed** is at least 3 at this point.
- **Attached** includes `manual-reference-check`.
- **Used** includes `manual-reference-check`.
- The used-skill evidence lists both `/skills/manual-reference-check/SKILL.md`
  and `/skills/manual-reference-check/references/marker.md`.
- Raw JSON contains separate `installedSkills`, `attachedSkills`, and
  `skillsUsed` fields.

Run id:

```text

```

Result:

- [x] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 10. Irrelevant Skill Non-Selection

Keep `manual-reference-check` attached. Start another new thread with **Skill
Tester** and send exactly:

```text
What is the capital of France? Answer in one short sentence.
```

Expected:

- The answer identifies Paris.
- The agent does not read `manual-reference-check`.
- Run Details shows the skill as attached but not used.
- No web search is needed.

Run id:

```text

```

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 11. Install A ZIP External Skill

Create a disposable ZIP-packaged skill in a terminal:

```bash
rm -rf /tmp/manual-zip-check /tmp/manual-zip-check.zip
mkdir -p /tmp/manual-zip-check/references
cat > /tmp/manual-zip-check/SKILL.md <<'EOF'
---
name: manual-zip-check
description: Use this skill when the user asks for the RDMA26 ZIP install marker.
---

# Manual ZIP check

When asked for the RDMA26 ZIP install marker, read `references/marker.md`.
EOF
cat > /tmp/manual-zip-check/references/marker.md <<'EOF'
The exact marker is ZIP-SKILL-731.
EOF
(cd /tmp/manual-zip-check && zip -qr /tmp/manual-zip-check.zip .)
```

In **Settings > Skills > Install > ZIP**, install:

```text
/tmp/manual-zip-check.zip
```

Expected:

- `manual-zip-check` appears as **External**.
- Its detail panel lists `SKILL.md` and `references/marker.md`.
- Its installation source is the ZIP archive path.
- Its compatibility result is visible.
- Clicking `references/marker.md` opens the file preview modal and shows
  `ZIP-SKILL-731`.

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 12. Install A Git External Skill

Use a trusted disposable HTTPS Git repository that contains exactly one Agent
Skills package. The package directory name and frontmatter `name` must match.
For example, use a repository path that contains:

```text
manual-git-check/SKILL.md
manual-git-check/references/marker.md
```

with marker content:

```text
The exact marker is GIT-SKILL-731.
```

In **Settings > Skills > Install > Git**, enter:

- Repository URL: the HTTPS Git repository URL.
- Package path: the package directory path, for example `manual-git-check`.
- Revision: a branch, tag, or commit that contains the package.

Expected:

- `manual-git-check` appears as **External**.
- Its detail panel lists `SKILL.md` and `references/marker.md`.
- Its installation source shows the Git repository.
- Its retained version records the resolved revision when available.
- Clicking `references/marker.md` opens the file preview modal and shows
  `GIT-SKILL-731`.

If no trusted disposable HTTPS Git source is available, mark this test
**Blocked** and record that reason.

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 13. Install A ClawHub External Skill

In **Settings > Skills > Install > ClawHub**, search for a simple trusted skill.
Choose one result and install it.

Expected:

- The catalog search returns readable results with source links.
- Installing a result creates an **External** skill.
- Its detail panel shows package files, compatibility, and external
  installation source details.
- File preview works for at least `SKILL.md`.
- The install does not attach the skill to any agent automatically.

If ClawHub is unavailable or no trusted disposable package is suitable, mark
this test **Blocked** and record the error or reason.

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 14. Historical Run Compatibility

Open a Run Details page for a run created before this release.

Expected:

- The page still loads.
- Missing installed or attached snapshots show an em dash and the message
  **Skill-state metadata was not recorded for this historical run**.
- Historical data is not misleadingly displayed as zero.

Run id:

```text

```

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 15. Agent Skill Authoring Proposal

Enable **Skill authoring** for **Skill Tester**. In a new thread, ask:

```text
Create a reusable skill that reviews a short meeting agenda for missing owner,
timebox, and expected outcome fields. Do not apply it; prepare it for my review.
```

Expected after rejecting the first proposal:

- The agent creates a pending authoring proposal rather than writing directly
  to the active library.
- The proposal appears in **Settings > Skills > Proposals**.
- Its evidence, files, compatibility, findings, and changes are inspectable.
- The proposed skill is not installed before explicit approval.
- Rejecting it changes its state without installing it.

Then ask for a second small skill proposal, review it, and choose **Apply
proposal**.

Expected after applying the second proposal:

- The confirmation is explicit.
- The proposal state becomes **Applied**.
- The new package appears as a user-owned installed skill.
- It is not attached to any agent automatically.
- It can be deleted through the normal unattached user-skill delete action.

Applied test skill id:

```text

```

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 16. Agent Skill Acquisition Boundary

Enable **Skill acquisition** for **Skill Tester**. Ask the agent to find an
existing calendar-related skill and prepare a suitable installation for review.

Expected:

- The agent searches installed skills and the configured trusted catalog.
- It can inspect and compare candidates.
- It creates an installation proposal when it finds a suitable package.
- It does not install, attach, grant capabilities, or execute package scripts by
  itself.
- Applying or rejecting the proposal remains an explicit authenticated user
  action.

If the external catalog is unavailable, mark this test **Blocked** and record
the error rather than treating catalog availability as a product failure.

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 17. Delete User And External Packages

Detach both test skills from **Skill Tester**.

1. Delete `manual-pricing-test` and confirm the dialog.
2. Delete `manual-reference-check` and confirm the dialog.
3. Delete `manual-zip-check` if it was installed.
4. Delete `manual-git-check` if it was installed.
5. Delete any ClawHub test skill if one was installed.
6. Reload the skill library.

Expected:

- All deleted test packages disappear from the installed library.
- The bundled `pricing-source-analysis` package remains unchanged.
- External installation records disappear with their external packages.
- Neither deleted skill remains available in the agent editor.

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## 18. Responsive And Error-State Check

Repeat a quick library inspection at a narrow mobile-sized browser width.

Expected:

- The library list, install controls, and selected skill details remain
  reachable by vertical scrolling.
- Text and buttons do not overlap or extend beyond the viewport.
- Clone, edit, save, cancel, and delete controls remain usable.
- A failed action displays a readable error without exposing local secrets.

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked

Notes:

```text

```

## Optional Automated Skill Evaluation

The repository also contains two live behavioral cases for relevant selection
and irrelevant non-selection. They currently require `OPENAI_API_KEY`:

```bash
./bin/rdma26 evals:run --suite skills --model gpt-5.4
```

Expected:

- `relevant-skill-selection` passes.
- `irrelevant-skill-non-selection` passes.
- The report includes used-skill assertions, token and cost data, maximum system
  prompt characters, and maximum attached-skill count.

Result:

- [ ] Pass
- [ ] Fail
- [ ] Blocked
- [ ] Not run

Report path:

```text

```

## Cleanup

- [ ] Both disposable skills have been deleted.
- [ ] The user skill applied during proposal testing has been deleted.
- [ ] The **Skill Tester** agent has been deleted.
- [ ] `/tmp/manual-reference-check` has been removed.
- [ ] No pending test proposal remains awaiting review.
- [ ] Any retained evaluation agents have been deleted.

Cleanup notes:

```text

```

## Release Decision

- [ ] Accepted
- [ ] Accepted with follow-up issues
- [ ] Not accepted

Open issues:

```text

```

Final notes:

```text

```
