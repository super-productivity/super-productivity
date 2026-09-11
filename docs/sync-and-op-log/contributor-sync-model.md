# The Contributor Sync Model

**The one thing to understand before writing any effect, reducer, or bulk
dispatch that touches synced state.**

Super Productivity syncs by replaying an operation log. Almost every sync
correctness rule you will hit is a facet of a **single invariant**:

> ## Each replay-atomic transition (normally one persistent action) = exactly one operation. Replayed and remote operations must never re-trigger effects.

“Intent” here means the transition that must remain indivisible during replay,
not necessarily an entire multi-step UI workflow. A workflow may deliberately
compose independent persistent actions when their normal local side effects and
per-entity conflict boundaries are part of the required behavior.

Reducers **must** run for remote/replayed operations (that is how state is
rebuilt). Effects **must not** — the UI side effect (snack, sound, navigation)
already happened on the originating client, and every persistent transition the
workflow deliberately emitted already has its own entry in the operation log.
Re-running effects on replay duplicates side effects and emits phantom
operations that conflict with sync.

Everything below is that invariant applied at three points.

---

## Boundary 1 — The action boundary

**Effects inject `LOCAL_ACTIONS`, never `inject(Actions)`.**

`LOCAL_ACTIONS` is the standard actions stream with `meta.isRemote` filtered
out (`src/app/util/local-actions.token.ts`). Remote/replayed operations are
applied as one `bulkApplyOperations` action; `LOCAL_ACTIONS` ensures your effect
only sees genuine local user intent.

- Default for **all** effects: `private _actions$ = inject(LOCAL_ACTIONS);`
- The only legitimate exception uses `ALL_ACTIONS` and handles `isRemote`
  itself: `operation-log.effects.ts` (captures/persists every action). You are
  almost certainly not adding a second.
- Remote **archive** side effects are _not_ an `ALL_ACTIONS` case:
  `archive-operation-handler.effects.ts` itself uses `LOCAL_ACTIONS`; the
  remote-client archive writes/deletes are driven separately by
  `OperationApplierService` → `ArchiveOperationHandler`.

✅ **Enforced by `local-rules/no-actions-in-effects`** — you cannot get this
wrong; the linter rejects `inject(Actions)` / `Actions` imports in
`*.effects.ts`.

