# SuperSync: remove lingering onboarding example tasks from local state on first adoption

**Issue:** #7996 (follow-up to #7995 → #7985 → #7976/#7980)
**Date:** 2026-06-03
**Status:** **Implemented (2026-06-03)** on `feat/issue-7996-3b222c` after #7995 merged to
`master` (PR #7995, commit `3e58b6d8d2`) and this branch was fast-forwarded. **Final mechanic
is the `meta.isRemote` dispatch — see §9, which supersedes the A1 "generate-then-reject" design
in §3** (a second multi-review found the simpler primitive). Unit
(`operation-log-sync.service.spec.ts`, +3) specs green; the op-log integration spec
(`example-task-adoption-cleanup.integration.spec.ts`) keeps its #7995 cases (the #7996 half is
a pure NgRx dispatch with no op-log effect); e2e (`#7996` test added to
`supersync-example-task-fresh-client.spec.ts`) authored — **docker-only, run in a real shell**
(reproduce-first: local-store-clean assertion fails pre-fix). Decision was (b) sequence after
#7995.
**Area:** op-log sync (`src/app/op-log/sync/operation-log-sync.service.ts`)

---

## 0. Hard prerequisite — this builds on #7995, which is NOT yet merged

#7996 extends the **`uploadPendingOps` identity-based cleanup hook added by PR #7995**
(branch `feat/issue-7985-7f39b1`, still **OPEN**). That hook does not exist on `master`
nor on this worktree's base. What master/this branch already has (from #7976/#7980) is the
_older_ `_discardExampleTaskOps` call on the **piggyback** path (`operation-log-sync.service.ts:284`)
and the `isNeverSynced` threading — **not** the new pre-upload cleanup block.

The #7995 hook we extend sits just after the `isWhollyFreshClient` guard in `uploadPendingOps`
(reproduced below; note #7995 imports `isExampleTaskCreateOp` from
`op-log/validation/is-example-task-op.util`, it is not inline):

```ts
if (isNeverSyncedAtSyncStart && (await this.opLogStore.hasSyncedOps())) {
  const pendingOps = await this.opLogStore.getUnsynced();
  const isPristinePostBootBatch = pendingOps.every(
    (entry) => isExampleTaskCreateOp(entry) || entry.op.entityType === 'GLOBAL_CONFIG',
  );
  if (isPristinePostBootBatch) {
    const exampleOpIds = pendingOps.filter(isExampleTaskCreateOp).map((e) => e.op.id);
    if (exampleOpIds.length > 0) {
      await this._discardExampleTaskOps(exampleOpIds);
      OpLog.normal(/* … discarded N untouched example-task op(s) … */);
    }
  }
}
```

**Sequencing decision required (pick one before coding):**

- **(a) Land #7996 on top of `feat/issue-7985-7f39b1`** and merge it together / right after #7995.
- **(b) Wait for #7995 to merge to `master`, then rebase this branch** and implement.

There is a **third option raised in review and worth serious consideration:**

- **(c) Fold #7996 INTO #7995.** #7995 rejects the example _create ops_; #7996 removes the
  _entities those ops created_. They are two halves of one invariant — _a never-synced adopter
  ends up with neither the example ops nor the example entities_. Shipping #7995 alone merges a
  **knowingly-incomplete fix with a live re-pollution vector** (the lingering entities re-upload
  on the next snapshot). Folding also dissolves this entire §0 sequencing/duplicate-guard problem
  and lets one integration spec assert the complete end state.

**Trade-off:** (b)/(c) keep the diff clean and the fix complete; (c) may delay #7995 if it is
already close to merge. This is a **decision for the maintainer** (see "Decision needed" at the
end). Whichever path: **do not** re-implement the #7995 hook standalone on this branch — that
creates a conflicting duplicate. Also note `feat/issue-7985-7f39b1` carries unrelated
onboarding/dialog changes, so option (a) "branch on top of it" inherits that noise. This plan
assumes the #7995 hook is present.

---

## 1. Problem (one paragraph)

#7995 stops a never-synced client from **uploading** its 4 onboarding example-task create ops
onto a populated remote it just adopted. But on the **SuperSync (op-based)** path, adoption
_merges_ remote ops into the existing NgRx store (`RemoteOpsProcessingService.processRemoteOps`),
it does **not** replace it. So the example **tasks themselves stay in local NgRx state** — only
their op-log create ops were rejected. Two harms:

