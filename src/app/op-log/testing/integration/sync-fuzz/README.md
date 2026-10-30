# Sync fuzz preservation oracle

The runner checks convergence, restart stability and preservation separately.
A converged outcome can still lose content. This is test infrastructure: it
changes no persisted model, operation payload, provider or production resolver.

## Ledger contract

`executeIntent` records supplied creation values (task/habit titles, note
content, context pinning and Today scheduling) and edits. It does not turn all
model defaults into user writes. Starting a done/unscheduled task records the
implicit `isDone` and `dueDay` writes immediately after their own dispatches.
`FuzzWrite.time` overrides the intent's final op time for those early writes;
subsequent time deltas and context-session ops must not advance their edit time.
Archiving records the due-date clears that `ArchiveService` applies to its
archived snapshot; these are intentional writes, not scheduling losses. Two
concurrent archives retain both clears rather than excusing one another as
losing edits.

A project task's initial unscheduled `dueDay` is `isBaseline: true`: a known
value a whole-entity winner may carry, not a preservation obligation by itself.
Once an actual due-day write exists, the ordinary field oracle compares it with
that baseline and still reports an unexplained older value. Imported field values likewise remain known baselines that a whole-entity
winner can carry. Creation/import baselines are not a license to accept
arbitrary content or to ignore an isolated later edit.

`lost-entity:<type>` now requires existence when:

- There is a retained intent or replacement entity and no retained delete.
- An explicit creation/restore is causally after every retained delete.
- Exactly one plain edit and one delete are concurrent, the edit wins their
  original timestamp/client-id comparison, and every other intent on that
  entity belongs to both sides' causal past. This isolates a two-device
  crossing without simulating subsequent resolution operations.

A causal **creation** starts a new lifetime: preceding field/time obligations
and imported baseline content can reset to defaults. A **restore** carries an
archived snapshot and does not excuse earlier content wholesale. Legitimate
delete absence and concurrent archive precedence remain accepted. Archived
tasks count as present. Import and USE_REMOTE filtering still run before these
checks, so intentional replacement can discard old/concurrent work, while
retained post-import creations/edits remain checked.

## Boundaries and classifications

Missing entities after multi-device or multiple-round delete conflicts remain
unclassified unless a causal recreation proves existence. The oracle is not a
second conflict resolver and does not promise global per-field LWW. The existing
latest-field model retains its documented pairwise/whole-entity approximations
in `Ledger.crossing` and `checkLatestWrite`; concurrent NOTE fields and opaque habit counts
still have whole-entity semantics. A NOTE crossing accepts either side's snapshot
only when its last visible field write accounts for the value: a creation/import
baseline both sides overwrote cannot excuse complete content loss. A delete's
side cannot supply a surviving snapshot. With no concurrent intent on a note,
its latest field write is checked even when the old value is a supplied baseline.
Note reorders are not indexed by entity in the ledger, so only a reorder
concurrent with the latest edit conservatively excludes this check; a completed
historical reorder does not excuse losing a later isolated edit. The reorder
intent stores context and move indices, not affected note IDs, so even an
unrelated concurrent reorder remains a bounded gap in this check.

Recording creation values can change a lost-edit signature from
`field-reverted`/`field-unwritten` to `older-write-won`, or explain an older
baseline carried by a valid whole-entity winner. It does not erase a convergence
failure. The three `remote-win-keeps-local-edit` pins retain their divergence
signatures even though the winner's baseline field is now accounted for.

The oracle specs include deliberately corrupted **real harness outcomes**:
missing winning notes and lost note content in both upload orders, content
loss after completed project/Today reorders, corrupted supplied creation
values, lost implicit scheduling, lost retained post-import creations/edits,
and a missing causal recreation. Unit controls cover legitimate delete absence,
archive precedence, original-time comparison and ambiguous delete crossings.
The baseline-carry controls also reject values no intent supplied.

## Verification

Run the focused suite with:

```sh
npm run test:file -- 'src/app/op-log/testing/integration/sync-fuzz/*.spec.ts'
```

For a comparison, run `sync-fuzz-signature-report.benchmark.ts` on the old and
new oracle with the same profiles/seeds, or use `npm run sync-fuzz:compare`.
CI runs that comparison against the base on PRs that touch client sync code
(`Sync Fuzz Compare` in `e2e-sync-pr.yml`, informational).
The report benchmark deliberately calls `fail()` to export its JSON; its
nonzero exit is expected and is **not** a passing test suite. Compare original
executed steps and values before classifying changed signatures. The standard
report reads device C's live state, so it cannot certify every device/archive.
Do not use a shrunk trace to clear a newly failing original seed.
