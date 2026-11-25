# Analysis: triage

Triage handles the input in front of you: a note, a diff, a request, a finding.
It answers *What does this want from us?* and produces a work plan with primed targets.
Follow the shared method ([method.md](method.md)).

Findings here are flags, not resolutions: a doubtful fact or a cross-note conflict is flagged for the verify pass, never checked against the code at intake.

## Plan the work and prime its targets

State the intent: what will the reader be able to do, find, or understand after this?
Then plan the work:

- Name the target files, one per quadrant that needs a home.
- Specify each target's scaffolding from its quadrant's template in [templates/](../templates/) (a starting point, not a form), so production's draft lands already shaped like a finished page of that quadrant (the contracts that govern it are in [contracts.md](../2-production/contracts.md)).
- Map the marked passages, facts, and links to their target and the place they will end. This is placement only; production writes the prose and later passes transform it.
- Name targets with the title conventions in [contracts.md](../2-production/contracts.md).

A whole document that mixes quadrants is the convert role's work ([convert.md](../2-production/convert.md)).
Convert tags the mix and plans the split; every extracted part goes to its quadrant owner, and the source keeps a pointer to the new location.

The work plan (shape below) is the contract between analysis and production.
In passive work it compresses to one line: the fact, its quadrant, its owner, the action.

```markdown
## Triage: [input]

Audience: [who]
Outcome: nothing to write (say where it belongs) / one document / several

| # | Fact | Quadrant | Target | Action |
| --- | --- | --- | --- | --- |
| 1 | [fact] | Reference | [path] | Update |
| 2 | [fact] | How-to | [path] | Create |
| 3 | [fact] | — | [where it belongs] | none |

Notes: [duplicates found, authority conflicts, migrations underway]
```