1. **Cosmetic:** the just-onboarded device shows 4 example tasks the other devices don't have.
2. **Re-pollution vector (the real reason):** the examples live in NgRx but not on the server.
   A later **full-state snapshot upload** — `forceUploadLocalState` (USE_LOCAL conflict choice)
   or enabling encryption (`SYNC_IMPORT` with `isCleanSlate: true`) — snapshots current NgRx
   (incl. the lingering examples) and re-uploads them, re-polluting the remote.

The file-based path (Dropbox/WebDAV) does not have this residual because snapshot hydration
_replaces_ NgRx state wholesale.

**Why local-state removal is the only viable layer (the decisive architectural fact).**
`isExampleTask` lives **only on the op-log create op, never on the NgRx `Task` entity**
(`example-tasks.service.ts:96-102` sets it on the `addTask` action; the resulting entity is
byte-identical to a real task). So by the time `forceUploadLocalState` builds its snapshot via
`getStateSnapshotAsync()` (`server-migration.service.ts:174-178`), example and real tasks are
**indistinguishable** — you cannot filter them out at the snapshot layer without re-deriving
identity from the (already-rejected) op-log create ops, which is strictly more coupling than
just deleting the entities. This rules out every "fix it at the upload/snapshot layer" shortcut
and is the real load-bearing reason the fix must touch local NgRx state. Re-pollution — not the
cosmetic clutter — is the harm that justifies the change.

## 2. Goal / acceptance criteria (from the issue)

- After a never-synced SuperSync client adopts a populated remote, the onboarding example tasks
  are **absent from local NgRx state**, with no dangling list references (`project.taskIds`,
  `backlogTaskIds`, tag `taskIds`).
- No example task — and no delete-of-example op — reaches the server.
- A subsequent `forceUploadLocalState` / enable-encryption from that device does **not**
  re-introduce example tasks to the remote.
- Real or edited data is untouched; the gate still skips when any non-config op is pending.

---

## 3. Chosen approach — **Option A1: surgical delete via meta-reducer, reject the generated Delete op**

Extend the **same** #7995 guarded block (`isNeverSyncedAtSyncStart && hasSyncedOps()` + pristine
post-boot batch + `exampleOpIds.length > 0`). After rejecting the create ops, also:

1. Derive the example **task ids** from the _same pending example-create ops_ (their `entityId`,
   never from remote ops — `isExampleTask` lives only on the local op).
2. Dispatch `TaskSharedActions.deleteTasks({ taskIds })` — a single bulk action that the
   **task-shared delete meta-reducer** (`handleDeleteTasks`, `task-shared-crud.reducer.ts:377`)
   handles in one reducer pass: removes the tasks (+ any subtasks) and scrubs every
   `project.taskIds` / `backlogTaskIds` / tag `taskIds` reference. (Complies with sync rule #3:
   one multi-entity change = one meta-reducer pass = one op, **not** an effect fan-out.)
3. `await this.writeFlushService.flushPendingWrites()` so the captured Delete op is persisted.
4. Reject that Delete op too (so we never upload a delete for a task the server never had).
   **Primary strategy — snapshot-and-diff:** capture the set of unsynced op ids _before_ the
   dispatch, then after the flush reject only the _new_ `Delete` op ids. This is robust by
   construction (it does not rely on "only ours can be present") — and since the create ops are
   already rejected before the snapshot, they are excluded from both sides of the diff, so the
   sole new unsynced `TASK`/`Delete` op is the cleanup one.

**Load-bearing safety invariant (do not omit from code comments).** The genuine hazard here is
**not** flush latency — it is capture _deferral_. The capture meta-reducer _buffers_ (does not
enqueue) any persistent action while `isApplyingRemoteOps` is true
(`operation-capture.meta-reducer.ts:226-233`), and `flushPendingWrites()` drains only the
_enqueued_ queue, never the deferred buffer. If this dispatch ran inside the apply window, the
Delete op would be silently deferred and never appear in `getUnsynced()`. It is safe **only
because** the download/merge phase fully completes — `replayOperationBatch` calls
`endApplyingRemoteOps()` + awaits `processDeferredActions()` in its `finally` — _before_
`uploadPendingOps` runs (`sync-wrapper.service.ts` download@~467 → upload@~493). State this
explicitly in the code comment so a future reordering that runs this hook inside the apply
window is caught in review, and assert it in the integration spec.

