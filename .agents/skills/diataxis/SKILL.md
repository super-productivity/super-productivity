---
name: diataxis
description: >
  Single entry point for public-facing documentation work: creating, updating,
  migrating, fixing, auditing, planning, and verifying docs organized by the
  Diátaxis framework's four quadrants (tutorials, how-to guides, reference,
  explanation).
  Covers passive documentation work (riding code changes and CI) and active
  documentation work (deliberate prompting or new user-facing features), with
  shared guidance so both modes handle documents identically. Routes to one mode entry, which pulls
  the stage references it needs. Use when documentation is to be created,
  changed, audited, planned, or verified.
---

# Diátaxis documentation skill

This skill is the entry point for a repository's public-facing documentation: the pages shipped to users, contributors, and integrators.
Internal working artifacts (plans, meeting notes, agent scratch) are outside its scope.
The guidance is layered so an agent loads only what it needs: two thin mode entries, three stages of work, and the underlying theory, loaded on demand.

## The compass

```text
            Practical           Theoretical
        +----------------+------------------+
Study   |   TUTORIALS    |   EXPLANATION    |
        |   (learning)   | (understanding)  |
        +----------------+------------------+
Work    |   HOW-TO       |   REFERENCE      |
        |   (problem)    |  (information)   |
        +----------------+------------------+
```

Classification is two questions, asked at the level of the fact or sentence:

- **Action or cognition?** Steps to take, or knowledge to hold? The answer lands on `how-to`/`tutorial` or `reference`/`explanation`.
- **Acquisition or application?** For study (learning), or for work (getting something done)? The answer lands on `tutorial`/`explanation` or `how-to`/`reference`.

The lowercase forms in backticks (`tutorial`, `how-to`, `reference`, `explanation`) are the quadrant keys: directory names, tags, and frontmatter.
Prose and tables use the display names: Tutorial, How-to guide, Reference, Explanation.

Two axes crossed yield exactly four quadrants.
Every document serves one quadrant; a section that serves two is mixed content and must be split or merged.
When a classification is contested, read [core.md](tenets/core.md): the compass is the decision tool for doubt.

Quadrant drift runs along neighbor pairs on the map: how-to ↔ tutorial, how-to ↔ reference, reference ↔ explanation, tutorial ↔ explanation.
Content tends to bleed into its neighbors.
Watch for it; split and link.

## Hard rules

- **One fact, one authoritative home.** Link to it; never copy it. A copy is a defect and a drift source. Source citations follow the quadrant rule: code footnotes for reference and explanation, neighbour links for tutorial and how-to. [verify.md](3-validation/verify.md) owns the forms.
- **One quadrant per document, one job.** Split or merge instead of mixing.
- **Not everything is documentation.** When an input belongs in code, tests, a generated reference, a comment, or a commit message rather than prose, say so and write nothing.
- **The lint checks own mechanics; you own voice.** Deterministic checkers judge the writing when the repo provides them; structure and voice are judgment. Configured checks bind even before their tools arrive: read the configuration first, and gather every constraint (configurations, style guide, patterns) before a rewrite, not after.
- **Run the deterministic checks in every stage.** Analysis takes a read-only baseline, production runs the fast loop on changed targets, and validation runs the full tree; [scripts/checks.sh](scripts/checks.sh) runs the QC checks. No stage reports clean tooling without executed output.
- **A documented change ships with its cause.** When a code change alters documented behavior, the doc update rides the same commit.
- **Expansion is a decision.** New pages, moves, splits, and migrations are planned work; they do not belong in a passive edit.

## Choose the mode

Both modes use the same craft.
Only the trigger differs.

- **Passive:** a code change invalidates behavior that an existing document describes; the correction rides that code change. Read [passive.md](0-modes/passive.md).
- **Active:** deliberate prompting and guidance, or a change that introduces user-facing behavior with no existing documentation owner. Read [active.md](0-modes/active.md).
- **No documentation impact:** the change is internal, or it neither invalidates an existing page nor introduces user-facing behavior. Say so and write nothing.

When the trigger does not say which, ask.
A change that only invalidates existing documented behavior is passive.
A change that adds user-facing behavior is active, even when it arrives as a code diff and even when the contributor did not ask for documentation.
"No documented surface" is not evidence of no impact; for a new feature it is the reason to create the owner.
A change that does both is active, because the new documentation set is the larger job.

## The work, in every mode

Every mode runs the same three stages, and every stage has the same roles:

