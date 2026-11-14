# Production: create

Create handles a gap rather than a source.
It answers *What does a fresh page here look like?* and produces a new page.

## Entry contract

- The target is primed from triage with quadrant, path, facts, and links ([triage.md](../1-analysis/triage.md)).
- No existing page owns the fact; if one does, use [edit.md](edit.md).
- The fact belongs in prose, not code, tests, generated reference, or a commit message.
- If the target is raw or unassessed, go back to triage.
- If the compass and [core.md](../tenets/core.md) still leave the quadrant contested, ask; do not force a quadrant.

Read the source, tests, and specs enough to write accurately; flag doubts for [verify.md](../3-validation/verify.md), and do not resolve facts here.

Creation order matters:

1. **Tutorial:** fastest value for new users, validates the system works, reveals friction.
2. **Reference:** most straightforward to generate, essential for all projects, partially automatable.
3. **How-to:** grows from user questions; let support traffic suggest them.
4. **Explanation:** needs mature understanding; improves with experience.

Scaffold from [templates/](../templates/) (a starting shape), write against the contract in [contracts.md](contracts.md), cross-link.

## Handoff

- The frontmatter matches the template and the directory.
- The banner and title follow the quadrant contract.
- The Related block has correct destinations.
- Open claims are flagged for [verify.md](../3-validation/verify.md); citations belong to the validation stage.
- The production checker fast loop ran, and its findings are recorded.
- No template section is empty.
