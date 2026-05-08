# Sync entry-point contract: replace `withSession()` + lint check with a runner

**Status:** Proposal
**Motivates:** follow-up to #7330
**Date:** 2026-05-08

## Background

The #7330 fixes introduced `SyncSessionValidationService` — a session-scoped
latch that records whether post-sync state validation failed. The contract is:

1. Every top-level sync entry point wraps its work in `latch.withSession(...)`.
2. Validation sites flip `latch.setFailed()` on corruption.
3. The entry point reads `latch.hasFailed()` once before claiming `IN_SYNC`.

Today there are four entry points: `SyncWrapperService._sync()`,
`SyncWrapperService._forceDownload()`, `WsTriggeredDownloadService._downloadOps()`,
and (after this PR) `ImmediateUploadService._performUpload()`.

Compliance is enforced by:

- A docstring contract on `SyncSessionValidationService`.
- `tools/check-sync-session-entry-points.js`, which counts `.withSession(`
  callers in production sources and asserts the count matches an
  `ALLOWED_ENTRY_POINTS` allow-list.

## The gap this proposal closes

The lint check enumerates `withSession()` *callers*. It catches "someone
added a withSession call without updating the allow-list." It does **not**
catch the inverse: a new sync entry point that should call `withSession()`
but doesn't.

`ImmediateUploadService._performUpload()` is the existence proof. It
predated the latch contract, called `OperationLogSyncService.uploadPendingOps()`
(which transitively calls `validateAfterSync()`), and was not in the
allow-list — so the lint check was silent. A validation failure on a
piggybacked op flipped the latch outside any session, logged a noisy
"outside-session" error, and was reset by the next normal `sync()`'s
`withSession()` entry. Meanwhile `_performUpload` set `IN_SYNC` based purely
on `result.uploadedCount > 0`. The exact #7330 surface — corrupt state +
`IN_SYNC` checkmark — was reachable.

The fix in this PR wraps `_performUpload` in `withSession()` and adds it to
the allow-list. That closes this specific instance. The structural weakness
remains: a future contributor who adds a fifth entry point still has to
*remember* to call `withSession()`. The lint check still won't catch them.

## Proposal: `SyncRunService.run(ctx => ...)`

Replace the contract-based design with a type-enforced one.

```ts
@Injectable({ providedIn: 'root' })
export class SyncRunService {
  private _latch = inject(SyncSessionValidationService);
  private _providerManager = inject(SyncProviderManager);

  async run<T>(
    label: string,
    work: (ctx: SyncRunContext) => Promise<T>,
  ): Promise<T> {
    return this._latch.withSession(async () => {
      const ctx: SyncRunContext = {
        markFailed: () => this._latch.setFailed(),
        hasFailed: () => this._latch.hasFailed(),
        // ... possibly more: setStatus, etc.
      };
      try {
        return await work(ctx);
      } finally {
        if (this._latch.hasFailed()) {
          this._providerManager.setSyncStatus('ERROR');
        }
        // (status decision could remain in callers if some need
        // UNKNOWN_OR_CHANGED or deferred-checkmark semantics)
      }
    });
  }
}
```

The validation services (`RemoteOpsProcessingService.validateAfterSync`,
`ConflictResolutionService._validateAndRepairAfterResolution`) take a
`SyncRunContext` parameter and call `ctx.markFailed()` instead of injecting
`SyncSessionValidationService` directly. The constructor of
`SyncRunContext` is private to `SyncRunService` — no other code can produce
one.

### What this enforces at compile time

- A new sync entry point wanting to call `processRemoteOps()` /
  `validateAfterSync()` must obtain a `SyncRunContext`, which can only come
  from `SyncRunService.run()`.
- A new validation site wanting to flip the latch must take a context, which
  forces it to be called from inside a run.
- Latch state is no longer reachable from arbitrary services — it lives
  inside the runner.

### What this does **not** solve

- It doesn't prevent a contributor from creating a new entry point that calls
  `runService.run()` with stale logic inside. It makes new entry points safe
  by default; it doesn't make their *contents* correct.
- It doesn't change the underlying semantics — same latch, same validation,
  same status decisions.

## Migration sketch

1. Add `SyncRunService` + `SyncRunContext`. Move the `withSession()` call
   inside `run()`.
2. Make `SyncSessionValidationService` package-private (or merge it into
   `SyncRunService` as a private field). Public surface shrinks.
3. Migrate the four entry points one at a time:
   - `SyncWrapperService._sync()` (largest — wraps `_syncBody`)
   - `SyncWrapperService._forceDownload()`
   - `WsTriggeredDownloadService._downloadOps()`
   - `ImmediateUploadService._performUpload()`
4. Change `validateAfterSync(callerHoldsLock)` to
   `validateAfterSync(ctx, callerHoldsLock)`, ditto for the conflict-resolution
   validation site. Plumb `ctx` through `processRemoteOps` and the LWW retry
   loops.
5. Delete or simplify `tools/check-sync-session-entry-points.js`. Keep a
   smaller version that asserts no new direct callers of
   `SyncSessionValidationService` outside the runner appear, if useful.
6. Adjust tests: the existing pattern `latch.setFailed()` in mocks becomes
   `ctx.markFailed()` via the runner's callback; `latch._resetForTest()`
   moves into the runner.

## Risk and effort

- **Risk:** medium. Sync paths are sensitive; `SyncWrapperService._sync()`
  has substantial state-machine logic (LWW retry loops, USE_REMOTE branch,
  retry-exhaustion priority). Migration touches the wrapper.
- **Effort:** ~0.5–1.5 days including tests.
- **Payoff:** prevents the class of bug found in this review (a new entry
  point that forgets to wrap). Reduces conceptual surface from "audit all
  call chains for `setFailed`/`hasFailed`/`withSession`" to "audit one
  boundary: `SyncRunService.run()`."

## Why not now

- This branch is already deep in #7330 review. The latch refactor in
  `b3cbdbd41` was itself a pivot from typed-return plumbing. Stacking a
  second structural pivot on top adds review surface and risk.
- The immediate fix (this PR) closes the user-visible bug. The runner
  refactor is value-over-time, not a now-problem.
- Doing the runner refactor as a standalone PR lets it be reviewed on its
  merits without sync-correctness pressure.

## Acceptance criteria

- All four current entry points call `runService.run(...)`; none call
  `latch.withSession()` directly.
- `SyncSessionValidationService` is no longer publicly injectable, or its
  public methods are no longer called outside `SyncRunService`.
- `validateAfterSync` and the conflict-resolution validation path take a
  `SyncRunContext` parameter; calling them without one is a compile error.
- The static check in `tools/` is either deleted or reduced to a one-line
  assertion ("no production code outside `SyncRunService` references
  `SyncSessionValidationService`").
- Existing test coverage continues to pass; new tests assert the runner's
  behavior end-to-end.