| Stage      | Roles                    | What it does                            |
| ---------- | ------------------------ | --------------------------------------- |
| Analysis   | triage · audit · plan    | reads, classifies, decides; no edits    |
| Production | edit · create · convert  | creates or restructures pages           |
| Validation | verify · style           | checks and fixes in place; every mode   |

Stages are kinds of work that can feed one another.
Validation's fix loops re-enter the document; an audit report re-enters as triage; convert assesses its own source; a plan's roadmap is executed later as active work.

Validation is mandatory in every mode because both failure kinds occur: errors in understanding the code (verify catches them) and errors in understanding the documentation guidelines (style catches them).
Each role ignores the other's domain (style does not fact-check, verify does not restyle), so they never run against the same words at the same time.
They run in sequence, verification first when the prose is being reshaped, so the style pass shapes fact-final text.
Passive work checks with proportionate scope; active work checks in full.

## Deterministic tooling, in every stage

The five checks run in every stage.
Analysis runs [scripts/checks.sh](scripts/checks.sh) read-only over the input scope and records the baseline.
Production runs it after each target and fixes mechanical errors.
Validation runs it over the whole tree and records the final QC checks.
Rerun the script after any fix; a prior pass is not evidence for edited files.
A missing tool is recorded as not run, never treated as a pass.

## Where outputs live

The work produces artifacts: work plans, audit reports, conversion reports, kept findings.
Their default home is the conversation that triggered the work, which under automation means a PR/MR comment; their durable trace is the commit body.
Verbose artifacts (a full audit report, a conversion report) are posted where the adopting workflow collects them.

The skill also carries the toolkit's own page checks in [scripts/](scripts/): `frontmatter.py` and `visual.py`.
They are deterministic helpers, not reading material; run them through the commands in [scripts/README.md](scripts/README.md).

## Reference map

Every reference file is linked directly.
Load only what the current step needs.

**Modes**: how work arrives:

- [passive.md](0-modes/passive.md): documentation that rides a code change.
- [active.md](0-modes/active.md): documentation work you came to do.

**Analysis**: the reading stage:

- [method.md](1-analysis/method.md): the shared method: audience, facts, compass, homes, neighbors.
- [triage.md](1-analysis/triage.md): the input: work plan and primed targets.
- [audit.md](1-analysis/audit.md): the set: prioritized report.
- [plan.md](1-analysis/plan.md): the future: inventory and roadmap.

**Production**: the production stage:

- [contracts.md](2-production/contracts.md): the quadrant contracts, titles, frontmatter, and the Related block.
- [edit.md](2-production/edit.md): an existing owner becomes an edited page.
- [create.md](2-production/create.md): a gap becomes a new page.
- [convert.md](2-production/convert.md): a mixed document becomes quadrant-pure pages.

**Validation**: the checking stage:

- [style.md](3-validation/style.md): voice and the lint checks.
- [verify.md](3-validation/verify.md): facts against sources.

**Checks**: the deterministic tooling runner:

- [scripts/checks.sh](scripts/checks.sh): the command list; edit it to change the QC checks.

**Theory and shapes:**

- Tenets: [core.md](tenets/core.md), [tutorial.md](tenets/tutorial.md), [how-to.md](tenets/how-to.md), [reference.md](tenets/reference.md), [explanation.md](tenets/explanation.md).
- Templates: [tutorial](templates/tutorial-template.md), [how-to](templates/how-to-template.md), [reference](templates/reference-template.md), [explanation](templates/explanation-template.md).
- Voice: [PATTERNS.md](voice/PATTERNS.md). Start here. The [example-text/](voice/example-text/) corpus is for targeted grep, not reading.

## Load discipline

- Read one mode entry, then only the stage and role references the current step needs.
- Read and run [scripts/checks.sh](scripts/checks.sh) at the start of every stage; rerun it after edits.
- Tenets and templates exist so deeper material loads on demand, not by default.
  A routine edit needs none of them; a contested classification needs [core.md](tenets/core.md); a from-scratch page needs its quadrant contract, [templates/](templates/), and that quadrant's tenet file.
  A set-sized style pass is the exception.
  It loads the in-scope tenets and [voice/PATTERNS.md](voice/PATTERNS.md); it greps [voice/example-text/](voice/example-text/) for a matching passage only when a pattern needs more context ([style.md](3-validation/style.md)).
- Do not bulk-load every reference.
- If the adopting repo provides its own voice guide, exemplar corpus, or lint configuration, those outrank the defaults embedded in [style.md](3-validation/style.md).