### Sketch (inside the existing `if (exampleOpIds.length > 0) { … }`)

```ts
await this._discardExampleTaskOps(exampleOpIds); // #7995 — reject the create ops

// #7996: also remove the untouched example tasks from local NgRx state, so op-based
// adoption matches the file-based replace semantics. Ids come ONLY from the local pending
// example-create ops (never remote). Without this the examples linger in NgRx and a later
// forceUploadLocalState / enable-encryption snapshot would re-pollute the remote.
const exampleTaskIds = pendingOps
  .filter(isExampleTaskCreateOp)
  .map((e) => e.op.entityId)
  .filter((id): id is string => !!id);
if (exampleTaskIds.length > 0) {
  const unsyncedBefore = new Set(
    (await this.opLogStore.getUnsynced()).map((e) => e.op.id),
  );
  this.store.dispatch(TaskSharedActions.deleteTasks({ taskIds: exampleTaskIds }));
  await this.writeFlushService.flushPendingWrites();
  const cleanupDeleteOpIds = (await this.opLogStore.getUnsynced())
    .filter((e) => !unsyncedBefore.has(e.op.id) && e.op.opType === OpType.Delete)
    .map((e) => e.op.id);
  await this._discardExampleTaskOps(cleanupDeleteOpIds);
}

OpLog.normal(/* … cleaned N example task(s) from local state (#7996) … */);
```

New imports in the service: `TaskSharedActions` (`root-store/meta/task-shared.actions`) and
`OpType` (`../core/operation.types`). `Store` and `writeFlushService` are already injected.

### Why A1 over the alternatives

| Approach                             | Mechanic                                                                                                                                | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1 (chosen)**                      | delete via meta-reducer, then reject the captured Delete op                                                                             | self-contained; reuses existing `_discardExampleTaskOps`/`flushPendingWrites`/`getUnsynced`; matches the issue text; worst case is one harmless extra rejected op                                                                                                                                                                                                                                                                                                                            |
| **A2: "suppress" capture**           | wrap the dispatch in `HydrationStateService.start/endApplyingRemoteOps()`                                                               | **Does not work as imagined.** Review found that flag _defers_ (buffers → reprocesses via `processDeferredActions()`), it does **not** suppress — so the Delete op is still created, just later and at an unpredictable time. There is **no clean "dispatch-without-capture" primitive** in the codebase today; adding one is scope creep. Combined with the process-global flag's blast radius (a missing `finally` → permanent silent capture loss), A2 is strictly worse than A1. Reject. |
| **B: replace-not-merge on adoption** | for a never-synced client adopting a populated remote, `loadAllData(default)` then apply remote ops (mirror `forceDownloadRemoteState`) | conceptually cleanest ("never-synced adoption replaces, not merges") but rewrites the core adoption path, must reason about concurrent local ops + sync rule #7, and risks data loss for a standalone user who built real offline tasks before connecting. Out of scope here; revisit only if merge-vs-replace is worth unifying.                                                                                                                                                            |

---

## 4. Safety / invariants

- **Gate is unchanged** — fires _only_ on `isNeverSyncedAtSyncStart` (pre-download capture) +
  `hasSyncedOps()` true now (download adopted remote ops this cycle) + **pristine post-boot
  batch** (only example creates + `GLOBAL_CONFIG` writes). Any real work — edit, reorder
  (`Move`), real task, real project — adds a non-config op, fails the pristine check, and
  skips cleanup entirely. An **edited example still syncs as real data** (#7995 property,
  preserved untouched).
