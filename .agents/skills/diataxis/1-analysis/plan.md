# Analysis: plan

Plan defines future documentation.
It answers *What should exist, where, in what order?* and produces an inventory, a layout, and a roadmap.
Follow the shared method ([method.md](method.md)).

Design how documentation should be organized before it is written in bulk.
The plan writes no pages and checks no claims.
It is a candidate list that steers the next steps and changes as pages land.

## Steps

1. **Understand the project.** For a reorganization, start from the current-state audit ([audit.md](audit.md)); if none exists, run the audit first. Read its entry points (README, agent instructions, existing docs) for what the product does, who the audiences are, and how complex the system is.
2. **Identify needs per quadrant.** Tutorials: getting-started experience, workflows needing guided learning, onboarding paths. How-tos: common tasks, configuration, troubleshooting, integrations. Reference: API surface, configuration options, CLI commands, data formats, error codes. Explanation: architecture and decisions, mental models, trade-offs.
3. **Propose the layout.** One quadrant per directory keeps drift visible:

```text
docs/public/
├── tutorials/    [lesson name].md
├── how-to/       [verb]-[noun].md
├── reference/    [subject].md
└── explanation/  [concept].md
```

   File names are suggestions, not rules: `how-to/[verb]-[noun]` and `explanation/[concept]` are clear; tutorial and reference names can vary more, and the directory assigns the quadrant. Adapt to project conventions; small sets may flatten. The plan covers all four quadrants (even if some are deferred); deferring a quadrant is a decision. The tree never carries empty structure; a quadrant directory appears with its first page.
4. **Set the priority order.** Default: tutorial first (fastest value, validates the system), then reference (essential, partially automatable), then how-tos (grown from user questions), then explanation (needs mature understanding). Adjust to user needs, dependencies, and worth-per-effort, never to completeness for its own sake.
5. **Design navigation.** Every document links its neighbors (matrix in [contracts.md](../2-production/contracts.md)); a landing page links into all four quadrants.
6. **Road-map it.** A phased candidate list that active work executes over sessions.

## Report

```markdown
# Documentation Plan: [Project Name]

## Audiences
| Audience | Needs | Primary Quadrants |
| --- | --- | --- |

## Proposed Documents
### Tutorials
- [ ] `getting-started.md` — [description] — P1
### How-to Guides
- [ ] `[verb]-[noun].md` — [description] — P1
### Reference
- [ ] `api.md` — [description] — P1
### Explanation
- [ ] `[concept].md` — [description] — P2

## Directory Structure
[layout]

## Deferred
- [quadrant]: [reason]

## Roadmap
### Phase 1 — Essential   [documents and rationale]
### Phase 2 — Important   [documents and rationale]
### Phase 3 — Later       [documents and rationale]
```

The roadmap ranks candidates.
Write a page when the need is clear, and treat the phases as priorities, not deadlines.

## Plan checks

- Each candidate is single-quadrant and has a named path.
- Each candidate has a named owner or an explicit create decision.
- Priority follows need, effort, and dependency, not completeness.
- Deferred quadrants are recorded with a reason.
- The plan writes no pages and checks no claims.
