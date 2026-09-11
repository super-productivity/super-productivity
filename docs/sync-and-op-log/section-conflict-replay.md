# SECTION Conflict Replay Contract

**Status:** Active sync-correctness contract.

This document owns the narrow exception that preserves SECTION reducer
semantics when a server rejects a concurrent local operation. The executable
owners are:

- `src/app/op-log/sync/section-conflict-commutativity.util.ts`
- `src/app/op-log/sync/superseded-operation-resolver.service.ts`
- `src/app/op-log/sync/superseded-operation-resolver.service.spec.ts`
- `e2e/tests/sync/supersync-section-convergence.spec.ts`

## Why generic entity LWW is insufficient

SECTION actions encode ordered relationships across a section and its Project
or Tag work context. Replacing a rejected move, removal, or reorder with a
snapshot of one entity loses reducer semantics: a task can remain in two
containers, disappear from both, or converge with different ordering on each
client.

The resolver may therefore replay a rejected SECTION intent instead of
collapsing it into a generic entity snapshot. This is a deliberately narrow
exception, not permission to replay arbitrary rejected actions.

## Admission contract

Only these action families are candidates:

- `SECTION_UPDATE_ORDER`
- `SECTION_ADD_TASK`
- `SECTION_REMOVE_TASK`

Replay is admitted only when all of the following hold:

1. The rejected operation has an existing entity frontier.
2. Exactly one retained operation matches the affected entity/clock frontier.
3. That retained row is an applied, synced, non-rejected remote operation.
4. `areCommutingSectionOperations()` recognizes the exact pair.
5. Operation metadata exactly matches the action payload used to make the
   decision.

The recognized crossings are intentionally limited to:

- a move and removal of the same task from the move's source section; and
- a section-order update crossing a placement/removal that touches one of the
  ordered sections.

Missing, ambiguous, malformed, or non-commuting evidence keeps the generic LWW
fallback. Never broaden recognition merely because two actions appear harmless
in one fixture.

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
- **blocked:** the transition cannot be represented safely, so keep the generic
  LWW fallback.

Replacement ordering is scoped by section order or work-context task order.
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