- **Ids derived from local pending example-create ops only** — never from remote ops. A
  remote-supplied `isExampleTask` flag can never reach this path (it isn't read here).
- **No dangling references** — `handleDeleteTasks` is the proper meta-reducer; it scrubs
  `project.taskIds`, `backlogTaskIds`, and all tag `taskIds`, and follows `subTaskIds`
  (example tasks are flat top-level INBOX tasks, but this is defensive).
- **Real data untouched** — `handleDeleteTasks` no-ops on ids absent from state, and we only
  pass the 4 example ids. Non-example tasks are never in `exampleTaskIds`.
- **No example delete reaches the server** — the captured bulk Delete op is rejected via
  `markRejected`, which sets `rejectedAt`; `getUnsynced()` filters `!rejectedAt`, so the upload
  that follows (line ~205) never sends it.
- **File-based path safe** — if the hook ever fires for a file-based client whose examples were
  already replaced by snapshot hydration, the `deleteTasks` dispatch is a no-op on absent ids
  and the Delete op (if captured) is rejected. No harm.
- **Sync rules:** #1 (no `Actions` in effects — N/A, this is orchestration not an effect),
  #3 (multi-entity change via meta-reducer ✓), #6 (single dispatch, not a 50+ loop —
  `flushPendingWrites` already serializes; review confirmed no extra `setTimeout(0)` yield is
  needed), #9 (log only ids/counts, never task titles).
- **Effects that observe `deleteTasks` (all `LOCAL_ACTIONS`, all `{ dispatch: false }` — verified
  no op fan-out, rule #1 holds):** `issue-two-way-sync` (reads a sidecar that the bare action
  leaves empty → no-op), `time-block-sync`, `task-reminder` (Android native-reminder cancel),
  and `plugin-hooks` which **fires `PluginHooks.TASK_DELETE`** for the example ids. The plugin
  hook is the one real observable side effect — benign (plugins also saw the adds), but the plan
  does **not** claim "nothing reacts": confirm no installed onboarding plugin reacts destructively
  to `TASK_DELETE`.
- **Vector clock:** rejecting both the create and the cleanup Delete leaves the local clock
  advanced without uploading either — identical to the already-accepted behavior of the existing
  `_discardExampleTaskOps` (which rejects creates). Benign: the local clock legitimately dominates
  and the server never references these entities; no `setVectorClock` reset is needed (unlike
  `forceDownloadRemoteState`). The integration spec should still assert a subsequent real op
  uploads cleanly after cleanup (entity-frontier sanity).

---

## 5. Open questions / must-verify before/while coding

1. **The existing #7976 e2e already asserts examples are gone after SuperSync adoption**
   (`supersync-example-task-fresh-client.spec.ts:104-106`), yet #7996's premise is that op-based
   merge _leaves them present_. SuperSync e2e is docker-only and **never runs in CI**, so that
   assertion is **unverified and likely cannot pass until #7996 lands**. → Treat #7996 as the
   change that _makes the existing assertion true_, and confirm by running that spec on docker
   **before** the change (expect FAIL at 104-106) and after (expect PASS). If it already passes
   pre-change, the premise is wrong and the whole approach must be re-examined.
2. **Capture timing — the real risk is deferral, not flush latency** (see the load-bearing
   invariant in §3). The dispatch must run with `isApplyingRemoteOps === false`, else the Delete
   op is buffered and `flushPendingWrites()` won't surface it. This holds because download
   completes before upload, but it is implicit — pin it in the integration spec (assert the
   Delete op is in `getUnsynced()` _after_ `flushPendingWrites()` resolves) and guard against a
   future reordering.
3. **Bulk op shape.** Confirm `deleteTasks` produces exactly one `Delete`/`TASK`/`isBulk` op
   (not N single ops). If it fans out to N ops, the "reject new Delete ops" diff still catches
   all of them — but the assertion in the unit test must match the real count.
4. **Will the example tasks actually be in NgRx at hook time?** On the adoption path the
   download (merge) ran before `uploadPendingOps`, and merge does not remove local tasks, so
   yes. Confirm in the integration/e2e spec rather than by argument.

---

## 6. Test plan

> **Dependency note:** the "extend #7995's added cases" framing only holds if #7995 has landed
> (§0). On the _current_ branch these unit cases and the integration spec below **do not exist**
> (the spec's current example-task tests cover the _incoming-download_ path, not the upload
> pristine-batch hook) — they would be authored from scratch. State the #7995 dependency inline
> for whoever implements.

### Unit — `operation-log-sync.service.spec.ts` (extends #7995's added cases)

