# SECTION and Content Reorder Conflict Replay Contract

**Status:** Active sync-correctness contract.

This document owns the narrow exceptions that preserve SECTION and content
reorder semantics when a server rejects a concurrent local operation. The executable
owners are:

- `src/app/op-log/sync/section-conflict-commutativity.util.ts`
- `src/app/op-log/sync/reorder-conflict.util.ts`
- `src/app/op-log/sync/superseded-operation-resolver.service.ts`
- `src/app/op-log/sync/superseded-operation-resolver.service.spec.ts`
- `e2e/tests/sync/supersync-section-convergence.spec.ts`
- `src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts`
- `e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts`

## Why generic entity LWW is insufficient

SECTION actions encode ordered relationships across a section and its Project
or Tag work context. Replacing a rejected move, removal, or reorder with a
snapshot of one entity loses reducer semantics: a task can remain in two
containers, disappear from both, or converge with different ordering on each
client.

The resolver may therefore replay a rejected SECTION intent instead of
collapsing it into a generic entity snapshot. This is a deliberately narrow
exception, not permission to replay arbitrary rejected actions.

Note, habit and board reorders also carry list writes that an entity snapshot
cannot represent. When one crosses a supported content edit, both intents must
survive. Applying the remote action alone does not resolve the server's rejection
of the pending local clock.

## Admission contract

Only these action families are candidates:

- `SECTION_UPDATE_ORDER`
- `SECTION_ADD_TASK`
- `SECTION_REMOVE_TASK`
- `NOTE_UPDATE_ORDER`, `COUNTER_UPDATE_ORDER`, `BOARDS_SORT`
- `NOTE_UPDATE`, `COUNTER_SET_TODAY`, `BOARDS_UPDATE`, `SECTION_UPDATE`

Replay is admitted only when all of the following hold:

1. The rejected operation has an existing entity frontier concurrent with its clock.
2. Exactly one retained operation matches the affected entity/clock frontier.
3. That retained row is an applied, synced, non-rejected remote operation.
4. `areCommutingSectionOperations()` or
   `areCommutingReorderAndContentOperations()` recognizes the exact pair.
5. Operation metadata exactly matches the action payload used to make the
   decision.

The recognized crossings are intentionally limited to:

- a move and removal of the same task from the move's source section;
- a section-order update crossing a placement/removal that touches one of the
  ordered sections;
- a project or Today note reorder crossing a content/modified edit;
- a habit reorder crossing a day's count update;
- a board reorder crossing an identity-preserving board configuration update; and
- a section reorder crossing a title edit.

Note pinning/moving, habit configuration changes and competing reorders are not
recognized as commuting content crossings. Missing, ambiguous, malformed or
non-commuting evidence does not admit replay. Recognized content reorders
(including section reorders) and `COUNTER_SET_TODAY` then remain pending with
`UnsupportedMultiEntityConflictError`: generic entity LWW loses list writes or
the habit's type. Other actions retain their existing fallback. Never broaden
recognition merely because two actions appear harmless in one fixture.

## State-based projection

An admitted intent is projected against one stable NgRx snapshot whose state is
fully represented by durable operations. There is no `await` between the
phantom-change check and snapshot read; the operation-log lock keeps later user
actions behind the recovery transaction.

`projectSectionReplayAgainstState()` returns one of four outcomes:

- **replay:** create a replacement operation using current ordering and anchors;
- **work-context-state:** create the exact Project/Tag state compensation needed
  to preserve work-context ordering;
- **superseded:** the current durable state already makes the intent obsolete,
  so reject the stale predecessor without a replacement; or
- **blocked:** the transition cannot be represented safely; recognized reorders
  stop with the safety error, while other SECTION actions retain generic LWW.

`projectReorderConflictAgainstState()` reuses SECTION projection for section
orders. For other admitted reorders it carries the current owner list. Habit
orders retain only the original IDs still present, preserving unlisted slots
and avoiding conflicts with disabled habits absent from the original drag.
Content replacements carry only the originally changed fields with their
current values. These replacements are local no-ops and remain idempotent when
hydration also replays rejected originals.

Replacement ordering is scoped by owner list, work-context task order or content
action/entity (and day for habit counts).
Replacements use a merged, incremented clock that dominates the rejected and
retained frontiers. The client must not prune that clock before the server
performs conflict detection.

The resolver appends all replacement/compensation operations and rejects their
stale predecessors in one operation-log transaction. A crash must not expose
only one half of the recovery.

## Released-client compatibility

Clients in the v18.4.0-v18.4.3 compatibility window understand schema-4 SECTION
removals but ignore later work-context anchor fields. A semantic removal is
therefore paired with a complete Project/Tag LWW replacement when needed, which
their existing reducer can apply to converge task ordering.

Do not use a schema bump as a substitute for this compensation. Any change to
the replacement payload must be checked against the released-fleet rules in
[`operation-log-architecture.md`](./operation-log-architecture.md#bump-policy--a-bump-does-not-protect-the-released-fleet).

Content reorder recovery reuses existing action payloads without a schema or
persisted-model change. Its E2E covers both note resolution histories consumed
by unmodified v19.1.0. Older clients that resolve first retain their original
safety gate; see the [S2 validation report](../plans/2026-09-26-sync-S2-result.md)
for released-asset provenance and the tested limits.

## Verification

Run the focused unit suite:

```bash
npm run test:file src/app/op-log/sync/superseded-operation-resolver.service.spec.ts
```

Run the real-client convergence scenario through the scheduled SuperSync E2E
workflow, or locally when the dedicated server environment is available:

```bash
npm run e2e:file e2e/tests/sync/supersync-section-convergence.spec.ts -- --retries=0
```

The E2E must continue to prove concurrent move, removal, reorder, and dependent
placements converge and survive restart.
