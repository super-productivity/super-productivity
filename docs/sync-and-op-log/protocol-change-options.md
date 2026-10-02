# Sync protocol change: options after the stopping point

**Status:** draft for decision by @johannesjo (tracker
[#10393](https://github.com/super-productivity/super-productivity/issues/10393),
queue item 5). Nothing here is decided. Defaults are labelled as defaults.

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
improved (being fixed on `claude/sync-cleanup`).

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
from both lists. Coordinator's default (not yet decided): accept as
order-only, like #10381.

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

|                                         | (1) Readable opaque sides                                                                                                                                                                                                                    | (2) Per-field timestamps                                                                                                                                                                                                                                                                                                                                                                                                                      | (3) Server-side resolution                                                                                                         | (4) Accept the residue                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Idea**                                | A per-action extractor tells the resolver which fields each remaining opaque producer writes (habit count → `countOnDay`, `planTasksForToday` → `dueDay`/Today order, NOTE ops); conflicts resolve per field as TASK updates do since #10448 | Each field carries the timestamp of its last write, stored beside the entity and sent on the wire; every device applies a field write only if it is newer (a per-field LWW register)                                                                                                                                                                                                                                                          | The server picks winners per field                                                                                                 | Stop class fixes; fix only on user reports (rule 15) |
| **Fixes**                               | Snapshot losses on habit counts, note locks and content, #10421's class, most `field-reverted`/`field-unwritten`; not #10378's delta, not order                                                                                              | Field-level LWW classes, including #10437/#10438 shapes, by construction; not order, not additive time (#10378, #10380 task half: deltas are not registers)                                                                                                                                                                                                                                                                                   | In principle as (2)                                                                                                                | Nothing                                              |
| **Wire / schema**                       | None for the extractor (client logic over existing payloads); resolution rows are the existing `'patch'` shape. No bump                                                                                                                      | New optional envelope key per op (field timestamps) and a new persisted sidecar; optional + default (rule 11). No bump, but old clients' `'replace'` rows carry no timestamps, so new clients must treat them as "all fields at op time". Map fields (`timeSpentOnDay`, `countOnDay`) need per-key stamps. Wall-clock stamps alone would let a skewed clock beat a causally later write: causal order (vector clock or HLC) must decide first | Needs per-field metadata outside the E2EE payload, i.e. a plaintext channel (ADR #10 declines server entity versioning by default) | None                                                 |
| **Mixed fleet**                         | Converges on SuperSync (resolve-time); file providers unverified (two resolvers). Old resolvers keep losing                                                                                                                                  | Diverges until every device applies the same way: needs the floor; file providers cannot get one                                                                                                                                                                                                                                                                                                                                              | Server and file-provider paths resolve differently: two resolvers                                                                  | Unchanged                                            |
| **Floor (#10397) / v19.1.0, v18.15–21** | NOTE needs v19.1.0 gone (decision 4); habit and task producers do not                                                                                                                                                                        | Hard prerequisite: floor enforced and v19.1.0, v18.15–v18.21 gone; file providers need a format migration                                                                                                                                                                                                                                                                                                                                     | Floor plus a server rollout                                                                                                        | None                                                 |
| **Decisions 4 and 6**                   | Reverses 6 (opaque stays whole-entity) for the listed producers; 4 unchanged until v19.1.0 leaves                                                                                                                                            | Both become moot                                                                                                                                                                                                                                                                                                                                                                                                                              | Both moot on SuperSync only                                                                                                        | Both stay                                            |
| **Effort**                              | Medium: one extractor per producer (about 5), each with an E2E in both directions; per-action logic, which rule 12 discourages                                                                                                               | Large: persisted sidecar, compaction and snapshots carry it, `SYNC_IMPORT`/repair paths, migration, floor rollout                                                                                                                                                                                                                                                                                                                             | Large, plus server state and E2EE design                                                                                           | None                                                 |
| **Lets us delete**                      | Little: adds extractors; removes some pins' accepted trades                                                                                                                                                                                  | Field-patch machinery (`conflict-field-patch.util.ts`), decision 5a key reading, the superseded resolver's re-emission, the opaque/readable split, most accepted compare entries; only once file providers migrate too (D7's default keeps them on today's rules, so all of it stays until then)                                                                                                                                              | Little: the client path stays for file providers                                                                                   | Nothing                                              |

### Membership versus order (option 5, separate or combined)

`project.taskIds` and `project.noteIds` hold membership and order at once. A
child fact already exists (`task.projectId`, `note.projectId`). Deriving
membership from it and treating the list as order only, as `TODAY_TAG` does
(ARCHITECTURE-DECISIONS.md Decision #2), would:

- remove both rule 13 recreate exceptions (the recreate no longer re-lists);
- turn list conflicts into order conflicts, which a deterministic merge can
  resolve generically (kept order, unknown ids appended by a stable key), so
  the #10452 order-only difference and #10381's list half converge;
- not fix any field-level loss.

| Phase | What                                                                              | Mixed fleet                                                                                   | Floor                                             |
| ----- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 5a    | Selectors derive membership from `projectId`, list gives order; writers unchanged | Display only; data unchanged, so it converges. A new client may show a task an old one hides  | No                                                |
| 5b    | Order merge for list conflicts; stop treating a list as membership data           | Old clients still read lists as membership: writers must keep the lists complete (dual write) | Needed before writers stop maintaining membership |

About 60 write sites in about 12 files touch these lists (rough grep), most in
`project.reducer.ts` and `task-shared-crud.reducer.ts`.

## Recommendation (my defaults)

1. **Default: (4) now, (2) as the target, (5a) as the first step.** Stop
   class-by-class fixes; keep only user-reported or unreleased-regression
   fixes (rule 15). One exception: #10438 is permanent content divergence, so
   rule 15 admits a fix if `git tag --contains` shows its path released; its
   shape (a time-only local side needs no snapshot) is #10421's first proposed
   fix. (1) adds per-action logic that (2) would delete, and
   reverses decision 6 for a partial gain.
2. **Default: design (2) only after the version-spread numbers exist** and the
   floor is decided (#10397). Release N carries nothing for it.
3. **Default: (3) rejected.** E2EE and file providers keep the client
   resolver; the server would add a second one.
4. **Default: (5a) as a separate small PR** after release N, with an E2E that
   an order-only crossing converges; (5b) folded into (2)'s floor rollout.
5. **Default: accept the #10452 order-only difference** (coordinator's default).

## Decisions needed from @johannesjo

| #   | Question                                                                                     | My default                                                     |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D1  | Is the stopping point reached, i.e. no more class-by-class sync fixes without a user report? | Yes                                                            |
| D2  | Target protocol change                                                                       | (2) per-field timestamps, gated on the floor                   |
| D3  | Drop (1) and keep decision 6                                                                 | Yes, keep decision 6                                           |
| D4  | Reject (3)                                                                                   | Yes                                                            |
| D5  | Membership vs order: (5a) now as its own PR, (5b) with (2)                                   | Yes                                                            |
| D6  | Accept the #10452 order-only difference                                                      | Yes                                                            |
| D7  | File providers under (2): migrate their format, or keep them on today's rules                | Keep them on today's rules until a format migration is planned |
| D8  | #10438: fix it as the one class left for a fix, if its path is released                      | Yes, after the release check                                   |

## Missing evidence (optional before release N)

- Version spread per app version on SuperSync (#10397), to size the mixed-fleet
  window for (2) and (5b). v19.0–v19.1 send `appVersion` on downloads only.
- Release inclusion of #10437 and #10438 (`git tag --contains`).
- A per-seed split of `field-reverted`/`field-unwritten` by producer; the
  table above names the dominant fields only.
- An estimate of (2)'s persisted-size cost (one timestamp per written field).