- **Fires (happy path):** never-synced + `hasSyncedOps()` true + pristine example+config batch →
  asserts (a) `store.dispatch` called with `TaskSharedActions.deleteTasks({ taskIds: <4 example ids> })`,
  (b) `markRejected` called for both the create ops **and** the cleanup Delete op,
  (c) the example task ids come from the local create ops' `entityId`,
  (d) **the `GLOBAL_CONFIG` op is NOT rejected** (it uploads normally — mirror the existing
  empty-case assertion that the config op survives).
- **Scoping proof:** with a hypothetical pre-existing unsynced non-example op present in
  `unsyncedBefore`, assert the cleanup does **not** reject it — proving the snapshot-and-diff
  actually scopes the rejection to the new Delete op.
- **Does NOT fire** when: already-synced at start; nothing adopted (`hasSyncedOps()` still false);
  a real (non-example) task op present; a reorder `Move` present; an edited-example op present
  (each must skip the dispatch entirely). These mirror the #7995 truth-table — extend them to
  also assert **no** `deleteTasks` dispatch.
- **Op-count:** `deleteTasks` is a single bulk op (`isBulk`), so expect exactly **1** new
  `Delete`/`TASK` op, not N.
- Mock note: `provideMockStore`'s `dispatch` does not run the real meta-reducer/capture, so the
  spec mocks `opLogStore.hasSyncedOps()`, adds a `writeFlushService.flushPendingWrites` spy, and a
  two-stage `getUnsynced()` (before-dispatch / after-dispatch returns the new Delete op). The
  capture→flush→reject chain is only _truly_ exercised by the integration spec below.

### Integration — `op-log/testing/integration/example-task-adoption-cleanup.integration.spec.ts`

#7995 added this against the **real** `OperationLogStoreService` to prove the pre-download-capture
vs live-read sequencing. Extend it to assert the **end-to-end op-log result** after the full
hook: example create ops rejected **and** the cleanup Delete op rejected, with the config op left
unsynced (uploads normally). Specifically pin:

- the Delete op is present in `getUnsynced()` **after `flushPendingWrites()` resolves** (the
  load-bearing sequencing from §3 / §5.2), then is rejected;
- the captured delete is exactly **one** bulk op (§5.3);
- **a subsequent real op still uploads** after cleanup (entity-frontier sanity — guards the
  vector-clock-residue concern in §4).
  This is where the capture-deferral/flush and bulk-op-shape questions get pinned against
  production code (the unit spec cannot, per the mock note).

### e2e — `e2e/tests/sync/supersync-example-task-fresh-client.spec.ts` (docker; real shell only)

**Test 1 — adoption leaves a clean local store + no propagation.** Never-synced client adopts a
populated **non-encrypted** account:

1. Seeder seeds via normal upload (no SYNC_IMPORT) — the exact #7980 residual case (verified:
   the seeder is itself fresh, so `ServerMigrationService` bails the migration and the remote is
   populated by plain Create ops, no full-state op).
