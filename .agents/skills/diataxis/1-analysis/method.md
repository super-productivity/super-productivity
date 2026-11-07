# Analysis: the shared method

The analysis stage reads the current state, classifies it with the compass, and decides what work belongs where.
Its three roles (triage, audit, plan) differ only in what is being examined; none of them edits documents.
Their output defines what production does next.

## The shared method

### 0. Run the tooling baseline

Run the deterministic QC checks in [scripts/checks.sh](../scripts/checks.sh) before classifying.
Record the exact command, scope, exit status, and findings in the analysis artifact.
Do not fix those findings; the baseline is evidence for the plan, not a correction.
A missing checker is recorded as not run, never inferred.

### 1. Name the audience

Who is this material for: a newcomer learning, a daily user working, a contributor, an agent?
Audience drives quadrant and voice.
Facts usually imply the audience; ask only when ambiguous.

### 2. Extract the facts

List the discrete facts or questions the material carries.
Work at the level of the fact, not the paragraph: a paragraph can carry two facts that live in two different quadrants.

### 3. Classify each fact with the compass

Two questions per fact: action or cognition?
Acquisition (study) or application (work)?

| Action or cognition | Acquisition or application | Quadrant     |
| ------------------- | -------------------------- | ------------ |
| Action              | Acquisition                | Tutorial     |
| Action              | Application                | How-to guide |
| Cognition           | Application                | Reference    |
| Cognition           | Acquisition                | Explanation  |

Confirm against the plain questions: does it teach a flow from start to end? solve one named problem? state something to look up? explain why it works this way?
When a classification is contested, stop and read [core.md](../tenets/core.md).
Content can seem to be doing one thing while a doubt lingers; the compass is the tool for that doubt and requires reconsideration rather than assumption.
The per-quadrant specifications are [tutorial.md](../tenets/tutorial.md), [how-to.md](../tenets/how-to.md), [reference.md](../tenets/reference.md), [explanation.md](../tenets/explanation.md).

Classification produces whatever the input needs: nothing at all, one document, or several pages, each single-quadrant.
Do not force inputs into a count; decide fact by fact and let the shape emerge.

A fact that fits two answers is drifting; split it and link.
A fact that fits none belongs elsewhere: in code, tests, a generated reference, a comment, a commit message.
Saying where it belongs is a valid result of analysis.

### 4. Find the homes

For each fact, first search for a document that already owns it.
Authority hierarchy when sources disagree:

1. Code and tests: behavior is what the implementation does.
2. Generated reference: output derived from code, authoritative for the API surface it covers.
3. Canonical prose: main documentation pages, package READMEs.
4. Dated notes and plans: supporting material, never authoritative.

An existing owner means **update it**; no owner means **create one**.
Two owners means the plan must merge or redirect them.

### 5. Judge the neighbors

Quadrant drift runs along neighbor pairs: how-to into tutorial, reference into explanation most commonly, all four pairings eventually.
Watch for it whenever reading: mixed content is the most common documentation defect.
Duplication adds maintenance work.
Both are analysis findings.

## Guardrails

- Classify before writing; analysis chooses the homes before production writes.
- A fact has one owner; a document has one quadrant. Enforce both in the plan, not in the prose after it.
- Prefer merging a duplicate into its owner over rewriting both copies.
- Zero documents is a valid result; record where the facts belong.
- **Mark, do not check.** Analysis extracts and places claims; checking them against sources is the verify pass's job, over the written page. A suspicion raised here (a doubtful claim, a conflict with another note) travels as a flag, not as a resolved correction. Running the deterministic tooling is a mechanical baseline, not claim verification.
