# Sync: a less destructive fallback for unsupported conflicts

**Status:** Proposal for the maintainer to approve or reject. Docs only;
nothing here is implemented.
**Date:** 2026-09-29
**Baseline:** `878c9a3b4c` (`origin/master`). Line numbers are at that commit.
File names are unique; full paths are listed in the appendix.
**Asked by:** Phase 2, step 3 of the
[architecture review](2026-09-26-sync-architecture-review.md#phase-2--close-the-fail-closed-surface-locally-option-e).
**Scope:** what happens after the fail-closed stop fires. Fixing individual
crossings stays with the
[remaining-actions audit](2026-09-26-sync-remaining-conflict-actions-audit.md)
and conflict rules 12–14 (pending in #10305).

## 1. Summary

- **Today,** one refused operation holds back the whole downloaded batch,
  stops sync, and ends in a dialog whose two choices each replace all data on
  one side (§2).
- **Recommendation:** option (a), done as a narrowed **Keep remote**
  (§4, §5):
  - rebuild from the remote history with the existing download-first
    rebuild;
  - carry over every pending local op except the local side of the refused
    conflict;
  - name what was dropped.

  Nothing new goes on the wire, so released clients only ever see the user's
  ordinary ops. There is no per-action branch: the rebuild never needs to know
  what the refused op wrote.

- **Main risk:** carried-over ops that crossed an incoming op bypass the
  conflict engine. On SuperSync the local side then wins, and most
  multi-entity ops would be re-issued only in part, so step 1 falls back to
  today's dialog for those (§6).
- **Rejected:** fixing the footprint in place, quarantine (b) and timestamp
  resolution (c). Each needs one of three things the system lacks: a write set
  the op log does not record, a wire op that can set list order, or an intent
  replay that released clients run identically (§3).
- **First step:** commit red E2E reproductions of two crossings that stay
  unsupported by design: a bulk due-day update, and an archive → restore →
  re-archive history, each against a title edit (§5.1). Then ship the scoped
  choice behind the existing **Resolve…** route. Making it automatic is a
  separate, later decision.

## 2. Today's behavior

### 2.1 The stop

- `_assertMultiEntityPlansAreSafe` (`conflict-resolution.service.ts:2434-2502`)
  throws `UnsupportedMultiEntityConflictError` for a plan containing a
  multi-entity op outside the admitted sets. It throws for the remote side at
  `:2447`, the local side at `:2463`, and overlapping local bulk archives at
  `:2498`.
- It runs first in `_resolveConflictsWithLWW` (`:2003`), which is step 1 of
  `autoResolveConflictsLWW` (`:939`). Its contract is "Fail before op-log
  mutation" (`:2397-2398`).
- The second throw site is `superseded-operation-resolver.service.ts:408-419`.
  It fires for a pending reorder-family op that the server rejected and that
  has no causal projection, for example because compaction removed the
  conflict row. The comment there: "Entity LWW cannot carry that list write:
  keep it pending."
- The error message holds only a fixed code, the side, a known action type and
  a clamped count. The class comment says: "Never widen this to ids, payloads,
  or titles" (`sync-errors.ts:146-170`).

### 2.2 What stops with it

- If a batch has conflicts, its non-conflicting ops are passed into the same
  `autoResolveConflictsLWW` call instead of being applied first
  (`remote-ops-processing.service.ts:473-510`). The throw therefore holds back
  the whole downloaded batch, not just the crossing.
- The cursor is saved only after processing
  (`operation-log-sync.service.ts:1311-1331`; piggyback path `:473-496`). The
  next cycle downloads the same batch and throws again.
- The wrapper downloads before it uploads (`sync-wrapper.service.ts:621`,
  `:662`), so a stopped cycle uploads nothing. On file providers, this
  device's pending ops stop reaching other devices.
- On SuperSync, immediate upload still sends every pending op after each local
  edit (`immediate-upload.service.ts:248`). The server accepts those that
  cross nothing there. The piggyback throw that follows is only logged
  (`:406-411`), so those ops stay pending with deferred acknowledgements
  (constraint 5).
- `reorder-conflict-wedge.integration.spec.ts:511-535` pins the local part:
  after the throw, state is unchanged and the local op is still pending.

### 2.3 Which provider takes which path

| Path to the gate                                                                               | SuperSync | File-based                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| Download, then `processRemoteOps`, then `autoResolveConflictsLWW`                              | yes       | yes                                                                                               |
| Upload, then piggybacked ops, then the same call (`operation-log-sync.service.ts:406`)         | yes       | no: the adapter's upload response has no `newOps` (`file-based-sync-adapter.service.ts:999-1008`) |
| Server rejection, then `RejectedOpsHandlerService`, then a download or the superseded resolver | yes       | no: the adapter accepts every op; its only rejection code is `REPAIR_STALE` (`:1432`, `:2838`)    |

The rejection handler covers `CONFLICT_CONCURRENT` and `CONFLICT_SUPERSEDED`
(`rejected-ops-handler.service.ts:255-261`). Its catch leaves the ops pending
and re-throws unchanged (`:591-616`). Both throw sites therefore reach the
wrapper as the same error.

### 2.4 What the user sees

- **Background sync:** sync status `ERROR` and a non-sticky error snack with
  **Resolve…** (`sync-wrapper.service.ts:1137-1165`). It reads: "Sync stopped
  because some changes cannot be merged safely … This replaces all data on one
  side. Please report this code: …" (`en.json:1688`, `:1615`).
- **Manual sync or Resolve…:** `_handleDataConflict`
  (`sync-wrapper.service.ts:1663-1760`) opens `DialogSyncConflictComponent`
  (`:2044-2058`): **Sync: Conflicting Data**, with **Keep local**, **Keep
  remote** and Cancel. The dialog text says each choice replaces all data on
  one side (`en.json:1289`).
- This path passes no remote clock, so the dialog cannot count changes
  (`dialog-sync-conflict.component.ts:151-154`). Both choices then always ask
  for a second confirmation: "This will replace the entire … dataset"
  (`:193-195`, `en.json:1286`).
- **Cancel** keeps local data (`en.json:1659`) and leaves sync stopped.

### 2.5 The data loss

- **Keep remote** (`sync-wrapper.service.ts:1740`) runs
  `forceDownloadRemoteState` (`operation-log-sync.service.ts:1799`).
  - It downloads the full history from seq 0 (`:1827`) and validates it
    before replacing the op log wholesale (`:2023-2034`).
  - In this path `preservedLocalOps` stays empty (`:1957`). So **every**
    pending local op is discarded, not only the refused one.
  - A pre-replace backup and a persistent Undo snack can restore the whole
    previous snapshot (`:2422-2440`). Undo re-imports it as a `BACKUP_IMPORT`
    under a fresh client id (`backup.service.ts:374-400`, `:439-456`), which
    syncs to every device like **Keep local**
    ([recovery points](../sync-and-op-log/local-recovery-points.md)). It
    does not bring back the pending ops.
- **Keep local** (`sync-wrapper.service.ts:1728`) uploads a `FORCE_UPLOAD`
  `SYNC_IMPORT` of the full local state with the clean-slate flag
  (`sync-import-conflict-coordinator.service.ts:66-110`). On SuperSync, the
  server deletes its operations first (`clean-slate.service.ts:62`).
  - Every remote op this device had not applied is lost. That includes the
    whole held-back batch.
  - A receiving device with meaningful pending work gets its own
    whole-dataset choice (`sync-import-conflict-gate.service.ts:52`). Ops
    concurrent with the import are dropped by design (sync rule 7).
- Either way, one refused op costs all of one side's changes since the last
  sync.

### 2.6 Released clients

- `git tag --contains 5e754d3552` (#8980, the gate) lists v18.15.0 through
  v19.1.0. The **Resolve…** route (#10140, `355d845c92`) is only in v19.1.0.
- Earlier releases show only an error: a generic one in v18.15–v18.16, and
  one naming the action from v18.17.0 (#9412)
  ([review §6, Bug 1](2026-09-26-sync-architecture-review.md#bug-1--reordering-notes-habits-boards-or-sections-stops-sync-reproduced)).
- Everything below changes updated clients only. A released client that meets
  the same crossing still stops, as it does today.

### 2.7 What still reaches the stop

- The wedge spec (`reorder-conflict-wedge.integration.spec.ts:395-510`) pins
  these edits against a pending reorder:
  - note unpinning;
  - competing orders of notes, habits and issue providers;
  - a section's context change;
  - habit settings, deletion and time deltas;
  - issue-provider identity changes and deletion.
- The audit lists more crossings from source. Not all of them are reproduced
  end to end:
  - `updateTasks` against a title edit;
  - `updateTask` with `projectMoveSubTaskIds`;
  - `addTaskToSection` across sections;
  - `sortBoards` against `removeBoard`;
  - section expansion against section order;
  - two pending bulk archives sharing a task (archive → restore →
    re-archive), against an edit of that task.
- Section expansion against order has a real-UI reproduction
  ([report](2026-09-26-sync-section-expansion-reproduction.md)), but its spec
  was not committed. `reorder-conflict.util.ts` still has no `isExpanded` case.
- Two crossings have been fixed since the audit: dated habit counts (#10295),
  and issue-provider order against settings (#10294).
- A parallel effort, still in progress, replaces per-action reorder admission
  with one structural rule. It is meant to take reorder crossings off the stop
  in stages: first edits that do not write the ordered list, such as section
  expansion, and later competing reorders and reorder against delete. Bulk
  task updates and the compound archive history stay unsupported by design,
  so §5.1 uses them.

## 3. Constraints any fallback must meet

These verified facts decide between the alternatives.

1. **Rejecting an op does not undo it.** Hydration replays rejected ops:
   "every rejection path appends its compensation AFTER them in seq order",
   and "permanent rejections never revert state"
   (`operation-log-hydrator.service.ts:486-505`). A dropped op that stays in
   the log comes back on restart unless a correction row follows it.
2. **The log has no write set.** Capture stores the declared ids, normally
   with `entityChanges: []` (audit, "What actually reaches the stop").
   Nothing records the undeclared writes, and those are exactly what the gate
   cannot see.
3. **No entity-level state op sets list order.** An LWW Update writes one
   entity with `addOne`, `setOne` or `updateOne`
   (`lww-update.meta-reducer.ts:896-925`), plus parent membership lists
   (`:87-366`). Only reorder-style actions, or a whole-dataset op such as
   `SYNC_IMPORT`, can set the order of a feature's `ids` (sections, habits,
   issue providers). A new op for it would be a wire change.
4. **Replaying an intent is not version-safe.** Re-sending an op after the
   other side's op converges only if every client runs the same reducer. The
   review gives a note-order counterexample (review §4.1).
5. **Pending does not always mean unsent.** In the normal cycle, ops the
   server has accepted stay pending until the piggybacked ops are processed
   (`operation-log-sync.service.ts:306`,
   `operation-log-upload.service.ts:99-121`). During a stop on SuperSync this
   is the common case (§2.2). A fallback cannot drop such an op, because the
   history brings it back, and must not name it as dropped.
6. **Released clients get only existing op types and payloads** (sync rule
   10, [ADR #8](../../ARCHITECTURE-DECISIONS.md#8-additive-data-model-evolution-over-schema-bumps)).
7. **Size caps** (`eslint.config.js:435-444`). `sync-wrapper.service.ts` is
   exactly at its cap (2,084 lines). `operation-log-sync.service.ts` has 8
   lines left (2,580 of 2,588), and `operation-log-store.service.ts` has 1
   (3,152 of 3,153). The resolver is below its cap (4,581 of 4,738), but
   under rule 12 that cap may only go down.

## 4. Alternatives

### (a) Remote wins for the refused crossing

Drop the local side of each refused plan and keep everything else. For
everything the dropped ops wrote, converge on the remote state.

**(a1) In place.** Apply the batch, mark the local op rejected, then write the
remote values over its footprint.

- It needs the footprint (constraint 2), which means a per-action write-set
  table. Rule 12 forbids that.
- It needs a correction row after the rejected op (constraint 1), and no
  entity-level op can set list order (constraint 3).
- It needs the remote values. The log keeps no copy of the state from before
  the op, and compaction can even remove the conflict row
  (`superseded-operation-resolver.service.ts:408-409`). Only a full remote
  state has them.

Not viable.

**(a2) Narrowed Keep remote.** Reuse the rebuild, but seed
`preservedLocalOps` with every pending local op except the dropped ones.

`_restorePreservedLocalOps` (`operation-log-sync.service.ts:2323-2356`)
already does the carry-over:

- it re-appends local ops with their ids and clocks, skipping any that the
  downloaded history already holds;
- it merges their clocks into the local clock;
- it applies them on the rebuilt state without re-running local effects, and
  leaves them pending for upload;
- it throws if one of them fails to apply. It does not validate the result;
  only the history replay before it does
  (`remote-ops-processing.service.ts:421-434`).

How (a2) fares on each criterion:

- **Loss:** only the dropped local ops, and they are named to the user. Each
  is dropped whole: a dropped Finish day un-archives every task it archived,
  not only the crossed one. No remote op is lost.
- **Convergence:** the device ends at "server history, then its own unsent
  ops". This is not constraint 4's re-send: these are ops the device would
  have uploaded anyway, and every other device applies them after the same
  history. Only this device's apply order changes, to match. The dropped ops
  never leave the device.
  - Ops the server already has are part of the downloaded history.
    `appendBatchSkipDuplicates` (`operation-log-store.service.ts:953`) skips
    them on carry-over (constraint 5).
  - A carried-over op that crossed an incoming op does not upload unchanged
    (§6, "Carried-over crossings").
- **Released clients:** nothing new goes on the wire (constraint 6).
- **Providers:** both already support the rebuild.
  - The file branch hydrates the remote snapshot first
    (`operation-log-sync.service.ts:2046-2056`), and
    `webdav-conflict-use-remote-restore-8107.spec.ts` covers Keep remote on
    WebDAV.
  - SuperSync downloads the full history, as Keep remote does today.
- **Restart:** the replacement clears every op and stores the preserved ones
  in the rebuild marker, in one transaction
  (`operation-log-store.service.ts:2452-2471`). A crash before it changes
  nothing. After it, the next sync resumes from seq 0 and merges the marker's
  ops with any captured since (`operation-log-sync.service.ts:1994-2000`), so
  status-blind replay cannot bring the dropped ops back. A resumed rebuild
  does not repeat the notice. `supersync-use-remote-crash-resume.spec.ts`
  covers the resume with nothing preserved.
- **UX:** no setting and no new component. It reuses the confirm dialog and
  the wording pattern of the content-conflict banner
  (`conflict-resolution.service.ts:1915-1933`). The existing Undo is not a way
  back to the stop (§2.5, Q4).
- **Size and rules 12–14:** small and generic, with no per-action branch
  (§5.2).

### (b) Quarantine the local op

Hold the op back from upload, apply the remote batch, tell the user, and offer
re-apply or discard.

- **Loss:** nothing, while the op is held. Meanwhile the device differs from
  all others by the held op's writes, including undeclared ones. That is the
  divergence the stop exists to prevent, now silent.
- **Discard** needs the remote values for the footprint, so it needs (a2)'s
  rebuild anyway.
- **Re-apply** re-sends the intent after the other side's op (constraint 4).
  For reorders, that is the §4.1 counterexample.
- **Released clients:** "held" is local only. But re-apply sends an intent
  they may replay differently.
- **Providers:** both need a "held" state, and every reader of the pending set
  would have to learn it. `getUnsynced(` and `getUnsyncedByEntity(` appear 32
  times in 16 non-spec files (grep, 2026-09-29).
- **Restart:** the held op replays, which is fine while it is held. Discard
  needs a correction row (constraint 1).
- **UX:** a new list of held changes with two actions, which can sit there
  forever. That is against "less noise" and "avoid feature creep".
- **Size:** the largest of the three.

Keep its one good idea: name the change, so the user can redo it by hand on
the converged state.

### (c) Resolve by timestamp for the footprint

- **Remote newer:** the same as (a).
- **Local newer:** the local intent must then win on every device.
  - Re-sending it runs into constraint 4.
  - Pushing its state runs into constraint 3. A new order op is a wire change
    that released clients cannot apply.
- Wall-clock skew makes the winner hard to predict. "Newer" also means little
  between a reorder and a pin.
- **Restart:** the losing local op still replays (constraint 1).

So (c) is (a) plus a branch that is either unsafe or a wire change. A proven
local-wins path for one crossing is a fix under rule 12, not a fallback.

### Comparison

|                  | Today                                   | (a2) narrowed Keep remote                   | (b) quarantine                              | (c) timestamp                           |
| ---------------- | --------------------------------------- | ------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| Lost             | all local or all remote since last sync | each dropped op, whole and named            | nothing until discard; divergence meanwhile | as (a), or divergence if local is newer |
| Converges        | yes, after a whole-dataset choice       | yes; carried-over crossings re-resolve (§6) | not while held; re-apply unproven           | only when remote is newer               |
| Released clients | unchanged                               | unchanged; nothing new sent                 | re-apply sends an unproven intent           | local-wins needs a wire change          |
| Restart          | n/a                                     | nothing to compensate                       | correction row on discard                   | correction row per losing op            |
| New UI           | none                                    | none (existing confirm and snack)           | held-changes list                           | a notice                                |
| Size             | none                                    | small                                       | large                                       | medium, plus an unsafe branch           |

## 5. Recommendation

Adopt (a2) in two steps, with the E2E first.

### 5.1 Reproduction first

The sync rules require this before any production change. The structural
reorder rule (§2.7) shrinks the set that reaches the stop; the fallback is the
safety net for what remains. The reproductions therefore use crossings that
stay unsupported by design and that the real UI reaches. `updateTask` with
`projectMoveSubTaskIds` is left out: per the audit, only the Electron REST API
and a navigation repair produce it.

1. Add `e2e/tests/sync/supersync-unsupported-conflict-fallback.spec.ts` with
   two real SuperSync clients, A and B, on a shared baseline.
2. **Crossing 1, bulk due-day update against a title edit.** One client has
   two or more tasks due today and sets Settings → General → Misc → **Start
   time of the next day** later than the (fixed) page time. The logical date
   moves back a day, so one `updateTasks` re-dates every task due today
   (`global-config.effects.ts:159-201`). The other client renames one of
   those tasks. Run it with the refused op local, then remote. In the local
   run, the setting change is carried over while its due-day update is
   dropped (§6).
3. **Crossing 2, archive → restore → re-archive against a title edit.**
   Without syncing, A runs Finish day for two or more done tasks, restores
   one of them from History, then runs Finish day again for it and another
   done task. `supersync-archive-conflict.spec.ts:455-527` drives the same UI
   up to the restore. B renames the restored task. The refused op is always
   local.
4. Before either crossing syncs, A renames an unrelated task and B adds a
   task. This proves that unrelated work survives.
5. Run both upload orders (who syncs first) and both timestamp orders.
6. **Red baseline:** `waitForSyncComplete` reports `conflict`
   (`e2e/utils/sync-helpers.ts:232-243`). Do not use `syncAndWait()`, which
   answers the dialog itself until #10341 lands. Record the failing run
   before any production change.
7. **Green criteria:**
   - no conflict dialog and no error snack;
   - no `SYNC_IMPORT`, `BACKUP_IMPORT` or `REPAIR`;
   - both unrelated edits present on both clients;
   - the crossing resolved to the remote side on both clients;
   - the dropped ops named once (for crossing 2, both Finish days, so every
     task they archived is active again);
   - after reloading both clients and a fresh third client, the same state
     everywhere and nothing left pending.
8. Repeat crossing 1 on WebDAV (`npm run e2e:webdav:file`).
9. Add a receiver on released v19.1.0 to show it consumes the carried-over
   ops. Follow the `COMPAT_OLD_ASSETS` pattern
   (`supersync-reorder-conflict-wedge.spec.ts:958`).
10. Add three edge runs:
    - a carried-over op on an entity the batch also changed (§6);
    - immediate upload left on, so some pending ops are already on the
      server (the setup helper blocks it, `supersync.page.ts:321-332`);
    - a reload after the replacement commits (extend
      `supersync-use-remote-crash-resume.spec.ts`).

### 5.2 Step 1: the scoped choice behind Resolve…

This step is user-triggered, so the first PR ships no automatic rebuild.

1. **Gate.** Check every plan instead of throwing at the first one. Collect
   the local op ids of each refused plan, and throw one error that carries
   them outside its message. The message stays as it is
   (`sync-errors.ts:146-170`). The superseded resolver passes the ids of its
   unprojected reorders. Both throw sites also flag any other pending
   multi-entity op that crossed the incoming ops (step 6). Collecting adds
   lines, so move the gate into its own file: the change must add no lines to
   `conflict-resolution.service.ts`.
2. **A new small service,** because the wrapper is at its cap. The existing
   branch (`sync-wrapper.service.ts:1137-1167`) calls it instead of
   `_handleDataConflict`, for this error only. The few lines that routing
   adds must move out of the wrapper in the same PR. `LocalDataConflictError`
   keeps today's dialog.
3. **Confirm first,** with the existing `DialogConfirmComponent`. Name the
   change and say that the device's other changes are kept. Its second
   button, relabelled through `cancelTxt`, opens today's dialog.
4. **Rebuild** through `forceDownloadRemoteState` with a new option. Inside
   the flushed exclusive section, where the crash-resume branch reads the
   pending ops (`operation-log-sync.service.ts:1994-2000`), it seeds
   `preservedLocalOps` with the pending local ops minus the dropped ids, in
   seq order. Seeding earlier would lose ops captured while the confirm was
   open, because the replacement clears every op. The option must fit the 8
   free lines, or move code out. Name only ops that are not in the
   downloaded history (constraint 5).
5. **Afterwards,** show one snack that names the dropped change. Unless Q4
   decides otherwise, skip the existing Undo snack and its boot-time
   re-offer. The pre-fallback snapshot stays in the backups list.
6. **Fall back to today's dialog** if any of these hold:
   - a full-state op is pending (carrying it over would replay it after the
     history, which is Keep local);
   - a rebuild marker exists;
   - another pending multi-entity op crossed the incoming ops (§6; generic
     and deliberately conservative);
   - the provider is unavailable;
   - the same remote head was already handled in this session.

Estimated size: 150–250 production lines, most of them in the new service,
plus unit specs. The estimate is not verified.

### 5.3 Step 2: automatic, approved separately

Run the same path from background sync, without the confirm, and keep one
calm notice that names the dropped change. This ends the sync stop and the
whole-dataset loss. The dropped change itself stays lost.

The contributor model lists today's USE_REMOTE flow as deliberately
unfenced. An automatic entry point must capture and thread the sync epoch
instead ([contributor model](../sync-and-op-log/contributor-sync-model.md),
"The sync-epoch fence").

### 5.4 Guardrails

- **Rule 14 stays as written.** The fallback is a safety net, not a
  resolution path that a PR may name. Otherwise it would start generating
  new crossings. Keep the error code in the log, so reports still arrive.
  Once step 1 ships, rule 14's "which ends in the whole-dataset dialog" and
  the matching sentence in the contributor model are out of date. Updating
  that wording is a separate AGENTS.md change.
- **Rule 12:** no action type is listed anywhere, and the guard in §5.2
  step 6 is generic. The rebuild does not care what the dropped op wrote.
  The gate stays: the fallback fixes no crossing.
- **Rules 10 and 11:** no schema bump, no new op type, and no new persisted
  field on synced models. The new rebuild option is local.

## 6. Risks

- **Full-history download on SuperSync** for large accounts, as Keep remote
  needs today. That is acceptable for a rare path; its duration was not
  measured.
- **Carried-over crossings.** A carried-over op that crossed an incoming op
  keeps its old clock, so it does not upload unchanged. This is traced in
  code, not run:
  - On SuperSync the server compares that clock with the entity's latest op
    (`conflict.ts:217-270`; the client sends the stored clock,
    `operation-log-upload.service.ts:676`) and rejects the op as concurrent.
    The rebuilt local clock does not help, because it only stamps new ops.
  - The rejection path then re-issues the entity's current state with a
    dominating clock (`superseded-operation-resolver.service.ts:603-651`).
    Devices converge, but the carried-over side wins by replay order, even
    over a newer remote edit of the same field.
  - For a multi-entity op that is not an archive, a delete or a causally
    projected reorder, that re-issue covers only its first entity (`:507-523`,
    [review §6](2026-09-26-sync-architecture-review.md#suspected-not-reproduced)).
    Hence the fall-back in §5.2 step 6. Dropping and naming such an op would
    also work, but loses more.
  - On file providers nothing is rejected. A receiver resolves a
    single-entity crossing by LWW (#9073,
    `conflict-resolution.service.ts:4216-4250`) and applies a multi-entity
    one in arrival order (`:4312-4342`). Both converge.
- **A carried-over op can depend on a dropped one.** Crossing 1 shows it: the
  start-of-day setting is carried over while the due-day update it triggered
  is dropped, so today's tasks now show as due tomorrow. Every device applies
  the same ops to the same state, so they converge, but not to what the user
  saw. The carry-over does not validate its result (§4), so a state that
  fails validation is repaired at the next validation, and that repair is a
  synced full-state op. A dropped create is not expected: every create
  declares only its own new id, which the other side can have touched only if
  that id is fixed in advance.
- **A carried-over op fails to apply** after the replacement has committed.
  The rebuild then throws "USE_REMOTE incomplete"
  (`operation-log-sync.service.ts:2349-2353`), and only the pre-replace
  snapshot remains. Step 1's confirm keeps a person involved until this is
  measured.
- **Masking:** a quiet fallback hides new crossings from users. The logged
  code and rule 14 are then the only signals left.
- **Released clients still stop.** A released client that then picks Keep
  local still replaces everyone's data.

## 7. Open questions

Each lists the options and the recommended default.

1. **Automatic step 2?** Keep the fallback user-triggered, or also run it
   from background sync. Default: user-triggered until step 1's E2E and one
   release show no second stop.
2. **Refused op is remote: drop or carry the plan's local edits?** Carrying
   keeps the user's edit and should converge (§6), but that is traced, not
   run. Default: drop and name them in step 1; carry once an E2E covers it.
3. **Naming:** by entity title where one exists, as the content-conflict
   banner does (escaped, never logged), or only by kind ("section order").
   Default: the title where one exists, otherwise the kind; at most three
   names, like the banner.
4. **Undo:** the existing Undo re-imports the pre-fallback snapshot as a
   synced `BACKUP_IMPORT`, which is Keep local under another name (§2.5).
   Offer it, or leave the snapshot in the backups list only. Default: the
   backups list only.
5. **Keep local for this error:** it destroys other devices' pending work.
   Keep it behind the second button, or hide it for this error. Default:
   keep today's dialog unchanged, so the fallback removes no way out.

## Appendix: file paths

- `src/app/op-log/sync/`: `conflict-resolution.service.ts`,
  `superseded-operation-resolver.service.ts`,
  `rejected-ops-handler.service.ts`, `remote-ops-processing.service.ts`,
  `operation-log-sync.service.ts`, `operation-log-upload.service.ts`,
  `immediate-upload.service.ts`,
  `sync-import-conflict-coordinator.service.ts`,
  `sync-import-conflict-gate.service.ts`, `reorder-conflict.util.ts`
- `src/app/op-log/core/errors/sync-errors.ts`
- `src/app/op-log/persistence/`: `operation-log-hydrator.service.ts`,
  `operation-log-store.service.ts`
- `src/app/op-log/backup/backup.service.ts`
- `src/app/op-log/clean-slate/clean-slate.service.ts`
- `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts`
- `src/app/op-log/testing/integration/`:
  `reorder-conflict-wedge.integration.spec.ts`
- `src/app/imex/sync/sync-wrapper.service.ts`
- `src/app/imex/sync/dialog-sync-conflict/dialog-sync-conflict.component.ts`
- `src/app/features/config/store/global-config.effects.ts`
- `src/app/root-store/meta/task-shared-meta-reducers/`:
  `lww-update.meta-reducer.ts`
- `src/assets/i18n/en.json`
- `packages/super-sync-server/src/sync/conflict.ts`
- `eslint.config.js` (repository root)
- `e2e/utils/sync-helpers.ts`, `e2e/pages/supersync.page.ts`
- `e2e/tests/sync/`: `supersync-archive-conflict.spec.ts`,
  `supersync-reorder-conflict-wedge.spec.ts`,
  `supersync-use-remote-crash-resume.spec.ts`,
  `webdav-conflict-use-remote-restore-8107.spec.ts`