2. Fresh client (example tasks on) adopts silently (`waitForInitialSync:false`, expect `complete`).
3. **Local store clean:** none of the 4 example titles present (this is the existing 104-106
   assertion — currently _fails_ pre-#7996 because merge keeps the examples; #7996 makes it pass).
4. **Server clean (no propagation):** spin up a **3rd observer client** (`createSimulatedClient`
   - `setupSuperSync` + sync) that re-downloads and asserts none of the 4 example titles appear —
     this is the established harness pattern (cf. `supersync-late-join` / `import-other-client-ops`);
     there is no server-state-inspection API, so the observer is the only way to assert this.

**Test 2 (separate `test()`) — no re-pollution via snapshot upload.** This guards the _actual_
harm (§1.2), so it must not be a tail step of Test 1 (a flake in adoption must not mask a
re-pollution regression):

1. Reach the adopted state (as Test 1).
2. Trigger a full-state snapshot upload from the fresh client — `forceUploadLocalState`
   (USE_LOCAL conflict choice) **or** enable encryption (`SYNC_IMPORT`, `isCleanSlate`).
3. Re-download from a fresh observer client → assert **still no example tasks**.

> Cannot run docker SuperSync e2e in the agent sandbox (memory:
> `reference_supersync_e2e_docker_sandbox`). Author the spec, run it in a real shell, and
> verify reproduce-first (FAIL pre-change at the local-store-clean assertion, PASS after).
> Also update the file-level docblock: the file currently documents itself as a #7976
> _conflict-dialog_ regression; the new tests assert _local-state cleanup_ — keep the two
> purposes distinct so a future maintainer doesn't read 104-106 as a #7976 guarantee.

### Checks

`npm run checkFile <path>` on every touched `.ts`; `npm run test:file
src/app/op-log/sync/operation-log-sync.service.spec.ts` and the integration spec.

---

## 7. Risks & confidence

- **Confidence in approach: ~85%** (raised after multi-review confirmed the core facts). Verified:
  the #7995 hook shape, the delete meta-reducer scrubbing refs + no-op-on-absent-ids
  (`task-shared-crud.reducer.ts:377`), `deleteTasks` being a single bulk op with `OpType.Delete`
  (`task-shared.actions.ts:82`), `getUnsynced()` excluding rejected ops, the capture
  enqueue→flush write path _and_ the deferral hazard it must avoid, the `isExampleTask`-only-on-op
  fact (rules out snapshot-layer fixes), example tasks being flat top-level INBOX tasks, the
  five `deleteTasks` listeners (all `dispatch:false`, only the plugin hook observable), and the
  §5.1 merge-keeps-examples premise (confirmed by the #7995 commit message itself).
- **Unsure / risks:**
  - The #7995-dependency sequencing/fold decision (§0) — the single biggest practical blocker;
    a process decision, not a code risk. **Maintainer's call (see below).**
  - The e2e premise (§5.1) reads as verified statically, but the docker-only e2e cannot run in
    CI; settle it empirically (reproduce-first) before trusting the test direction.
  - The capture-deferral invariant (§3) is the subtle correctness lynchpin — safe today, but
    must be commented + asserted so a future reorder can't silently lose the delete.
  - A third-party onboarding plugin reacting to `TASK_DELETE` (§4) — confirm none does.
- **Out of scope:** Option B's merge-vs-replace unification; any change to the gate condition
  itself (inherited unchanged from #7995); encrypted-account behavior (already handled by the
  incoming-`SYNC_IMPORT` discard path).

---

## 8. Decision needed (maintainer)

**Sequencing/structure of the change relative to PR #7995.** Pick one before implementation:

- **(c) Fold #7996 into #7995** — one complete fix ("adopter keeps neither example ops nor
  entities"); avoids merging a half-fix with a live re-pollution vector; dissolves §0. May delay
  #7995.
- **(b) Land #7995, then implement #7996 as a rebased follow-up** — keeps #7995 reviewable;
  accepts a short window where the re-pollution residual exists on merged master.
- **(a) Branch #7996 on top of `feat/issue-7985-7f39b1` now** — fastest to start, but inherits
  that branch's unrelated changes and re-resolves #7995 review churn.

Review leaned (c) on correctness grounds, (b) on reviewability. Either (b) or (c) is sound; (a)
is the least clean.

**Decision (2026-06-03): (b).** #7995 merged to `master` (`3e58b6d8d2`); this branch was
fast-forwarded and #7996 implemented on top as a clean increment.

---

## 9. Implementation note — final mechanic differs from A1 above (post-multi-review)

The shipped code does **not** use the "generate a Delete op then reject it" dance described
in §3. A second multi-review surfaced that the codebase already has the right primitive: a
`meta.isRemote` action is skipped by the capture meta-reducer
(`operation-capture.meta-reducer.ts:222`, checked _before_ the `isApplyingRemoteOps` branch)
and filtered out of `LOCAL_ACTIONS` (`local-actions.token.ts:51`) — the same primitive
`ValidateStateService` and the op-replay path use. So `_removeAdoptedExampleTasksFromState`
simply dispatches `TaskSharedActions.deleteTasks({ taskIds })` with `meta.isRemote: true`:

- the state reducers still run (scrubbing `project.taskIds`/backlog/tag refs), but
- **no Delete op is ever captured** → nothing to reject, no `flushPendingWrites`, no
  snapshot-diff, and the §3 capture-deferral invariant becomes irrelevant; and
- the `plugin TASK_DELETE` / reminder `LOCAL_ACTIONS` effects don't fire — closing the §4
  open question outright.

This is strictly simpler and lower-risk than A1, so it superseded it. The §3 prose is kept
for the design rationale (why touch local state at all), but the mechanic is the `isRemote`
dispatch.
