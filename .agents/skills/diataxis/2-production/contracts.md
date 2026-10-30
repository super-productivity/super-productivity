# Production: the quadrant contracts

Production turns assessed material into documents that hold one quadrant and cross-link their neighbors.
Converting, creating, and editing are roles of one craft applied at different starting points; all three follow the contracts below, and all three end in the validation stage.

Targets arrive primed from the analysis stage: quadrant, path, facts, and links already on paper, scaffolding specified from [templates/](../templates/).
Production scaffolds the file and moves the content in.
The one exception is convert: entered directly for a mixed document, it assesses its own source; tagging the mix and planning the split are its first steps.
If what you hold is raw and unassessed anywhere else, go back one step.

## From plan to draft

- Start with the quadrant's patterns in [voice/PATTERNS.md](../voice/PATTERNS.md). When a pattern needs a concrete shape, grep the exemplar corpus for the matching passage and copy its structure (headings, banners, opener shape, paragraph flow, list-versus-prose choices, checkpoint placement), never its content. Do not read whole exemplar pages. Use the corpus for structure and [style.md](../3-validation/style.md) for voice; write the content.
- Draft against the constraints that will judge the page: checker configurations and their limits (line and table widths, frontmatter), the style guide, the patterns. A draft written ahead of them is rework.
- Draft against the quadrant contract below. Contracts are strict so structure and intent stay resilient under later editing.
- The templates are starting points, not forms: keep the sections that serve the page, add or drop the rest, and never populate a section that has nothing to say. Diátaxis prescribes no page formula; the content decides the final shape.
- Every contract compresses the theory in [tenets/](../tenets/). For a from-scratch page read the quadrant's tenet file as well.
- Periodically re-run the compass on your own paragraphs: action or cognition, study or application. Drift accumulates between sections.

## Tooling fast loop

After each target, run [scripts/checks.sh](../scripts/checks.sh).
Fix every error introduced or aggravated by the draft, including frontmatter and visual entities.
Record the command, scope, exit status, findings, and fixes in the production handoff.
Rerun the full set after a repair.
Do not run the voice pass, correct facts, or claim validation; those belong to the validation stage.

## The quadrant contract

Every page opens with the quadrant banner shown in its template and carries the frontmatter block below.

### Tutorial: a lesson, not a task

Theory: [tutorial.md](../tenets/tutorial.md).
Template: [tutorial-template.md](../templates/tutorial-template.md).

- Open by stating the artifact and its scope; state objectives and prerequisites. Prerequisites name the fallback for the reader who doesn't have the thing.
- Give the learner one action per step, a visible result after each. Quote prompts when the reader must not walk past one.
- Minimize explanation: it is linked, not embedded.
- Offer no choices or alternatives: one safe path, bound to one deployment route.
- Show the way out: cleanup closes the lesson; troubleshooting sits at the step where failure happens.
- A tutorial must work for its intended reader without a teacher present.
- Title: the destination the learner reaches.

### How-to: directions from the reader's goal

Theory: [how-to.md](../tenets/how-to.md).
Template: [how-to-template.md](../templates/how-to-template.md).

- Open with outcomes and the single prerequisite.
- Allow forks and multiple entry points: real-world problems are not linear.
- Steps carry one action each and say which environment each command runs against; document the migration from commands-to-config when it exists.
- Put the minimum theory immediately ahead of the example that exercises it.
- Verification shows the literal output, not reassurance. State the boundary between lookalike things. Troubleshooting sits at the point of failure.
- Title: `How to [accomplish this specific goal]`.

### Reference: facts, complete and exact

Theory: [reference.md](../tenets/reference.md).
Template: [reference-template.md](../templates/reference-template.md).

- Open with the contract: what this documents, what it covers and does not. Give the syntax before the tokens; put options in tables, defaults in the table not in adjectives.
- State type, default, and behavior per option. Cover the edge cases and precedence, tersely. State per-system differences as system differences, not as exceptions.
- Mirror the structure of the thing documented, not the author's reading order.
- No instruction, no opinion, no procedures: link out for how-to and rationale.
- Illustrative examples allowed; none of them explain. Flag a missing section as a definite gap.
- Title: the name of the thing.

### Explanation: the why, bounded to a topic

Theory: [explanation.md](../tenets/explanation.md).
Template: [explanation-template.md](../templates/explanation-template.md).

- Start from the system's starting problem or context, not a feature list. Compare alternatives in one table or paragraph; state trade-offs in plain sentences.
- Define any new objects or ideas before the system relies on them. Bound each claim in the paragraph that states it. State what the reader does differently because of it.
- Stay bounded to the topic: explanation absorbs everything around it, so check each paragraph for scope.
- No procedural steps, no instruction: link out.
- Title: carries an implicit `About`/`With respect to [concept]`.

## Required frontmatter

Every public page opens with this frontmatter block:

```yaml
---
title: [the page's display title]
type: [tutorial | how-to | reference | explanation]
domain: [project or subpackage slug]
---
```

- `type` must match the page's quadrant directory; pages directly under the docs root use `type: index`.
- `domain` groups pages when a project ships several logical divisions (subpackages, products); one slug per division.
- The deterministic frontmatter check enforces the block and the directory match.

## Close: the Related block

The cross-link matrix, so readers can travel the map:

| From        | Link out to                                                                |
| ----------- | -------------------------------------------------------------------------- |
| Tutorial    | how-to guides (next tasks), reference (details), explanation (concepts)    |
| How-to      | tutorials for background, reference for details, explanation for rationale |
| Reference   | tutorials (guided introduction), how-to (usage), explanation (background)  |
| Explanation | tutorials (hands-on), how-to (application), reference (facts)              |

Add a `## Related` section at the end of every page: few links, correct destinations, each named for its purpose.
Every page gets one.
Related links serve the reader's next step.
Source citations are a different concern: they follow [verify.md](../3-validation/verify.md)'s quadrant rule, with code footnotes for reference and explanation and inline neighbour links for tutorial and how-to.

## Guardrails

- Update the owner instead of adding a page whose fact already lives somewhere else.
- Voice polish and the lint checks belong to the validation stage, and so do fact corrections and their citations ([verify.md](../3-validation/verify.md)). This stage's work is semantics and structure.
- Watch for neighbor drift. If a paragraph belongs to another quadrant, move it into the cross-link.
