# Sync protocol change: options after the stopping point

**Status:** decisions D1–D8 recorded 2026-10-02 (tracker
[#10393](https://github.com/super-productivity/super-productivity/issues/10393),
queue item 5); see [Decisions](#decisions). The protocol target itself is
deferred until the option (6) spike reports.

**Why now.** The stopping point (decided 2026-10-01) says a protocol change is
indicated when a fix needs (A) a new wire key, (B) accepted newly failing
compare entries on original seeds, or (C) a second exception to a generic
rule. Measured on master `1620939` (2026-10-02), after #10448, #10443 and
#10452:

| Criterion            | Fired?             | Evidence                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (A) new wire key     | Yes, by the letter | #10452 added the optional `deleteNote.note` key. It was the mechanism @johannesjo chose, so its session judged (A) not to fire; the criterion asks whether a fix needed one, and it did.                                                                                                                                                        |
| (B) accepted entries | **Yes**            | #10448: 7 seeds; #10443: 11 entries on 7 seeds.                                                                                                                                                                                                                                                                                                 |
| (C) second exception | Arguably           | `contributor-sync-model.md` records one rule 13 exception, the NOTE recreate (#10452) re-listing in `project.noteIds`/`todayOrder`; the TASK recreate's `project.taskIds` re-list predates the rule and is its precedent. #10443 adds an admission (a pending note or habit order stays out of a conflict) beside #10364's. (B) alone suffices. |

So incremental fixes have reached the point where each one costs an accepted
trade or an exception. This note lists what is left, the options, and the
decisions needed.

## The residue (sweep on `1620939`)

`sync-fuzz-signature-report.benchmark.ts`, the standard 120 seeds (4 intent
mixes × 30, 30 steps, 3 devices), judged on original seeds. A seed counts once
per signature, so rows overlap.

| Family                                     | Seeds `00a8aaf` (2026-10-01) | Seeds `1620939` | Main source                                                                                                         |
| ------------------------------------------ | ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| any signature                              | 108                          | **106**         |                                                                                                                     |
| divergence (state differs between devices) | 75                           | 79              | mostly list order: `tag.taskIds` 40, `note.todayOrder` 25, `task.ids` 24, `project.taskIds` 20, `note.ids` 19       |
| time-loss                                  | 50                           | 44              | #10378, whole-entity snapshots, #10380 task half                                                                    |
| field-reverted (an edit's only write lost) | 43                           | 40              | opaque/whole-entity sides: `note.content` 10, `task.title` 9, `task.notes` 8, `habit.countOnDay` 7, `note.isLock` 6 |
| restart-changed                            | 22                           | 18              | #10381 (list order)                                                                                                 |
| older-write-won                            | 18                           | **5**           | see below                                                                                                           |
| stop                                       | 18                           | 12              | 10 remote habit order (kept stop, #10407); 2 local note order                                                       |
| today-notes                                | 16                           | 13              | NOTE whole-entity LWW skips Today order (#10379)                                                                    |
| field-unwritten                            | 14                           | 13              | whole-entity snapshots                                                                                              |
| recreated (accepted, decision 2)           | 6                            | 5               |                                                                                                                     |
| validation                                 | 3                            | 0               |                                                                                                                     |

`older-write-won` by class, each seed read on its original 30-step trace
(no new class; none is #10437 or #10422):

| Class  | Seeds                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| #10438 | `noReorder:20725003` (title; #10438's source seed), `tasks:20725017` (title, notes), `tasks:20725025` (notes)                                    |
| #10421 | `noReorder:20725019` (notes; close to #10438's per-op split), `tasks:20725009` (notes; a delta beside absolute writes still sent a full replace) |

In the three #10438 seeds the resolving device's `'replace'` row carries an
older value with a merged clock that dominates the newer write, so every other
device ends on the older value while the resolver keeps the newer one.

Pins: 56 of 57 pass; the one failure is the stale #10443 pin that #10452
improved; #10453 has since re-pinned it on master.

### Remaining loss classes

| Class                                             | Mechanism                                                                                                                                                                      | Seeds (signal)                                                          | Released                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------- |
| Opaque sides' whole-entity snapshots (decision 6) | An opaque op (habit count, `planTasksForToday`, a delta beside an absolute write) or a NOTE op wins a conflict with a full-entity `'replace'`, erasing the other side's fields | `field-reverted` 40, `field-unwritten` 13; habit counts 7, note locks 6 | yes                     |
| #10421 remaining class                            | An opaque local side wins with a snapshot read before the batch and reverts incoming edits                                                                                     | `older-write-won` 2                                                     | yes                     |
| #10437                                            | A later time delta made an older notes edit "newest"                                                                                                                           | 0 (fixed in effect by #10448)                                           | not checked             |
| #10438                                            | One batch resolves a task as both a local and a remote win; that device keeps a different title                                                                                | `older-write-won` 3, all with permanent `divergence`                    | not checked             |
| #10378                                            | A rejected `planTasksForToday` takes its time delta with it                                                                                                                    | `divergence:timeSpentOnDay.*` 4                                         | yes; v19.1.0 loses more |
| #10380 task half                                  | Delete vs a tracked delta recreates the task with the delta's arguments as fields, without the time                                                                            | `divergence:task.taskId/date/duration` 2, `recreated:time-loss` 4       | yes                     |
| Order only                                        | Lists that mix membership and order diverge in order (#10381 mechanism 1; habit adds; #10452's re-listed note, below)                                                          | `divergence:*Ids.*` up to 40                                            | yes                     |

**Order-only, new since #10452.** A device that reorders a project's notes and
pins the note keeps a re-listed note at its own position, while every other
device appends it. Permanent, order only; before #10452 the note was missing
from both lists. Accepted as order-only on 2026-10-02 ([#10393](https://github.com/super-productivity/super-productivity/issues/10393#issuecomment-5944061436)).
It heals on the next reorder of that list; only an order merge removes it,
not membership derivation.

## How resolution reaches the fleet

On SuperSync, the server detects conflicts from vector clocks, entity ids and
action type (concurrent time deltas pass; `conflict.ts`); it never resolves on
payload contents, and with E2EE it cannot. The server accepts the first of two
concurrent ops, so only the device holding the other one resolves: on download,
against its pending op, or after a rejected upload. It uploads resolution rows
(`'patch'` or `'replace'`); every other device applies them in server order.
Two consequences:

- **Resolve-time changes** (what the resolving device emits) converge in a
  mixed fleet on SuperSync: one device resolves, everyone applies its rows. An
  old client that resolves still loses data the old way. On file providers
  there is no referee, so both devices can resolve the same crossing; an old
  and a new resolver can then emit different rows, which the convergence
  contract (`conflict-journal-and-review.md`) forbids. Unverified, since the
  harness cannot run released clients (`lww-field-level-resolution.md`).
- **Apply-time changes** (how a device applies an incoming op, e.g. "skip a
  field whose stored timestamp is newer") diverge in a mixed fleet: old
  clients apply the whole op, new clients skip. They need every device on the
  new rule, i.e. the floor (#10397), and the floor cannot reach file providers
  (`client-version-floor.md` item 8).

Released clients drop unknown envelope keys and apply `'patch'` as
`updateOne`, `'replace'` as `setOne` (`lww-field-level-resolution.md`;
re-read on `v19.1.0`). They spread every key of `actionPayload` into the
entity, so new metadata must ride the envelope, never `actionPayload`, or old
clients persist it as entity fields.

## Options

|                                         | (1) Readable opaque sides                                                                                                                                                                                                                    | (2) Per-field timestamps                                                                                                                                                                                                                                                                                                                                                                                                                      | (3) Server-side resolution                                                                                                         | (4) Accept the residue                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Idea**                                | A per-action extractor tells the resolver which fields each remaining opaque producer writes (habit count → `countOnDay`, `planTasksForToday` → `dueDay`/Today order, NOTE ops); conflicts resolve per field as TASK updates do since #10448 | Each field carries the timestamp of its last write, stored beside the entity and sent on the wire; every device applies a field write only if it is newer (a per-field LWW register)                                                                                                                                                                                                                                                          | The server picks winners per field                                                                                                 | No new mechanism; fixes only as rule 15 admits them |
| **Fixes**                               | Snapshot losses on habit counts, note locks and content, #10421's class, most `field-reverted`/`field-unwritten`; not #10378's delta, not order                                                                                              | Field-level LWW classes, including #10437/#10438 shapes, by construction; not order, not additive time (#10378, #10380 task half: deltas are not registers)                                                                                                                                                                                                                                                                                   | In principle as (2)                                                                                                                | Nothing                                             |
| **Wire / schema**                       | None for the extractor (client logic over existing payloads); resolution rows are the existing `'patch'` shape. No bump                                                                                                                      | New optional envelope key per op (field timestamps) and a new persisted sidecar; optional + default (rule 11). No bump, but old clients' `'replace'` rows carry no timestamps, so new clients must treat them as "all fields at op time". Map fields (`timeSpentOnDay`, `countOnDay`) need per-key stamps. Wall-clock stamps alone would let a skewed clock beat a causally later write: causal order (vector clock or HLC) must decide first | Needs per-field metadata outside the E2EE payload, i.e. a plaintext channel (ADR #10 declines server entity versioning by default) | None                                                |
| **Mixed fleet**                         | Converges on SuperSync (resolve-time); file providers unverified (two resolvers). Old resolvers keep losing                                                                                                                                  | Diverges until every device applies the same way: needs the floor; file providers cannot get one                                                                                                                                                                                                                                                                                                                                              | Server and file-provider paths resolve differently: two resolvers                                                                  | Unchanged                                           |
| **Floor (#10397) / v19.1.0, v18.15–21** | NOTE needs v19.1.0 gone (decision 4); habit and task producers do not                                                                                                                                                                        | Hard prerequisite: floor enforced and v19.1.0, v18.15–v18.21 gone; file providers need a format migration                                                                                                                                                                                                                                                                                                                                     | Floor plus a server rollout                                                                                                        | None                                                |
| **Decisions 4 and 6**                   | Reverses 6 (opaque stays whole-entity) for the listed producers; 4 unchanged until v19.1.0 leaves                                                                                                                                            | Both become moot                                                                                                                                                                                                                                                                                                                                                                                                                              | Both moot on SuperSync only                                                                                                        | Both stay                                           |
| **Effort**                              | Medium: one extractor per producer (about 5), each with an E2E in both directions; per-action logic, which rule 12 discourages                                                                                                               | Large: persisted sidecar, compaction and snapshots carry it, `SYNC_IMPORT`/repair paths, migration, floor rollout                                                                                                                                                                                                                                                                                                                             | Large, plus server state and E2EE design                                                                                           | None                                                |
| **Lets us delete**                      | Little: adds extractors; removes some pins' accepted trades                                                                                                                                                                                  | Field-patch machinery (`conflict-field-patch.util.ts`), decision 5a key reading, the superseded resolver's re-emission, the opaque/readable split, most accepted compare entries; only once file providers migrate too (D7)                                                                                                                                                                                                                   | Little: the client path stays for file providers                                                                                   | Nothing                                             |

(1) and (2) are not true alternatives: to stamp a field, (2) must also know
which fields an opaque op writes, which is (1)'s extractor.

### (6) Derived field sets, extending the existing delta rebase (added after review)

| Aspect             | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idea**           | When resolving, learn which fields an op writes by applying its reducer to a copy of the root state and diffing the entity, instead of a hand-written per-action extractor; keep a local, never-synced per-field index of the latest write; resolve per field and emit today's `'patch'` rows. Time deltas extend the existing rebase (`keptLocalTimeDeltas`/`rebaseKeptTimeDeltas`, `conflict-field-patch.util.ts`) instead of losing to LWW. Since #10422 the rebase covers both directions for readable sides; whole-entity resolutions, #10378's included, still lose a local delta on a remote win (decision 7: local-win direction only, for now)           |
| **Fixes**          | The field-level residue of opaque TASK, PROJECT, TAG and habit producers (#10421, #10438's shape). Not NOTE while decision 4 holds (`note.content` 10 and `note.isLock` 6 seeds stay). The rebase extension targets #10378 and #10380's task half, which (2) does not fix                                                                                                                                                                                                                                                                                                                                                                                         |
| **Wire / schema**  | None: rows are the existing `'patch'` shape; the index is local (the `DB_VERSION` channel, ADR #8). No bump                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Mixed fleet**    | Converges on SuperSync, where one device resolves. On file providers it is worse than (1): the index is per device, so two resolvers of the same crossing can emit different rows. Old resolvers keep emitting `'replace'` rows with absolute `timeSpentOnDay`; a rebased delta after one can count time twice, so the rebase must not sit beside a `'replace'` row                                                                                                                                                                                                                                                                                               |
| **Floor**          | Not needed, except for NOTE (decision 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Decisions**      | Reverses 6 generically, not per action. If the index records fields written by incoming resolution rows, it uses them as merge input: that touches decision 5 and widens 5a, and needs its own decision                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Effort**         | Unknown until a spike. Reducers are not pure in the needed sense: they read device-local `todayStr`, fall back to `getDbDateStr()`, and stamp `Date.now()` into `modified`/`doneOn` (`task-shared-crud.reducer.ts`, `task.reducer.util.ts`, `task-shared-scheduling.reducer.ts`, `planner-shared.reducer.ts`). Meta-reducers such as `planTasksForToday` need the root state. A diff misses writes of an equal value, so the field set depends on the base state. On SuperSync the server lets a crossing pass only when both ops are `syncTimeSpent` (`conflict.ts`), so a delta against `planTasksForToday` is still rejected and must be rebased by the client |
| **Lets us delete** | Per-action opacity rules (`isOpaqueChangeOp`), most accepted compare entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Membership versus order (option M, formerly (5); design later)

`project.taskIds`, `project.noteIds` and `note.todayOrder` hold membership and
order at once. A child fact exists (`task.projectId`, `note.projectId`,
`note.isPinnedToToday`). Deriving membership from it and keeping the list as
order only, as `TODAY_TAG` does (ARCHITECTURE-DECISIONS.md Decision #2), only
helps together with an order merge:

- **Derivation alone does not converge order.** TODAY already derives
  membership from `dueDay` (`computeOrderedTaskIdsForToday`,
  `work-context.selectors.ts`), yet its stored order is the largest divergence
  signature: all 40 `tag.taskIds` seeds are TODAY (the harness has no other
  tag). Convergence comes only from a deterministic order merge (kept order,
  unknown ids appended by a stable key), which also removes #10452's
  order-only difference.
- **Derivation is not display-only.** Tasks have no backlog flag, so a derived
  member needs a `taskIds` vs `backlogTaskIds` rule. `moveItemAfterAnchor`
  (`work-context-meta.helper.ts`) does nothing when the moved item is in the
  stored list but the anchor exists only in the derived one. More than 100
  code lines across about 34 files read or write the stored lists, and the
  plugin API exposes `taskIds`, `backlogTaskIds` and `noteIds`.
- **The rule 13 recreate exceptions stay** while released clients read the
  lists ("Existing lists stay", `contributor-sync-model.md`).
- Data repair already treats `projectId` as the authority
  (`_addOrphanedTasksToProjectLists`, `data-repair.ts`).

## Recommendation

This is the combined recommendation of two review subagents, as given to
@johannesjo in the design-note session on 2026-10-02. It replaces the
defaults first posted on #10393 (comment 5944338767).

1. Apply rule 15 as written; no blanket stop. Next fixes, each with an E2E
   first in both directions: **#10378** (tracked time lost on default
   settings; time loss is the second-largest family, 44 seeds) and **#10438**
   (permanent divergence).
2. Do not commit to (2). Spike (6) first: it fixes the field-level residue
   without a wire key or a floor, which (2) cannot offer file providers. If
   (2) is chosen later, use hybrid logical clocks, not wall clocks.
3. Keep decision 6 until the spike reports; drop only the per-action form of
   (1).
4. Reject (3).
5. Design membership derivation together with the order merge (option M);
   no separate derivation PR.
6. Plan the file-provider format alongside any apply-time change. A partial
   lever exists: clients from v18.14.0 with split sync off pause on the
   split-file tombstone (`file-based-sync-format.ts`). Not covered: clients
   older than v18.14.0, and split-on readers meeting a newer split version.
   Released ones (v19.1.0) treat it as recoverable corruption and restore
   from `.bak`, so by code reading their next upload can overwrite the newer
   file; only master since #10255 (unreleased) refuses it (`isRemoteNewer`).
7. #10438's fix shape: one decision per entity per batch, or #10421's
   post-batch field patch. Not "a time-only side needs no snapshot": on the
   resolving device the local side is a rename.

## Decisions

@johannesjo answered the recommendation above on 2026-10-02 in the
design-note session: "Do as recommend". D6 was decided earlier the same day
("Please spin up two sub agents on the decisions and do as they recommend",
[#10393](https://github.com/super-productivity/super-productivity/issues/10393#issuecomment-5944061436)).

| #   | Question                                  | Decided                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Stop class-by-class fixes?                | No blanket stop: rule 15 as written. #10378 and #10438 are next                                                                                                                                                                                                                                                                       |
| D2  | Target protocol change                    | Not (2) yet: spike (6) first, then decide. If (2) is chosen later, HLC stamps                                                                                                                                                                                                                                                         |
| D3  | Option (1) and decision 6                 | Keep decision 6 for now; drop only the per-action extractors                                                                                                                                                                                                                                                                          |
| D4  | Server-side resolution (3)                | Rejected (E2EE, file providers, ADR #10)                                                                                                                                                                                                                                                                                              |
| D5  | Membership vs order                       | No separate derivation PR; design membership with the order merge (option M)                                                                                                                                                                                                                                                          |
| D6  | #10452's order-only difference            | Accepted (decided earlier, see above)                                                                                                                                                                                                                                                                                                 |
| D7  | File providers under an apply-time change | Plan their format change alongside it (the tombstone lever is partial, see recommendation 6)                                                                                                                                                                                                                                          |
| D8  | #10438                                    | Fix it, in the shape of recommendation 7. Released status is unknown (#10438 says its per-op resolution and pre-batch snapshot predate #10432). Rule 15 admits a fix either way: as permanent divergence if released, or, if introduced after v19.1.0, as a forward fix, since reverting #10415/#10432 would bring back #10379/#10260 |

This reverses the 2026-10-01 tracker line "#10437 and #10438: stopping-point
evidence, with no separate fixes" for #10438. Not decided here, and needed
before the (6) spike lands: whether its index may record fields written by
incoming resolution rows (decisions 5 and 5a). Also open: D1 asks for
#10378's E2E in both directions, but decision 7 keeps a whole-entity remote
win dropping the losing device's delta; the #10378 fix needs that revisited or
its scope limited to the local-win direction.

## Missing evidence

- Version spread per app version on SuperSync (#10397), to size the mixed-fleet
  window for any apply-time change. v19.0–v19.1 send `appVersion` on
  downloads only.
- Whether v19.1.0 shows #10438 (diverges or only reverts the field).
- A per-seed split of `field-reverted`/`field-unwritten` by producer.
- The (6) spike: field sets for meta-reducers, map fields and equal-value
  writes, the rebase next to `'replace'` rows, and two file-provider
  resolvers of one crossing.
