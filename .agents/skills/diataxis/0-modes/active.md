# Active mode: documentation work you came to do

Triggered by deliberate prompting and guidance, or by a change that introduces user-facing behavior with no existing owner: a note, an idea, a diff, a feature, an audit finding, a goal, or a gap.
The work may be bounded by one feature or span a set; active chooses its own scope and does not compress to fit a commit.
Documents get written, split, migrated, and expanded deliberately.

Active work runs the same stages and roles as passive work.
What differs is entry and completeness: nothing here is compressed to fit a commit.

## Choosing the entry point

Assess what the input is, then pick the entry reference:

- **A note, idea, request, finding, bounded diff, or new user-facing feature:** [triage.md](../1-analysis/triage.md), triage role; then production and validation. A diff qualifies when it is cleanup, improvement, or new user-facing behavior. A diff that only invalidates existing documented text is passive. A new feature with no existing owner needs a new page.
- **Documentation that feels unclear, mixed, or wrong at set scale:** [audit.md](../1-analysis/audit.md), audit role; findings feed work, one priority at a time.
- **One mixed document (or a README doing everything):** [convert.md](../2-production/convert.md), convert role: tag and plan the split; then the per-target pipeline.
- **A new project, a reorganization, a documentation strategy:** [plan.md](../1-analysis/plan.md), plan role; for a reorganization, audit the current set first, then plan; active work executes the roadmap.
- **An audit report sitting open:** triage role on its priorities; then the per-finding pipeline.

Analysis decides what should happen; production makes it happen; validation checks the result.
Only production touches files, and only after analysis has chosen the targets.

## The pipeline

### 1. Analyze

Run the role from [1-analysis/](../1-analysis/) that the input calls for.
Its output determines the rest of the work: the facts extracted, the quadrants chosen, the owners found, and the targets named and primed.
When the input is not documentation, it also names where the input belongs and grants permission to write nothing.

Do not proceed to writing until the work plan is on paper; when the whole input is a mixed document, the convert role's tag-and-plan step produces it.

### 2. Produce

Run [2-production/](../2-production/) on each target.
Draft for content and structure only.
Voice and mechanics come later; doing both at once makes each harder to judge.
When several targets exist, prime all of them in analysis and finish the pages one by one; the work plan records the order.

### 3. Validate

Run [verify.md](../3-validation/verify.md), then [style.md](../3-validation/style.md), over exactly the written documents.
Verification first settles the facts; the style pass then shapes fact-final prose, so no correction invalidates a shaping.
Never run the two roles against the same words at the same time.
When the facts were already settled in analysis (a passive diff, a re-verified corpus), style may lead.

### 4. Record and close

Both roles pass before the commit; the work is done only then.
Long or multi-session work records its state (objective, done, next, open questions), so the next session resumes rather than restarts.
Migration work keeps a pointer in the replaced page until adopters switch over.

## Guardrails

- Classify before writing; analysis decides the target before prose starts.
- A fact has one owner. If more than one document owns it, the plan must merge or redirect.
- Expansion is planned work: each new page costs directories, links, and future drift. Name it, then make it.
- Migration moves authority: the migrated page takes the fact; the old page keeps a pointer until adopters finish switching over.
- Culling a sprawling README is multi-target work: assess it, then execute it.
- Ship small steps: an improvement published now beats a perfect page later.

## Output

- Work executed along the chosen entry: documents written in their quadrants or updates to existing owners, splits completed with the source retired, or a planned roadmap recorded.
- The lint checks clean on everything written.
- Verification passed on the written documents.
- A recorded plan showing what each fact's home is, what moved, and what is deliberately left open.