**The reducer-side mirror: a reducer handling a _non-persistent_ action must
not write synced entity fields.** Capture builds operations from action
payloads, not from state diffs, so such a write never becomes an op — the local
device drifts from every other device with no conflict to detect, and
`getPhantomChangeRisk()` cannot see it either. Not lint-enforced. If a
UI-pointer action (`setCurrentTask`, `setSelectedTask`, …) needs to change task
data, dispatch a persistent action from a `LOCAL_ACTIONS` effect instead
(`TaskInternalEffects.reopenStartedDoneTask$`, #9904).

## Boundary 2 — The selector boundary

**Selector-driven mutating effects must guard the sync window. Choose whether
the source may be dropped or must be deferred.**

An effect that reacts to a _selector_ (store state) instead of a specific
_action_ bypasses Boundary 1 entirely — it fires on every store change,
including hydration and sync replay. Two timing gaps (initial startup before
first sync; the post-sync re-evaluation window) make such effects emit
operations with stale vector clocks that immediately conflict.

- Use `skipDuringSyncWindow()` only for a **level/repeating** source whose next
  emission safely retries the work. It deliberately drops emissions.
- Use `waitForSyncWindow()` for a **sparse or edge-triggered** source when a
  dropped emission cannot be recovered. A store selector normally ends in
  `distinctUntilChanged()`, so the value that changed during sync may never
  re-emit after the window closes.
- **`waitForSyncWindow()` does not gate initial sync.** It observes only
  `HydrationStateService.isInSyncWindow()`, so it passes immediately when that
  window is closed even if the initial-sync gate has not opened.
  `skipDuringSyncWindow()` is different: it also checks
  `SyncTriggerService.isInitialSyncDoneSync()`. A sparse mutating effect that
  must wait for startup sync therefore needs both gates:

  ```typescript
  return this._syncTriggerService.afterInitialSyncDoneStrict$.pipe(
    first(),
    switchMap(() =>
      sparseSource$.pipe(
        // Capture all state required by the edge before deferring it.
        map((edge) => captureRequiredState(edge)),
        waitForSyncWindow(this._hydrationState, 'MyEffects:mutatingEffect$'),
        // ...perform the mutation
      ),
    ),
  );
  ```

  This is the established composition used by
  `TaskDueEffects.createRepeatableTasksAndAddDueToday$` and
  `TaskRepeatCleanupEffects.cleanupDuplicateRepeatInstances$`. Use
  `afterInitialSyncDoneAndDataLoadedInitially$` instead only when its
  non-strict UI-readiness semantics are intentional; neither gate is proof
  stronger than the failsafes documented by `SyncTriggerService`.

- Before waiting, combine/map the edge with every piece of state needed to
  handle it. Process that captured snapshot after the window closes; do not
  wait and then reconstruct an already-passed edge from unrelated live state.
  `waitForSyncWindow()` keeps only the latest pending value, so it is not the
  right operator when every individual emission must be preserved.
- `waitForSyncWindow()` is fail-open after 30 seconds: it logs the timeout and
  emits even if the sync window is still active. It prevents a sparse trigger
  from being lost during ordinary short syncs, but it is **not** a hard
  mutual-exclusion boundary. If a mutation must never overlap replay, prefer a
  `LOCAL_ACTIONS`-driven effect or redesign it around a fail-closed boundary
  rather than relying on this operator.
- The narrower `skipWhileApplyingRemoteOps()` /
  `HydrationStateService.isApplyingRemoteOps()` exist for finer control.
- **Prefer action-based effects.** A selector-based effect is the
  intuitive-but-usually-wrong choice; reach for it only when there is no
  action to key off.

✅ **Enforced by `local-rules/require-hydration-guard`** (existing rule).

## The atomicity rule — one replay-atomic transition, one op

**Multi-entity changes are meta-reducers, not effects. Bulk dispatch loops yield.**

- A transition that must replay atomically and touches more than one entity
  (e.g. deleting a tag also removing it from every task) must be **one reducer
  pass** so it becomes **one operation**. Put it in
  `src/app/root-store/meta/task-shared-meta-reducers/`, not in an effect that
  dispatches a fan-out of follow-up actions. An effect-based fan-out emits N
  operations for one atomic transition _and_ re-runs on replay (a restatement
  of Boundary 1).
- Do not collapse a broader UI workflow merely because it starts with one user
  gesture. Independent actions are appropriate when their normal local effects and
  entity-specific conflict boundaries matter. Project completion intentionally
  resolves tasks through ordinary per-task actions before flipping the project
  flag, accepting an unbounded N+1 operation count and a brief intermediate state.
  That is a known scalability residual for this rare semantic exception, not a
  precedent for new bulk fan-out; see
  [ADR #5: Project Completion](../../ARCHITECTURE-DECISIONS.md#5-project-completion-decoupled-resolution-over-atomic-multi-entity-op).
- `store.dispatch()` and NgRx reducers run synchronously; only the op-log
  persistence triggered by capture is asynchronous. After a loop of 50+
  dispatches, add one post-loop macrotask yield,
  `await new Promise((r) => setTimeout(r, 0))`, to protect capture ordering
  before a dependent follow-up action. It does not chunk or bound main-thread
  reducer work, and it does not reduce the N+1 upload amplification.

⚠️ `local-rules/no-multi-entity-effect` (`warn`) flags this heuristically — it
catches the array-literal fan-out shape (`map(() => [a(), b()])`), not every
multi-entity dispatch (e.g. a `of(a(), b())` varargs fan-out slips past). The
blessed pattern is a `task-shared-meta-reducers/` reducer.

---

## Clearing a field — `undefined` does not survive the wire (#9776)

**Never rely on `changes: { someField: undefined }` reaching another device.**
`JSON.stringify` drops undefined-valued keys from the op payload (SuperSync
HTTP/E2EE, file-based providers, the SQLite op-log — everything except the
IndexedDB structured clone), so a reducer that applies `changes` verbatim
replays the clear as a no-op remotely. The local device looks correct, which is
exactly why this class of bug survives testing.

Safe patterns, in order of preference:

1. **Set the `undefined` inside a reducer/meta-reducer** keyed off a dedicated
   action whose payload carries only ids (e.g.
   `TaskSharedActions.dismissReminderOnly` → `remindAt: undefined` in the
   reducer). Deterministic on replay; nothing to serialize.
2. **Rebuild `changes` from destructured payload fields** — a dropped key
   destructures back to `undefined` identically (e.g. `scheduleTaskWithTime`).
3. For generic `Update<T>` actions, **list cleared keys out-of-band**: the
   action creator adds `clearedFields` via `clearedFieldsProps()` and the
   reducer restores them with `applyClearedFields()`
   (`src/app/util/cleared-update-fields.ts`; used by `updateTaskUi` and
   `updateTaskRepeatCfg`). Old clients ignore the extra prop, so the clear
   degrades to a no-op there instead of corrupting state — no schema bump.

On the conflict-resolution side, `createLWWUpdateOp` never lists
`clearedFields` unless the call site opts in via `listClearedFields` — today
only the disjoint-merge delta does, re-declaring clears the conflicting ops
themselves carried. Patch payloads built from **live state** (e.g.
`taskRelationshipPatch`) materialize accidental `undefined` keys — every root
task's `parentId` — and must never opt in: listing those would broadcast a
real clear to receivers (pinned by tests (a0c) in
`conflict-resolution.disjoint-merge.spec.ts` and the relationship follow-up
pin in `conflict-resolution.service.spec.ts`).

Do **not** invent in-band sentinels (`null`, `0`, marker strings): remote
reducers apply payload values verbatim, so released clients would persist the
sentinel and fail typia state validation.

---

## Decision table — "I'm writing an effect"

| Question                                                        | Answer                                                                                                    | Linter                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Does it inject the actions stream?                              | Use `LOCAL_ACTIONS` (not `Actions`)                                                                       | ✅ `no-actions-in-effects` (error)               |
| Can a selector emission be safely retried by the next emission? | Drop it with `skipDuringSyncWindow()`                                                                     | ✅ `require-hydration-guard` (error)             |
| Is the selector emission a sparse/unrecoverable edge?           | Enter through the required initial-sync gate, capture its state, then defer it with `waitForSyncWindow()` | ✅ window guard only; initial gate is convention |
| Does one replay-atomic transition change **>1 entity**?         | Make it a meta-reducer, not an effect                                                                     | ⚠️ `no-multi-entity-effect` (warn)               |
| Does it dispatch in a **loop of 50+**?                          | Yield once afterward for capture ordering; it is not batching                                             | — (convention)                                   |

Two of the three are mechanically enforced — you do not need to memorize them,
only understand _why_ (the invariant at the top).

---

## The sync-epoch fence (#9074)

A sync cycle spans many `await`s; a destructive config change (provider/account
switch, folder move, encryption enable/disable/password change) can land in any
of those gaps. A stale cycle must not apply, upload, acknowledge, or advance the
cursor against the new target/epoch afterwards.

- `SyncProviderManager.syncEpoch` is a monotonic counter, bumped **after** each
  such change completes (and at `runWithSyncBlocked` entry, which additionally
  blocks new cycles first and then drains running ones, bounded). First-time
  setup (no previous config / first provider activation) does NOT bump — there
  is no old target to fence, and the bump would race the fresh config's first
  sync into a spurious abort.
- Every cycle reads the **(provider, epoch) pair in one synchronous block**
  (a switch swaps the object and bumps the epoch in one synchronous block on
  its side, so a same-block read is always consistent) and threads the epoch
  as `fenceEpoch`. Capturing earlier — e.g. at the cycle claim — lets a switch
  complete in the awaits between and hands the cycle the new provider with a
  stale epoch: a spurious abort of the first post-switch sync.
- Provider I/O is fenced in one place: `getOperationSyncCapable(provider,
{ fenceEpoch })` returns a per-cycle delegate that re-asserts the epoch before
  every provider call. Local writes (apply inside the lock closures, ack
  persists, hydration, migration appends, rejected-ops handling, rebuild resume)
  re-assert via `assertSyncEpochUnchanged` at the call site.
- A failed assert throws `SyncEpochChangedError`, handled at every entry point
  as a **benign abort** (no error snack, `UNKNOWN_OR_CHANGED`) — each abort
  point is crash-equivalent by design (deferred acks re-upload, a behind cursor
  re-downloads with dedup).

**An unthreaded flow is an UNFENCED flow**: `fenceEpoch: undefined` disables the
assert. When adding a new sync entry point, capture and thread the epoch; when
adding a new local write inside a cycle, add an assert before it. Deliberately
unthreaded today: `forceUploadLocalState` / the USE_LOCAL/USE_REMOTE
conflict-resolution flows (covered by the encryption flag + cycle guard), and
key-recovery config writes (content-only, must NOT bump).

---

## Why (deeper)

- **Contributor rules:** this document; the old
  [`operation-rules.md`](./operation-rules.md) path is now a compatibility
  pointer.
- **Architecture tour:**
  [`sync-architecture.html#local-intent`](./sync-architecture.html#local-intent),
  [`sync-architecture.html#remote-apply`](./sync-architecture.html#remote-apply)
- **Deep rationale:**
  [`operation-log-architecture.md`](./operation-log-architecture.md)
- **Source of truth:** `src/app/util/local-actions.token.ts`,
  `src/app/util/skip-during-sync-window.operator.ts`,
  `src/app/util/wait-for-sync-window.operator.ts`,
  `src/app/imex/sync/sync-trigger.service.ts`,
  `src/app/op-log/apply/hydration-state.service.ts`
