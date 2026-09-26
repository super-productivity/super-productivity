# Sync Architecture Review: Why Every Fix Is Expensive

**Status:** Proposal for discussion — nothing here is accepted. Revised after
an adversarial review. · **Date:** 2026-09-26
**Baseline commit:** `6169df9e9` (`origin/master`)
**Question:** Did the sync architecture go in the wrong direction? Could we throw
away half of it?
**Scope:** client op-log (`src/app/op-log/`), `packages/sync-core`,
`packages/sync-providers`, `packages/shared-schema`, `packages/super-sync-server`,
sync UI (`src/app/imex/sync/`), and the sync-facing meta-reducers.

## 1. Verdict

Mostly no — with one important exception, and no big-bang rewrite.

- **Sound, keep:** the op-log itself (persistent actions captured into a
  durable log, snapshot plus tail replay, provider adapters), vector clocks
  (ADR #10), end-to-end encryption, the providers, and the server's
  auth/quota/transport work. Most of that code would exist under any design.
- **The recurring cost:** operations are replayed **intents** whose reducers
  write many entities, but conflicts are detected and resolved **per declared
  entity**. 64 of the 132 persistent actions write outside the key that conflict
  detection sees (§2.5), mostly **denormalized relationship lists**
  (`project.taskIds`, tag and Today lists, `planner.days`, `section.taskIds`,
  `subTaskIds`, `project.noteIds`). Every such action that can meet a concurrent
  edit needs hand-written compensation, or it stops sync. This is the largest
  single root cause in the fix history (about a fifth of fix lines) and the only
  one that repeatedly wedged users. It was amplified by answering each audit
  finding with per-action compensation.
- **What to do:**
  1. Stop adding per-action compensation.
  2. Delete the dead code.
  3. Remove the generator at its source: stop treating denormalized lists as
     something conflict resolution must protect. Derive **membership** from the
     child's own field — the pattern the Today tag already uses (ADR #2) — and
     keep the stored arrays only as tolerant **order** hints. List-compensation
     code can then be retired list by list, with no wire change and no schema
     bump.
  4. Only then decide whether the convergence model itself must change. If it
     must, per-field LWW on captured effects fits this fleet;
     rebase-on-a-total-order does not (§4).
- **Half?** Not by deletion. About **2.3k** production lines can go
  unconditionally now; another **~6–8k** need a decision each (§5, Phase 1).
  Phase 2 would retire list and relationship compensation over time; its
  size is being measured (§5, Phase 2). That adds up to roughly a quarter to a third of
  the client op-log, plus a larger share of the ~27k lines of conflict unit
  tests — not half, and not in one go.

## 2. Evidence

Production lines are non-spec `.ts` (plus `.html` where noted), measured at
`6169df9e9`; the method is in Appendix A. Treat categorisations as approximate.

### 2.1 Size and growth

| Area                                                      | Production lines | Test lines |
| --------------------------------------------------------- | ---------------: | ---------: |
| `src/app/op-log/` (excluding `testing/`)                  |           50,145 |   ~125,000 |
| `packages/sync-core` + `sync-providers` + `shared-schema` |           13,246 |     14,186 |
| `packages/super-sync-server/src`                          |           13,856 |    ~45,800 |
| `src/app/imex/sync/` (`.ts` + `.html`)                    |            9,315 |     13,261 |

- The client op-log alone is about twice the whole tasks feature
  (`src/app/features/tasks/`, 23,709 lines) and about a fifth of all production
  TypeScript in `src/app/`.
- Five of the eight services grandfathered over the 1,200-line service cap in
  `eslint.config.js` are sync services: `conflict-resolution` (4,817),
  `file-based-sync-adapter` (3,356), `operation-log-store` (3,212),
  `operation-log-sync` (2,704) and `sync-wrapper` (2,085).

Growth of `src/app/op-log/` on the mainline (first-parent snapshot before
`<date>T00:00:00Z`, excluding specs and `testing/`):

| Date  | 2026-01-15 |  03-01 |  05-01 | 06-01\* |  07-01 |  08-01 |  09-01 | baseline |
| ----- | ---------: | -----: | -----: | ------: | -----: | -----: | -----: | -------: |
| Lines |     23,665 | 28,817 | 30,315 |  26,773 | 30,347 | 46,215 | 48,253 |   50,145 |

\* The May extraction of sync-core/sync-providers moved code into `packages/`
(+10.1k lines there).

`conflict-resolution.service.ts` grew from 1,104 lines (2026-07-01) to 4,144
(07-21) and 4,825 (08-16). The two weeks of 2026-07-06 to 07-20 added
~17.8k production lines across the sync folders — about a third of all growth
since the op-log merge. Most of the conflict service's July growth landed
between 07-13 and 07-16 (#8980, #8990, #9007, #9048, #9086), an audit-driven
burst.

### 2.2 Where the fix lines went

689 fix commits touched the sync folders (`src/app/op-log`, the four sync
packages, `src/app/root-store/meta`, `src/app/imex/sync`) between the op-log
merge (2026-01-11) and the baseline. Each was given one primary root cause
(regex rules plus a manual read of all subjects and the ~60 largest diffs):

| Root cause                                                    | Fixes | Net prod lines | Test lines added |
| ------------------------------------------------------------- | ----: | -------------: | ---------------: |
| **Multi-entity / intent conflict resolution**                 |    51 |     **+7,437** |      **+23,900** |
| Client persistence, hydration, compaction, crash atomicity    |    37 |         +3,750 |          +10,467 |
| SuperSync server (61 of these are deploy/monitoring, 0 lines) |   136 |         +3,680 |          +17,987 |
| Full-state ops: imports, clean slate, first sync, USE_REMOTE  |    47 |         +3,467 |          +10,799 |
| File-provider consistency (ETag, `.bak`, split files, gaps)   |    38 |         +2,466 |           +7,075 |
| Encryption                                                    |    58 |         +2,397 |           +5,334 |
| Schema, migration, legacy data                                |    36 |         +1,915 |           +2,736 |
| Provider auth, transport, platform                            |    59 |         +1,738 |           +3,498 |
| Everything else (replay determinism, orchestration, UI, …)    |   227 |         +7,881 |          +24,665 |
| **Total**                                                     |   689 |    **+34,731** |     **+106,461** |

- Fixes are 62% of all sync growth since the merge (features 25%).
- The largest category is about a fifth of fix lines. Its rules also catch some
  generic LWW work (e.g. #9035, #9054), so treat +7.4k as an upper bound. About
  80 of the 689 commits are not sync-specific (build, types, task logic in
  `root-store/meta`).
- Commits that _shrank_ sync code removed ~5.8k lines in total, against ~62k
  added by commits that grew it.
- Of the 45 largest fixes (+16.3k lines), 27 (+10.9k) came from audit findings
  and hardening passes, 11 (+4.0k) from user reports, 7 unclear.

### 2.3 Anatomy of the conflict engine

About 62% (~3,000 lines) of `conflict-resolution.service.ts` is compensation
for multi-entity writes rather than generic LWW (method ranges, ±10%):

| Part                                                                                                                                                                               |                       ≈ Lines |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------: |
| Generic LWW core: detection, frontier, op factory, persist/apply                                                                                                                   |                         1,430 |
| One multi-entity op, per-entity winners: mixed-winner compensation, the fail-closed gate, Today/planner re-placement, `roundTimeSpentForDay` splitting, narrowed bulk replacements |       1,130 (+451 in helpers) |
| Delete/archive vs update: cascades, recreating deleted entities and relationships, delete-wins, restore                                                                            |                         1,390 |
| Field merge layered on whole-entity LWW: disjoint-field merge, #9073 arrival-order crossings                                                                                       |             460 (+417 helper) |
| Commuting exemptions (sections, time deltas)                                                                                                                                       | 25 (+~850 in section helpers) |
| Other (E2EE footprint auth, banner/journal hooks, dead helpers)                                                                                                                    |                           345 |

The same compensation leaks into `lww-update.meta-reducer.ts` (1,017 lines, of
which ~380–435 rebuild project/tag/Today/parent relationships that the
original action's reducer would have maintained) and
`bulk-archive-filter.util.ts` (strips archived ids from tag/project LWW
payloads).

### 2.4 The class keeps coming back

- **Fail closed:** 26 action creators declare several entity ids; only 10 have
  a resolution path in `_assertMultiEntityPlansAreSafe`
  (`conflict-resolution.service.ts:2532`). The rest throw
  `UnsupportedMultiEntityConflictError` when they meet a concurrent edit, which
  stops sync until the user replaces all data on one side.
- **Users hit it repeatedly,** each time through another action: #9405 and
  #9426 (Today planning), #9537 (End-of-day archive), #9601
  (`roundTimeSpentForDay`), #9768 and #10102 (`moveToArchive`, again after the
  earlier fixes). Each fix extended an allowlist or added a resolution path.
- **The gate was a policy choice:** it generalised one reproduced corruption
  (#8944, which shipped with a reproducing spec) to every multi-entity action,
  turning a silent risk into user-visible wedges and seven follow-up fixes.
- **The reorder actions are next** — reproduced in this review (§6).
- **Decisions already made around the same cause:** ADR #5 (an atomic
  `completeProject` needed ~1,565 lines of conflict machinery and was
  reverted), ADR #7 (the delete-wins marker exists because an entity-level LWW
  cannot undo the `deleteProject` cascade), the disjoint-field merge (#9095),
  section commutativity, and the #9073 crossing logic.

### 2.5 Declared versus written, measured

Every persistent action creator was compared twice. First against its
**declared key**, the one `getOpEntityIds` hands to conflict detection. Then
against its **written set**: every feature reducer, handler map and meta-reducer
that handles it, with owned lists counted as writes to their owner:

| Class                                                          | Actions | Share |
| -------------------------------------------------------------- | ------: | ----: |
| (a) writes only its declared key                               |      65 |   49% |
| (b) also writes other ids of the same type (parents, siblings) |      13 |   10% |
| (c) writes other entity types or slices                        |      51 |   39% |
| special (archive-only `ALL` ops, one dead action)              |       3 |    2% |
| **Total**                                                      | **132** |       |

- **Undeclared targets of the 51 class (c) actions:**

  | Target                              | Actions |
  | ----------------------------------- | ------: |
  | Project lists                       |      26 |
  | Tag lists, including Today ordering |      23 |
  | Sections                            |      14 |
  | Tasks written from non-task keys    |      12 |
  | Planner days                        |      10 |
  | Menu tree                           |       4 |
  | Time tracking                       |       3 |
  | Repeat configs                      |       3 |
  | Issue providers                     |       3 |

- **By declared type:** 37 of the 47 TASK-declared actions write beyond their
  key; `deleteProject` writes 9 slices plus the IndexedDB archive.
- **Declared key never written at all (20 actions):**
  - the nine `[Project] Move Task…` backlog moves declare the task but write
    only the project's lists — so two concurrent moves of different tasks in one
    backlog never conflict, while an unrelated edit of the moved task does;
  - the Today and planner moves;
  - subtask reorders, which declare the subtask but write its parent.
- **Write sets that no declaration could capture:** for 13 actions the write
  set depends on the receiving device's state (all-project/all-tag scans,
  subtasks derived from state), so it is unknowable at capture time.
- **Payload snapshots:** 27 actions carry captured lists of other entities
  (`allTaskIds`, task trees, id maps).
- **The code already says so:** `tag.effects.ts:241` repairs TODAY_TAG because
  of "state divergence caused by per-entity conflict resolution during sync".

## 3. Root causes

### 3.1 Intent ops, entity-level convergence (primary)

Consequences of §2.5:

1. A conflict on one declared entity keeps or rejects the whole op, so the op's
   effects on other entities are rebuilt by hand (`lww-update.meta-reducer.ts`,
   compensation ops) — or the resolver fails closed.
2. Conflicts fire on entities an op does not touch (`updateNoteOrder` against a
   note content edit, §6) and are missed on entities it does touch (its
   write to `project.noteIds`).
3. Ops whose declared ids do not overlap are applied local-first on each device,
   so two devices apply the same concurrent pair in different orders.
   Replicated operations converge only when concurrent operations commute, and
   list-rewriting reducers do not. The code says so at
   `conflict-resolution.service.ts:4452` (#9073): a blind apply "would let
   ARRIVAL ORDER decide the winner … and permanently diverge".

Most undeclared writes maintain **denormalized lists that duplicate a fact the
child already stores**:

| List                     | Child-side field            | Membership derivable today?       |
| ------------------------ | --------------------------- | --------------------------------- |
| `TODAY_TAG.taskIds`      | `task.dueDay`/`dueWithTime` | yes — already derived (ADR #2)    |
| `planner.days[day]`      | `task.dueDay`               | yes                               |
| `project.taskIds`        | `task.projectId`            | yes, except backlog placement     |
| `tag.taskIds`            | `task.tagIds`               | yes                               |
| `parent.subTaskIds`      | `task.parentId`             | yes                               |
| `project.noteIds`        | `note.projectId`            | yes                               |
| `project.backlogTaskIds` | none                        | no — needs an optional task field |
| `section.taskIds`        | none (no `task.sectionId`)  | no — needs an optional task field |

Two facts stored in two places, updated by different ops and resolved by
per-entity LWW, disagree after a concurrent edit. Most of the compensation code
restores their agreement after the fact.

### 3.2 Live state versus the log (persistence)

Reducers run before an op is durable, and snapshots (`state_cache.current`,
compaction) are copied from live NgRx state rather than derived from the log. A
stack of guards exists only to prove that live state equals a log prefix:
#8469, #8751, #9084, #9140, #9438, the deferred-action buffer and cooldowns.
The persistence review also counted 9 client-side snapshot mechanisms and 6
separate "replace the whole state" paths, each with its own transaction,
validation and recovery-point policy, and 12 bespoke transaction variants in
`operation-log-store.service.ts` (estimates, Appendix B).

### 3.3 Repair is a synced full-state op

`REPAIR` is uploaded like an import. That needed a causal sub-protocol
(`repairBaseServerSeq`, stale-repair rebase, incoming-repair deferral) and
produced #9773 (an incoming repair opened the import dialog and could discard
local work) and the deferred-repair livelock fixed in PR #9795. The whole-state
healers it runs (`data-repair.ts` 1,601 lines, `is-related-model-data-valid.ts`,
`auto-fix-typia-errors.ts`) predate the op-log; they were built for whole-file
sync.

### 3.4 Partial server emulation on file storage (secondary)

File providers emulate a cursor, retention and compare-and-swap, but not
piggybacked ops, per-op acceptance or full-state op identity. Each missing
property surfaced later as a bug fixed with a local guard (the #10119 / #10226 /
#10239 / #10256 family). Two file formats are live (v2 single file, opt-in v3
split), so several fixes exist twice and have drifted (retry de-duplication
exists only in v3). The file-specific code is ~4.7k lines in total (its fixes
added +2.5k of that since January) — real, but smaller than §3.1, and unifying
the provider paths would not shrink the conflict engine.

### 3.5 Process: generalised hardening

Audit findings are not low-yield — triage rule 5 records several that were
real, and this review leans on #9073. The expensive pattern was generalising a
finding into a blanket policy, for example the fail-closed gate (§2.4), and
answering each follow-up with per-action compensation. The rules added in
`CLAUDE.md` ("hardening needs an observed instance"; an E2E reproduction for
every sync fix, `6169df9e9`) address this.

## 4. Options for the convergence model

### 4.1 Why not a total order plus rebase

`operation-log-architecture.md` rejects server-assigned ordering because it
"requires server connectivity for ordering — incompatible with offline-first
and file-based providers". That reason is weak: offline edits need a position
only once they upload, and they could be rebased then. The first draft of this
review proposed exactly that — replay pending local intents on top of the
server's order. The adversarial review found the stronger reason it does not fit
here:

- **Intent replay converges only if every device runs identical,
  deterministic reducers.** There is no desktop auto-updater, so released
  clients stay for years (ADR #8). Counterexample:
  1. Released client R adds note _c_; `addNote` prepends it to
     `project.noteIds`.
  2. A newer client N has a pending reorder to `[a, b]`.
  3. In server order, replaying N's reorder (`noteIds: ids` verbatim) drops _c_
     from the list on every device.
  4. If newer reducers "fix" that, R still applies the old reducer and diverges
     permanently. No conflict is detected and no resolution op is produced.
- **Consequence:** any reducer fix becomes a wire change for released clients
  (sync rule 10). There is precedent: `enrichDeleteProjectAction` (`7e273a0e5`,
  v18.15.0) already made `deleteProject` replay depend on the app version.
- **Synced reducers are not deterministic today:** `nanoid()` in
  `boards.reducer.ts:114` and `task-batch-update.reducer.ts:117`; `Date.now()`
  in `task-shared-crud.reducer.ts:342/631/930` and `task.reducer.util.ts:162`.
- **File providers have no clean per-op order.** Compare-and-swap writes make
  file writes linear in the common case only: `sv` is optional on legacy ops,
  the adapter itself notes that rev checks can be "fooled (caching / rev reuse /
  eventual consistency)", and LocalFile/weak-ETag WebDAV have no CAS.
- **It would reverse ADR #10** (one conflict system, clocks client-owned) and
  two invariants in `operation-log-architecture.md` ("classify concurrent
  independent edits before overwriting them", "prefer false-concurrency over
  false-ordering").
- **It would make delete win for every entity type.** A replayed edit of a
  missing entity is a no-op; ADR #7 chose delete-wins deliberately and only
  for projects.

The rebase design and the rest of its review findings are kept in Appendix C
for the day the fleet can be updated.

### 4.2 Options compared

|                       | A. Status quo + discipline                         | B. Normalize relationship lists                                   | C. Per-field LWW on captured effects                                             | D. Total order + rebase                      |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| What an op is         | intent                                             | intent                                                            | field patch, declared = written by construction                                  | intent                                       |
| Convergence           | per-entity LWW; arrival order for undetected pairs | as A, but list divergence no longer changes visible state         | per-field, order-independent                                                     | total order + identical reducers             |
| Same-field conflict   | newest timestamp                                   | newest timestamp                                                  | newest timestamp per field (close to today; the disjoint merge becomes the rule) | last to reach the server                     |
| Released clients      | unchanged                                          | keep reading and writing the arrays (dual-write)                  | already apply `LwwUpdatePayload` patch ops (#9101)                               | diverge on any reducer difference            |
| Providers             | all                                                | all                                                               | all, including LocalFile                                                         | SuperSync and CAS file providers only        |
| Wire or schema change | none                                               | none (additive optional fields for backlog/sections)              | new producer on an existing envelope; per-field timestamps stored locally        | none on the wire; rule-10 risk in reducers   |
| Hard part             | the class stays open-ended                         | backlog/section membership; derivation cost; tolerant order merge | cascades and tombstones; diff cost; op volume for bulk actions                   | see §4.1                                     |
| Removes               | Phase 1 only                                       | list/relationship compensation, list by list                      | most per-entity compensation and the fail-closed gate                            | most compensation, but keeps LWW as fallback |

### 4.3 Recommendation

- **Do A and B.** They are incremental, reversible, need no wire change, and
  B removes the main generator for current clients.
- **Revisit C only if B stalls.** Decide with the Phase 3 desk audit, not
  up front.
- **Keep D parked** until a desktop auto-updater exists (ADR #8's "When to
  update" condition) or SuperSync becomes the only backend (ADR #10's).

Neither A, B nor C changes ADR #10 or the invariants of
`operation-log-architecture.md`.

## 5. Plan

### Phase 0 — Stop the generator (contributor rules, no code)

Proposed for the maintainer to adopt or reject; this plan does not edit
`CLAUDE.md`:

1. No new per-action special case in `ConflictResolutionService`. Fix a
   multi-entity conflict bug in the data shape (Phase 2) or in the action. The
   existing size ratchet on the file stays; a fix that must add lines removes
   more elsewhere in the conflict area.
2. A new action that would write another entity's denormalized list writes
   the child's own field instead and lets membership be derived. Sync rule 3
   (multi-entity change = meta-reducer) is unchanged for true multi-entity
   changes.
3. No UI action may fall into the fail-closed path. A new multi-entity action
   names its conflict resolution path in its PR.

### Phase 1 — Delete what is dead, dormant or duplicated

**Unconditional (~2.3k lines):**

| Item                                                                                                                                                               | ≈ Lines | Evidence                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------: | ----------------------------------------------------------------------------------------------------------------- |
| `src/app/pfapi/**/*.js` (compiled legacy JS, 4 files)                                                                                                              |   1,777 | imported nowhere (grep)                                                                                           |
| Concurrent-snapshot auto-merge branch (`_tryConcurrentSnapshotMerge`)                                                                                              |     110 | `AUTO_MERGE_CONCURRENT_SNAPSHOT: false` is a constant (`packages/sync-providers/src/file-based-sync-data.ts:224`) |
| `listFiles` in six providers                                                                                                                                       |     150 | no production caller                                                                                              |
| Uncalled store methods (`clearFullStateOps`, `clearUnsyncedOps`, `filterNewOps`, `loadStateCacheBackup`, `incrementCompactionCounter`; `appendBatch` is test-only) |    ~200 | no production callers                                                                                             |
| Test-only private helpers in `conflict-resolution.service.ts` (`_deepEqual`, `_extractEntityFromPayload`, `_extractUpdateChanges`)                                 |      35 | only reached from specs via `as any`                                                                              |
| Dead entry points `ProjectService.updateOrder`, `TagService.updateOrder`, `SimpleCounterService.updateAll`                                                         |      15 | no callers (the actions and reducers stay: old ops still replay)                                                  |

**Needs a decision (~6–8k lines):**

| Item                                                        | ≈ Lines                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conflict journal + review UI/page/banner                    | ~1,800                              | Every journal write sits behind a flag that is off at the only caller (`remote-ops-processing.service.ts:516`). The freeze (#9061, `71a9a4338`) and the feature (`962c5bbeb`) first shipped together in v18.15.0, so no stable release wrote journal rows — only master/internal-track builds from 2026-07-11 to 07-16 could have (this corrects the premise banner of `2026-07-13-sync-simplification-plan.md`). Drop, or keep a one-off export. |
| `_syncVectorClockToPfapi`                                   | ~30                                 | Confirm the one-time pfapi migration can never re-run.                                                                                                                                                                                                                                                                                                                                                                                            |
| Inactive SQLite adapter                                     | ~1,100 (+1,600 spec)                | The DB-adapter factory returns IndexedDB everywhere. Ship behind a flag or park on a branch.                                                                                                                                                                                                                                                                                                                                                      |
| Duplicate WebSocket-download and immediate-upload pipelines | ~550                                | Tasks 4–5 of `2026-07-13-sync-simplification-plan.md`, with that plan's gates.                                                                                                                                                                                                                                                                                                                                                                    |
| v2/v3 file-format duplication                               | ~300 (factor) / ~1,500 (retire one) | Pick the long-term format.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Legacy pfapi → op-log migration and pre-v14 backup import   | ~2,200                              | A sunset date plus an "import your JSON backup" message.                                                                                                                                                                                                                                                                                                                                                                                          |

### Phase 2 — Normalize relationship lists (the main structural step)

**Principle:** a relationship is stored once, on the child. Stored arrays are
order hints. Aggregates are computed. This is ADR #2's Today pattern applied to
every list in §3.1.

For each list, one at a time:

1. **Derive membership** from the child field in selectors: `task.projectId`,
   `task.tagIds`, `task.dueDay`, `task.parentId`, `note.projectId`.
2. **Read order tolerantly** from the array: ids that are not members are
   ignored, and members missing from the array are appended in a
   deterministic order (for example `created`, then `id`).
3. **Keep writing the array** exactly as today (dual-write, the ADR #8
   "dual field" channel). Released clients keep reading it. No schema bump and
   no wire change.
4. **Retire the list's compensation on current clients.** Once a divergent
   array can no longer change what a current client shows, current clients no
   longer need to restore its placement after LWW. Candidates:
   - the relationship rebuild in `lww-update.meta-reducer.ts`;
   - Today/planner re-placement and the `Transfer Task` compensation;
   - `repairTodayTagConsistency$`;
   - the list parts of `bulk-archive-filter.util.ts`;
   - list repair in `data-repair.ts`.

   Each removal needs its own E2E, as the rules require.

5. **Backlog and sections** have no child field. Add optional fields
   (sync rule 11: `?` plus a runtime default, for example `task.sectionId?`)
   that current clients write and read, falling back to the array when absent,
   or leave these two lists on today's path.
6. **Roll-ups** (`timeSpent` of parents from subtasks) are computed in
   selectors, not written by reducers of other entities.

**Scope estimate:** being measured by a desk audit of the compensation code.

**Progress metric:** re-run the §2.5 audit after each list. The class (c) count
(51) and the list-compensation line count are the numbers that should fall.

**Bug 1 (§6) is the first instance:** reorders are pure order writes, so they
should never block sync. Fix them by op shape, not by adding them to the
allowlist, and pin the fix with the committed E2E.

### Phase 3 — Decide whether the convergence model must change

After Phase 2, run a desk audit of what still needs per-action code in
`conflict-resolution.service.ts`. If the remainder is small (cascades,
delete-vs-edit policy, the disjoint merge), stop. If not, prototype C:

- capture each action's **effects** (changed entities and fields, found by
  reference comparison of the changed slices) as `LwwUpdatePayload` patch ops,
  which released clients already apply;
- declared = written by construction;
- resolve per field with per-field timestamps kept in a local sidecar.

The hard parts to design first:

- cascades and tombstones (ADR #7's payload-size concern);
- diff cost at 10k+ tasks;
- op volume for bulk actions;
- the vector-clock envelope for patches that span entity types.

### Parallel track — Persistence consolidation

Independent of the conflict work:

1. One `commitBaseline()` primitive (state, clock, applied-op ids and cursor in
   one transaction) for the six "replace the whole state" paths.
2. Snapshots derived from the log instead of copied from live state, then the
   guards that only prove "live state equals a log prefix" retired one at a
   time, each with its E2E.
3. Evaluate repair as a local, read-time normalization instead of a synced
   `REPAIR` op. Caveat: repair logic differs between app versions, which is why
   it is synced today; a local normalization must be safe when two versions
   disagree. Phase 2's tolerant reads remove much of what repair fixes today.

## 6. Bugs found during this review

### Bug 1 — Reordering notes, habits, boards or sections stops sync (reproduced)

- **What:** a pending reorder (`updateNoteOrder`, `updateSimpleCounterOrder`,
  `sortBoards`, `updateSectionOrder`) meets a concurrent edit of any reordered
  entity from another device, or the other way round.
  `_assertMultiEntityPlansAreSafe` has no path for these multi-entity ops and
  throws `UnsupportedMultiEntityConflictError`; sync stops.
- **Symptom by version:**
  - v18.15.0–v18.16.x: a generic "Cannot safely auto-resolve … multi-entity
    operation" error.
  - v18.17.0–v19.0.1 (#9412): "Sync stopped for safety … report this code:
    SYNC_MULTI_ENTITY_UNSUPPORTED …".
  - v19.1.0 (#10140): adds "Resolve…", and a manual sync opens the
    whole-dataset "Keep local / Keep remote" dialog.
- **Shipped:** the gate (`5e754d355`) is in every release from v18.15.0 to
  v19.1.0.
- **Evidence:**
  - `e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts` covers notes
    against a real SuperSync server (`test.fixme`). It dispatches the action
    `NotesComponent.drop` dispatches rather than dragging.
  - `src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts`
    covers all four reorders plus the remote-reorder direction for notes (`xit`).
  - Both fail on `6169df9e9`, for example with
    `SYNC_MULTI_ENTITY_UNSUPPORTED side=local actionType=[Note] Update Note Order entityCount=2`.
- **Not affected:** `updateProjectOrder` and `updateTagOrder` have the same
  shape but no caller today.
- **Issue:** _to be filed_.

### Bug 2 — File-sync upload writes a stale snapshot (already filed)

An upload that merges versions it never downloaded embeds this device's own
state as the file snapshot, while `recentOps` also carries the merged ops. A
device bootstrapping from seq 0 then marks every op as already applied
(`_buildMergedSyncData`, `snapshotAppliedOpIds`). Already filed as #10256.

### Suspected, not reproduced

- `SupersededOperationResolverService` groups replaced ops by `op.entityId`
  (`superseded-operation-resolver.service.ts:436-530`). A rejected multi-entity
  op other than `moveToArchive` or a section op would be re-issued as an LWW
  snapshot of its first entity only. Reached only after a server rejection, an
  empty download and a forced full download.
- Synced reducers that call `nanoid()` or `Date.now()` (§4.1) produce different
  values on each device that replays them; `boards.reducer.ts:114` generates
  panel ids.
- `SuperSyncPage.syncAndWait()` resolves the whole-dataset conflict dialog with
  **Keep remote** on its own. Since #10140 a manual sync that hits the fail-closed
  error opens that dialog, where the helper used to throw, so the `@supersync`
  suite may no longer fail loudly on this class. No false green has been observed
  yet. First step: check whether any existing test passes through the dialog.

**Checked and dropped:** the REPAIR op append and the state-cache save run in
separate transactions (`repair-operation.service.ts:93-110`). A crash between
them is harmless, because the REPAIR op carries the full state and replays on
restart.

## 7. Open questions for the maintainer

1. Do Phases 0–2 match how you want sync to evolve? Is dual-write of the arrays
   acceptable for as long as released clients exist?
2. Backlog and section membership: add optional child fields, or leave these
   two lists on today's path?
3. Conflict journal: drop the few internal-track rows or keep a one-off export?
4. v2 or v3 as the long-term file format? SQLite: ship or park? A sunset date
   for the legacy pfapi migration?
5. For Bug 1: should a reorder that crosses an edit keep the reordering device's
   order, or is "both devices converge, either order" enough?

## Appendix A — How the numbers were measured

- **Line counts:** `wc -l` over non-spec `.ts` files (plus `.html` for
  `src/app/imex/sync/`) at `6169df9e9`, excluding `testing/` where stated.
- **Growth:** first-parent mainline snapshots,
  `git rev-list --first-parent -1 --before=<date>T00:00:00Z origin/master`.
- **Fix categories:** `git log --numstat` over the folders in §2.2, non-merge
  commits after 2026-01-11, with duplicate cherry-picks removed. Production
  lines exclude specs, tests, `testing/`, docs, scripts and vendored code. Each
  fix has one primary category, and categories are fuzzy at the edges.
- **§2.5:** every persistent action creator compared with the reducers,
  handler maps and meta-reducers that handle it. Grep plus a manual read, so
  dynamic dispatch may be missed. Conditional branches are counted at their
  largest write set.

## Appendix B — Confidence

- **Verified in code or by running:**
  - §2.1 and the growth table;
  - §2.4;
  - the §3.1 list table;
  - the Phase 1 unconditional items;
  - the §4.1 counterexample and determinism lines;
  - Bug 1 (Karma and E2E);
  - Bug 2 (code read, and filed as #10256).
- **Measured by audit and spot-checked:** §2.5 (per-action data kept outside
  the repo) and the Phase 2 scope estimate.
- **Estimates:**
  - §2.2 categories;
  - §2.3 anatomy;
  - the §3.2 counts;
  - every "≈ lines" figure.
- **Hypotheses:** option C's mixed-fleet behaviour, and how much compensation
  Phase 2 actually retires. Its per-list E2Es decide the second.

## Appendix C — Rebase on a total order (parked)

**Design, first draft:**

- The confirmed state is the ops in `serverSeq` order; live state is confirmed
  plus pending local ops.
- On download with pending ops: rewind the pending ops, apply the remote ops,
  replay the pending ops through the reducers, and install the result.
- Upload pending ops unchanged. Re-stamp only ops the server rejects as
  concurrent, bounded retries. Re-stamping first would duplicate ops whose
  earlier upload succeeded but lost its response.

**Blockers the adversarial review found, beyond §4.1:**

1. **Fallbacks keep LWW.** Archive side effects (the archive lives in
   IndexedDB, outside NgRx), full-state ops, a missing baseline and throwing
   reducers all fall back to LWW. That means a second convergence path, which
   ADR #10 warns against.
2. **The confirmed baseline needs more than a new cache key:**
   - persisted `serverSeq` (a new field, rule 11);
   - hydration that replays in server order — it replays in local seq order
     today;
   - an off-store reduction — the bulk-apply path dispatches to the live store
     and runs archive side effects;
   - an answer for tabs that do not share ops (#9438);
   - an O(N) snapshot write per sync.
3. **Re-stamping stale snapshot payloads** (`replace` LWW ops, `moveToArchive`
   trees, `deleteProject` id lists) makes them look causally latest to released
   clients.
4. **Semantics:** "last to reach the server wins" for same-field edits, and
   delete wins for every entity type.
5. **Measuring fallbacks** would need a channel; the privacy rule rules out
   telemetry.

**Revisit when** a desktop auto-updater ships (the fleet can be moved to
identical reducers) or SuperSync becomes the only backend.
