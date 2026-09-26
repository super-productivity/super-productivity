# Sync Architecture Review: Why Every Fix Is Expensive

**Status:** Proposal, revised after two adversarial reviews. The maintainer
decided five of its questions on 2026-09-26 (§7); the rest is still proposed.
**Date:** 2026-09-26
**Baseline commit:** `6169df9e9` (`origin/master`); rebased onto `41324d290`.
The four intervening master commits leave the findings unchanged, although
#10249 shrank `file-based-sync-adapter.service.ts` from 3,356 to 3,292 lines.
Measurements below are at the baseline.
**Question:** Did the sync architecture go in the wrong direction? Could we throw
away half of it?
**Scope:** client op-log (`src/app/op-log/`), `packages/sync-core`,
`packages/sync-providers`, `packages/shared-schema`, `packages/super-sync-server`,
sync UI (`src/app/imex/sync/`), and the sync-facing meta-reducers.

## 1. Verdict

**Short answer:** the architecture has one real design flaw. It is locked in
by compatibility with released clients. It does not justify a rewrite now, and
the evidence does not support throwing away half of the sync code.

- **Sound, keep:**
  - the op-log itself: persistent actions captured into a durable log,
    snapshot plus tail replay, provider adapters;
  - vector clocks (ADR #10);
  - end-to-end encryption and the providers;
  - the server's auth, quota and transport work.

  Most of that code would exist under any design.

- **The flaw:** operations are replayed **intents** whose reducers write many
  entities, but conflicts are detected and resolved **per declared entity**.
  - 64 of the 132 persistent actions write outside the key that conflict
    detection sees (§2.5).
  - Every such action that can meet a concurrent edit needs hand-written
    compensation, or it stops sync.
  - It is the largest single root cause in the fix history, at most a fifth of
    fix lines (§2.2).
  - The fail-closed gate turned it into the class that most often wedged
    users' sync (§2.4).
- **Locked in:** there is no desktop auto-updater, so every released version
  stays in use.
  - Every structural fix — replaying in one order (§4.1), deriving list
    membership (§4.2), correcting what ops declare, making reducers
    deterministic — changes what old clients do with the same op. So none of
    them can delete the compensation code.
  - Only a **protocol-generation change** with a sunset could (§5, Phase 3).
    That needs:
    - a multi-month sunset;
    - a new file format with a migration for file providers;
    - a request-level lockout for old SuperSync clients;
    - a migration that keeps offline edits.
  - It would save at most ~5k lines gross, before the new generation's own
    code. Not worth starting now.
- **The urgency has dropped:**
  - `conflict-resolution.service.ts` has not grown since mid-August (4,825 →
    4,817 lines);
  - `src/app/op-log/` grew +3.9k lines from August 1 to the baseline, against
    +15.9k in July alone;
  - July's growth was an audit-driven burst, and the new contributor rules
    target exactly that (§2.6, §3.5).
- **Do now:**
  1. Contributor rules that stop per-action compensation (Phase 0).
  2. Close the remaining fail-closed surface locally, starting with the
     reorder bug found in this review (#10264), after proving both order and
     content convergence (Phase 2). The ordering-only allowlist alone is insufficient.
  3. Delete dead code: ~2.3k lines unconditionally; ~5–6k more after a
     decision each, four of them now made (Phase 1).
  4. Consolidate local persistence, an estimated ~3–4k lines (parallel
     track).
- **Half?** No. Realistic: roughly 10–12k production lines over time — about
  a fifth of the ~52k-line client op-log, some of it outside `op-log/`, plus a
  larger share of tests. Most of it comes from deletions and consolidation,
  not from a new model.

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

The conflict area also carries ~27.7k lines of unit specs (the conflict, LWW,
superseded, rejected-op and journal specs in `src/app/op-log/sync/`, plus the
`lww-update` and bulk-archive specs). Appendix D splits the same file by a
different method (by purpose rather than by feature), so its numbers differ.

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

### 2.6 Growth has slowed since July

| Measure                                          | July 2026 | 2026-08-01 → baseline |
| ------------------------------------------------ | --------: | --------------------: |
| `src/app/op-log/` production lines               |   +15,868 |                +3,930 |
| `conflict-resolution.service.ts` (07-01 → 08-16) |    +3,721 | −8 (08-16 → baseline) |

Most of the conflict service's growth landed in the audit burst of 07-13 to
07-16. The rules added since then ("hardening needs an observed instance", an
E2E reproduction for every sync fix) address that process.

### 2.7 What locks the design in

- **Compatibility is load-bearing:**
  - the July simplification plan kept almost every surface "for
    compatibility", and judged the readers' "maintenance cost … tiny relative
    to data-loss risk";
  - schema v3/v4 barriers, LWW replace-versus-patch modes and singleton-id
    compatibility for v18.15.0/1 stay;
  - sync rule 10: a schema bump never protects the released fleet;
  - ADR #8: "Any policy gated on 'wait for the old fleet to shrink' is a
    permanent no in disguise."

  Compatibility blocks _deleting_ code; it did not make individual fixes
  expensive.

- **The desktop app cannot update itself:** the Electron auto-updater is
  commented out (`electron/start-app.ts:526-538`), and the update banner's
  dismissal is persisted.
- **Version data exists, gating does not:**
  - SuperSync clients report `appVersion` on download since v19.0.0, and
    `DeviceService` records it per device;
  - `isAccountCheckpointSafe` only feeds a fleet-wide summary for the daily
    cleanup log (`cleanup.ts:64`), so no per-account gate is enforced anywhere;
  - devices unseen for 45 days are deleted (`RETENTION_DAYS`,
    `deleteStaleDevices`);
  - `app_version` is deliberately kept out of the device list, and devices
    have no names (`device.service.ts:58-66`).
- **The only precedent that stopped released file clients** is a format
  break: the SPAP-11 v3 tombstone ("a truly-old shipped client hits the strict
  `version !== 2` check and hard-errors",
  `packages/sync-providers/src/file-based-sync-data.ts`). It needed follow-up
  fixes for `.bak` healing and forked folders (#8857, #9047, #9089).
- **The weaker precedents:**
  - the v16 detection (`LegacySyncFormatDetectedError`) offers "Force
    overwrite", which leaves old devices diverging silently;
  - the User Profiles removal was local-only.

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
per-entity LWW, disagree after a concurrent edit, and part of the compensation
code restores their agreement. The lists are not only display: reducers read
them to decide synced fields, and repair treats them as the truth (§4.2).

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

### 3.6 The lock-in

Every shipped op shape, payload mode and reducer behaviour stays live for as
long as any device might still run it, and nothing bounds that time (§2.7).
This does not make each fix expensive — the audit-driven process did that
(§3.5). It makes the structural fixes in §4 unable to _delete_ anything: each
would add a path for new ops while the old one stays.

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

### 4.2 Why normalizing lists alone is modest

A desk audit of the compensation code (appendix D) classified ~10,200 lines by
purpose. Only ~2,830 (27%) keep denormalized lists consistent, and only ~530
of the 4,817 lines in `conflict-resolution.service.ts` do. Most of that file
handles delete/archive cascades and recreation (~1,560) or field-level LWW
(~1,540).

Deriving membership from the child's field (ADR #2's Today pattern) while
released clients still read the arrays retires only ~400–600 lines. Three
reasons:

- **Reducers read the lists to decide synced fields:**
  - `planTasksForToday` uses `TODAY_TAG.taskIds` to decide which children get
    `dueDay`;
  - the task-delete cascade and the "last subtask" roll-up follow
    `parent.subTaskIds` and its order;
  - `roundTimeSpentForDay` gates on `subTaskIds.length`;
  - `moveToOtherProject` moves the subtasks the list names.

  Changing these reducers makes old and new clients replay the same op
  differently.

- **Repair runs the other way:** it treats a list as the truth and rewrites
  the child (`_fixInconsistentTagId`, `_fixInconsistentProjectId`), and a strict
  list/child mismatch fails validation, which emits a synced `REPAIR`.
- **The `lww-update.meta-reducer.ts` relationship rebuild is the dual-write**
  on the LWW path. Optional child fields such as `task.sectionId?` go stale as
  soon as a released client moves a task by writing only the array.

So list normalization belongs inside a new protocol generation (§5, Phase 3),
not in front of it.

### 4.3 Options compared

|                             | A. Status quo + discipline | E. Close the fail-closed surface locally                          | B. Normalize lists (dual-write)            | C. Protocol generation: field patches                                                            | D. Total order + rebase                   |
| --------------------------- | -------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| What changes                | contributor rules          | resolve blocked actions with verified convergence                 | read membership from child fields          | new op kind, new file format, lockout and migration                                              | apply in server order, replay pending ops |
| User-visible harm addressed | stops new cases            | the remaining sync wedges                                         | little                                     | the whole class, after migration                                                                 | the whole class, in theory                |
| Released clients            | unchanged                  | unchanged (resolution-side only)                                  | keep reading and repairing from the arrays | locked out of migrated accounts (raw HTTP error in released code)                                | diverge on any reducer difference         |
| Code deleted                | Phase 1 only               | none (prevents growth)                                            | ~400–600 lines                             | after a sunset: gross ≤ ~5k (list upkeep, the gate, mixed-winner code), minus generation 2's own | none — LWW stays as the fallback          |
| Risk                        | the class stays open-ended | high until both conflict directions preserve content and converge | lists feed synced fields; repair direction | high: lockout mechanics, migration, archive/cascade/time rules still needed                      | see §4.1                                  |

Also considered and rejected:

- **Generations for SuperSync only** (ADR #10's revisit condition) — deletes
  nothing while file providers exist.
- **A CRDT library** — ruled out by the root-dependency rule and
  `operation-log-architecture.md`.
- **Server-side validation or merging** — impossible under mandatory E2EE.

### 4.4 Recommendation

- **Now:** A + E + Phase 1 + the persistence track. Nothing on the wire
  changes, and released clients are unaffected.
- **Decide later:** a protocol-generation change (C, Phase 3) only if both
  hold:
  1. the product decision in §7 (open question 1) is yes — a sunset in
     months, and ideally a desktop auto-updater;
  2. a quarter of fix data under the new rules shows the class still
     producing fixes.
- **Keep D parked** (appendix C).

None of the "now" steps changes an ADR. A generation change would amend ADR
#8's fleet assumption and revisit ADR #5 (a cross-entity patch envelope is its
reverted `affectedEntities`) and ADR #7 (cascades).

## 5. Plan

### Phase 0 — Stop the generator (contributor rules, no code)

Proposed for the maintainer to adopt or reject; this plan does not edit
`CLAUDE.md`:

1. Prefer an existing generic resolution path over new per-action machinery in
   `ConflictResolutionService`, but require convergence and content-preservation
   tests in both conflict directions. Merely removing a safety stop is not a
   fix (Phase 2). If no path fits, design the smallest safe change, including
   compatibility with old clients (ADR #8). The file's size ratchet stays.
2. A new action should not add a new denormalized list or a new undeclared
   cross-entity write. Store the fact on the child and derive the rest (the ADR
   #2 pattern). Sync rule 3 (multi-entity change = meta-reducer) is unchanged
   for true multi-entity changes.
3. No UI action may fall into the fail-closed path. A new multi-entity action
   names its conflict resolution path in its PR.

### Phase 1 — Delete what is dead, dormant or duplicated

**Unconditional (~2.3k lines):**

| Item                                                                                                                                                               | ≈ Lines | Evidence                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------: | ----------------------------------------------------------------------------------------------------------------- |
| `src/app/pfapi/**/*.js` (compiled legacy JS, 4 files)                                                                                                              |   1,777 | imported nowhere (grep)                                                                                           |
| Concurrent-snapshot auto-merge branch (`_tryConcurrentSnapshotMerge`)                                                                                              |     110 | `AUTO_MERGE_CONCURRENT_SNAPSHOT: false` is a constant (`packages/sync-providers/src/file-based-sync-data.ts:233`) |
| `listFiles` in six providers                                                                                                                                       |     150 | no production caller                                                                                              |
| Uncalled store methods (`clearFullStateOps`, `clearUnsyncedOps`, `filterNewOps`, `loadStateCacheBackup`, `incrementCompactionCounter`; `appendBatch` is test-only) |    ~200 | no production callers                                                                                             |
| Test-only private helpers in `conflict-resolution.service.ts` (`_deepEqual`, `_extractEntityFromPayload`, `_extractUpdateChanges`)                                 |      35 | only reached from specs via `as any`                                                                              |
| Dead entry points `ProjectService.updateOrder`, `TagService.updateOrder`, `SimpleCounterService.updateAll`                                                         |      15 | no callers (the actions and reducers stay: old ops still replay)                                                  |

**Decision-gated (~5–6k lines).** Decisions of 2026-09-26 are marked
**Decided**:

- **Conflict journal + review UI/page/banner (~1,800) — Decided: drop, without
  an export.** Delete the journal, its review page, the Settings button and the
  banner, and delete the `SUP_CONFLICT_JOURNAL` database on upgrade.
  - Every journal write sits behind a flag that is off at the only caller
    (`remote-ops-processing.service.ts:516`). The freeze (#9061, `71a9a4338`)
    and the feature (`962c5bbeb`) first shipped together in v18.15.0, so no
    stable release wrote journal rows.
  - Accepted loss: rows that master builds from 2026-07-11 to 07-16 may have
    written, including Snap edge and Play internal-track releases on real
    users' devices. They hold values that sync overwrote more than two months
    ago.
- **Legacy pfapi → op-log migration (~1,200) — Decided: retire it 12 months
  after v17.** Announce it now. The first release after 2027-01-23 replaces
  the in-place v16 → op-log migration with a detector message such as "Data
  from v16 or older found. Install vX.Y once to migrate it, or import a JSON
  backup.", where vX.Y is the last release that still migrates.
  - The legacy JSON backup import (`migrate-legacy-backup.ts`, ~820 lines)
    stays, so old backups remain importable. That is why this row is ~1,200
    lines instead of the ~2,200 first estimated.
  - `_syncVectorClockToPfapi` (~30) goes at the same time: its only reader is
    that migration (`operation-log-migration.service.ts:340`).
- **v2/v3 file-format duplication (~300 to factor, ~1,500 to retire one) —
  Decided: v3 is the long-term format.**
  - New work targets v3.
  - v3 becomes the default for new sync setups after one full WebDAV E2E run
    with v3 enabled.
  - Existing v2 folders stay v2 (no forced migration) and still get data-loss
    fixes such as #10256.
  - Retiring v2 (~1,500) is a later, separate decision.
- **Inactive SQLite adapter (~1,100, +1,600 spec) — Decided: park.** Delete
  the SQLite adapter, the backend migration, their specs and the `sql.js`
  devDependency. Keep the `OpLogDbAdapter` port, which the IndexedDB backend
  uses. Mark `sqlite-migration.md` as parked, name the last commit with the
  code, and note it on #7931. Reopen on a confirmed eviction loss that the
  native backups did not cover.
  - Only the foundation exists: the DB-adapter factory returns IndexedDB
    everywhere, and there is no native wrapper, migration trigger, flag or
    device validation. The dormant code still needed two follow-up PRs (#8849,
    #9920).
  - #7931 plans to add `@capacitor-community/sqlite`, which the
    no-new-dependencies rule excludes, so shipping needs an in-repo native
    wrapper per platform. Android already has one SQLite store
    (`KeyValStore.kt`).
  - The motivating total loss (#7892) is mitigated by the native backups and
    informed restore (#7924, #7925, #8401). No eviction report was found after
    June, though missing reports are not proof.
  - Shipping would move every Android user's op-log to a new backend, which is
    a high-risk state replacement.
- **Duplicate WebSocket-download and immediate-upload pipelines (~550):**
  tasks 4–5 of `2026-07-13-sync-simplification-plan.md`, with that plan's
  gates.

### Phase 2 — Close the fail-closed surface locally (option E)

Resolution-side only: released clients are unchanged, and nothing on the wire
changes.

1. **Bug 1 (#10264).** Find a resolution that preserves content and converges
   ordering for the four UI reorders (`updateNoteOrder`,
   `updateSimpleCounterOrder`, `sortBoards`, `updateSectionOrder`). Adding them
   to `ORDERING_ONLY_MULTI_ACTIONS` alone is insufficient:
   - With a local note reorder and a newer remote content edit, rejecting the
     reorder does not undo its optimistic `project.noteIds` write. The remote
     `updateNote` does not write that list, leaving the two devices in different
     orders with no pending reorder to upload.
   - In the reverse direction, a newer remote reorder can win LWW and reject
     the pending local content edit. Replaying the reorder changes no content,
     so the edit remains visible locally but never reaches the other device.
   - The Today-specific "cosmetic, self-healing" rationale from #9426 is not
     proof that these reorders are safe. Check each reducer's written state,
     both timestamp winners, both directions, and replay after restart.
   - Extend the E2E to cover the reverse crossing before implementing the fix,
     then enable the committed repros. The integration specs currently pin only
     removal of the safety stop; their mocked applier cannot prove convergence.
   - Order (decided 2026-09-26, §7): either device's order may survive, as
     long as both devices agree and unrelated content edits survive. Keeping
     the reordering device's order is a later improvement, not part of the
     fix.
2. **Triage the rest of the blocked set.** About half of the 16 blocked
   creators are these four reorders or actions with no caller or legacy-only
   shapes. For each remaining one, either prove it unreachable, route it to an
   existing generic path, or change the action. Each needs its E2E, as the
   rules require.
3. **Evaluate a less destructive fallback** than whole-dataset replacement for
   a shape that is still unsupported, so one row cannot force a user to
   discard all local or all remote changes.

### Phase 3 — Protocol generations (deferred; decision gate in §4.4)

What it would take, so the decision can be made on facts:

- **File providers:** a new file format (new `version` and file names),
  migrated with the SPAP-11 recipe:
  - neutralise `.bak` first;
  - tombstone every legacy file;
  - migrate under a lock with conditional writes.

  An envelope marker would not stop released clients: they ignore it and
  drop it when they rewrite the envelope. LocalFile and weak-ETag WebDAV have
  no compare-and-swap, so a residual race remains. Download-only devices are
  invisible; the format break is what protects them.

- **SuperSync:**
  - **Lockout:** after migration, the server answers every request —
    downloads included — from a device below the floor with a non-auth 4xx,
    keyed on its recorded `appVersion` (no version counts as old).
  - **What not to use:** per-op rejections permanently drop the device's edits
    (`rejected-ops-handler.service.ts:270-279`), and 401/403 signs the user out
    after three failures (`sync-wrapper.service.ts:969-977`).
  - **Generation-2 ops:** a new `opType`, so a generation-1 receiver blocks
    instead of misapplying them. Recent releases stop on an unknown op type
    (#8764); older ones wedge.
  - **Self-hosted servers:** advertise the capability to clients, as
    `supportsCausalRepairSnapshots` does.
  - **Floor:** devices unseen for 45 days are not counted and must be handled
    when they come back.
  - **What old devices show:** a raw HTTP error. Only releases that know
    about generations can show a calm message.
- **Migration:**
  - The baseline needs REPAIR semantics, not `SYNC_IMPORT`: older ops are
    represented and concurrent ops survive (sync rule 7).
  - A device that finds its account migrated converts its own pending
    generation-1 ops once, by replaying them on the baseline and capturing
    patches. No pending op is dropped.
  - An E2E covers a device that is offline across the migration.
- **Generation-2 semantics:** field patches with per-field timestamps
  (declared = written by construction). Field values then apply the same way
  on any receiver. Still needing per-generation receiver rules:
  - archive ops applied into IndexedDB, outside NgRx;
  - cascades the sender never saw (ADR #7);
  - additive time-tracking deltas (`syncTimeSpent`) — "newest timestamp per
    field" would drop tracked time;
  - validation and repair;
  - plugin writes to the arrays.

  Per-field timestamps must be persisted in state, snapshots and full-state
  ops, which is a persisted-model and wire change (rule 11). The plan would
  also have to answer `operation-log-architecture.md`'s rejection of
  "delta / state-diff sync". Reference comparison can skip unchanged slices,
  but patch extraction and serialization add work beyond NgRx's existing
  copies; benchmark that cost at 10k+ tasks before calling it cheap.

- **Sunset:** releases ship roughly weekly, so the window must be stated in
  months. Every account with one un-updated device stays on generation 1 for
  the whole window. File-provider fleets cannot be counted (no telemetry).
- **Net savings:** gross ≤ ~5k production lines (list upkeep, the gate,
  mixed-winner code) after the sunset. Cascade and field-level code (~5k)
  comes back in generation 2, and the new generation's code is not subtracted.

### Parallel track — Persistence consolidation

Independent of the conflict work. Estimated at ~3–4k lines by the persistence
audit; not yet adversarially reviewed:

1. One `commitBaseline()` primitive (state, clock, applied-op ids and cursor in
   one transaction) for the six "replace the whole state" paths.
2. Snapshots derived from the log instead of copied from live state, then the
   guards that only prove "live state equals a log prefix" retired one at a
   time, each with its E2E.
3. Evaluate repair as a local, read-time normalization instead of a synced
   `REPAIR` op. Caveat: repair logic differs between app versions, which is why
   it is synced today; a local normalization must be safe when two versions
   disagree.

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
- **Fix direction:** Phase 2, step 1.
- **Issue:** #10264.

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

## 7. Decisions and open questions

### Decided by the maintainer (2026-09-26)

1. **Bug 1 (#10264):** "both devices converge, either order" is enough. Keeping
   the reordering device's order can come later. Content edits must still
   survive in both conflict directions (Phase 2).
2. **Conflict journal:** drop it without an export, and delete its database on
   upgrade (Phase 1).
3. **Legacy pfapi migration:** retire the in-place v16 → op-log migration in
   the first release after 2027-01-23, 12 months after v17, and announce it
   now. Old JSON backups stay importable (Phase 1).
4. **File format:** v3 is the long-term format. New setups default to v3 after
   one full WebDAV E2E run with v3 enabled. Existing v2 folders are not
   migrated and keep getting data-loss fixes (Phase 1).
5. **SQLite op-log backend:** park it. Delete the inactive foundation from
   master and reopen on a confirmed eviction loss that the native backups did
   not cover (Phase 1).

### Still open

1. **Sunset for old sync protocol generations.** This only matters if Phase 3
   is to happen.
   - How long a window, in months?
   - Should the desktop auto-updater come back?
   - Is it acceptable that an old device shows a raw HTTP error, or a newer
     format error, until it is updated?
2. **Priority against feature work:** Phase 0 and individual Phase 1 deletions
   are bounded; estimate Phase 2 after its convergence design is validated.
   The persistence track's few-week estimate is still unverified.

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
- **Measured by audit and spot-checked:** §2.5 and appendix D (per-action and
  per-block data kept outside the repo).
- **Estimates:**
  - §2.2 categories;
  - §2.3 anatomy;
  - the §3.2 counts;
  - every "≈ lines" figure.
- **Hypotheses:**
  - the persistence-track estimate, which has not been reviewed;
  - every Phase 3 figure;
  - whether the slower growth since August holds.

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

## Appendix D — List-upkeep audit

Classification of the compensation and repair code by purpose (method ranges,
±10%; the rows sum to ~10,200 lines): **L** = keeps denormalized lists or roll-ups consistent; **C** =
cascade, delete or recreate semantics; **F** = field-level or generic LWW;
**O** = other (security footprint, journal, plumbing).

| File                                       |   L |     C |     F |     O |
| ------------------------------------------ | --: | ----: | ----: | ----: |
| `conflict-resolution.service.ts`           | 530 | 1,560 | 1,540 | 1,140 |
| `lww-update.meta-reducer.ts`               | 515 |   120 |   215 |   145 |
| `bulk-archive-filter.util.ts`              | 145 |   405 |     – |    10 |
| `section-conflict-commutativity.util.ts`   | 540 |     – |     – |    65 |
| `superseded-operation-resolver.service.ts` | 270 |    30 |   115 |   185 |
| `preserve-partial-bulk-plan.util.ts`       |   0 |     – |   195 |    18 |
| `tag.effects.ts` (list-repair effects)     | 158 |     – |     – |   120 |
| `data-repair.ts`                           | 520 |   600 |   255 |   145 |
| `is-related-model-data-valid.ts`           | 155 |   290 |     – |   210 |

- About 840 L lines serve sections and about 150 serve backlog placement.
  Neither has a child-side field.
- About 220 L lines keep subtask `projectId` inheritance consistent.
- Today and tag membership in the main views has been derived since v17.0.0
  (`computeOrderedTaskIdsForToday`, `computeOrderedTaskIdsForTag`).
- Projects, backlog, future planner days, subtasks, notes and sections are
  still read from the arrays.
- The plugin API exposes the arrays too (`packages/plugin-api/src/types.ts`).
