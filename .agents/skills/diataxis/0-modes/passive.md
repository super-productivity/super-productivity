# Passive mode: documentation that rides a code change

Triggered by a code change that invalidates behavior an existing document describes.
The documentation change ships with that code change: one commit, one logical change.
This mode keeps documented facts current while code changes.
Agents and CI bring the work.

A change that introduces user-facing behavior belongs to active mode even when no existing page describes it.
A new feature is not passive maintenance.

Passive work runs the same stages and roles as active work, compressed to fit the trigger.
The modes differ in scope and ceremony and apply the same quality standard.

## When this is your mode

- One of these can show up in a diff or a commit, and documentation may mention the changed behavior in a way the change invalidates: a renamed setting, a changed default, a new command or shortcut, a changed data format, a corrected install path, or a removed feature.

A new user-facing feature is not this mode; see [active.md](active.md).

If the work is instead driven by a goal or a gap (content missing, a sprawling README, a page that belongs elsewhere), use active mode.
Passive work corrects and culls; it does not create a new owner.

## The route

### 1. Analyze the impact surface

List every documented surface the change touches; check each against the diff:

- **Reference pages:** settings, options, CLI flags, shortcuts, platform differences, data formats, error messages.
- **How-to guides:** procedures the change makes wrong, or steps it makes unnecessary.
- **Explanations and tutorials:** mental models or walkthroughs the change invalidates. A tutorial step that no longer works is a defect.
- **READMEs and landing pages:** overviews, quickstarts, landing-page instructions.
- **Contributor docs:** contributor behavior and configuration docs.

For each hit name the canonical owner of the affected fact.
If no existing surface is affected, check whether the change introduces user-facing behavior; if it does, stop: that is active work, not "no documentation impact."
If the change is purely internal, answer "no documentation impact" and do not invent edits.

Run the triage role ([triage.md](../1-analysis/triage.md)) when classification is not obvious.
Usually the classification is obvious: the output is one line (the fact, its quadrant, its owner, the action `Update`).
Flag, but do not fix, defects noticed in passing that are unrelated to the triggering change (other duplicates, mixed content, stale matter); they belong to active work.

### 2. Produce the smallest correct edit

Follow the production contracts ([contracts.md](../2-production/contracts.md)), then:

- Edit the canonical owner once. Replace wrong text; never append a correction beside the text it corrects.
- If the fact is copied in several places, fix the owner, then redirect or delete every stale copy in the same commit.
- Link out instead of restating. If fixing the fact requires a new section, a new page, or a restructure, stop: that is active work.

### 3. Verify the touched claims

Run the verify role ([verify.md](../3-validation/verify.md)) over the claims the edit touches or introduces.
An edit made in passing is where a misunderstanding of the code slips in; the scope stays proportionate: the smaller the edit, the smaller the check.
Apply corrections before styling the wording.

### 4. Style the touched files

Run the style role ([style.md](../3-validation/style.md)) over exactly the documents touched; the checkers themselves run over the tree.
Fix what this commit introduced or aggravated; report a pre-existing finding elsewhere.
Scope is the commit, not the corpus.

### 5. Ship atomically

- Documentation ships in the same commit as the code. No separate documentation pull request, no follow-up "docs to-do".
- Do not rename or move files during passive work. Migration is active work.

## Guardrails

- Replace the text instead of appending a correction; an appended correction leaves two versions of the fact in one document.
- Link to the owner instead of copying the fact; a second copy will go stale.
- Correct the fact without expanding the edit; the edit stays within the triggering change.
- A new feature is active work, not a correction; do not create its owner here.
- If the code does not deliver the behavior, report it as a code issue; do not document the aspiration.

## Output

- Canonical documents updated inside the code commit.
- Verification of the touched claims.
- A style pass leaving the QC checks clean on touched files.
- Optional notes on defects spotted in passing.
