# Analysis: audit

Audit covers a documentation set.
It answers *Where are we weak, mixed, duplicated, stale?* and produces a prioritized report that feeds the active mode one priority at a time.
Follow the shared method ([method.md](method.md)).

Audit a set you already know needs attention (a remediation, a request, an established problem set).
When nothing is known to need attention, prefer the small thing in front of you.
The report ranks; it does not correct: claim checks here exist to order the work, and each fix, its source check, and its citation happen once, in the per-target pipeline.

## Steps

1. **Inventory.** Read every file in scope. Record per file: path, apparent quadrant, length, structure.
2. **Classify.** Classify each document and each mixed section with the shared method ([method.md](method.md)); record intended versus actual. Every document is either single-quadrant or flagged mixed with extraction targets.
3. **Red flags.** Check each document against its quadrant's anti-patterns:
   - *Tutorials that* explain concepts before action, offer choices, assume prior knowledge, or don't build to a concrete, testable result.
   - *How-tos that* teach from scratch, explain theory instead of giving directions, hide the goal, or allow only one rigid path.
   - *Reference that* embeds instructions, converses, is inconsistent or incomplete in coverage, or carries opinions and recommendations.
   - *Explanations that* are bare fact lists, include procedures, don't connect to the why, or lack historical context and perspective.
4. **Check the contract.** For each correctly classified page, check it against its quadrant contract ([contracts.md](../2-production/contracts.md)) and tenet. Record `meets contract`, `drifts`, or `incomplete`; name the gap. The Quality column carries this structural judgment, not a general taste score and not a fact check.
5. **Gaps.** Note missing quadrants and what absence costs: no tutorials (new users have no guided path); no how-tos (common problems lack directions); no reference (facts have no look-up home); no explanation (the rationale has no home).
6. **Duplication and authority.** Find the same fact in more than one document. The hierarchy in [method.md](method.md) names the owner; every other copy is a defect. Flag documents that disagree, or that restate a fact owned by code or generated reference.
7. **Staleness.** Flag dated plans, completed work left in place, claims a change has invalidated.
8. **Cross-links.** Check every page's Related block against [contracts.md](../2-production/contracts.md). The links must point to the correct neighbour quadrants and serve the reader's next step; missing or wrong links are findings.
9. **Prioritize.** Rank by user impact and drift risk: wrong facts and duplication first, then mixed content, then contract gaps (including cross-linking), then gaps, then staleness.

## Report

```markdown
# Diátaxis Audit Report: [scope]

## Summary
| Document | Intended Quadrant | Actual Quadrant(s) | Quality | Issues |
| --- | --- | --- | --- | --- |

Quality is `meets contract`, `drifts`, or `incomplete`.

## Mixed Content
- [file]: lines N-M — [quadrant] mixed into [quadrant] → extract to [location]

## Gaps
- [quadrant]: [missing owner and impact]

## Duplication
- [fact]: owned by [canonical file]; also in [files] → merge or redirect

## Cross-linking
- [file]: [missing or wrong link] → [expected neighbour or purpose]

## Priority Actions
1. [highest impact]
```

Every finding cites the document, section, and line range; a vague finding is not actionable.
Every document is classified as one quadrant or flagged mixed.
