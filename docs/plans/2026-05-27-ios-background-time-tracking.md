# iOS background time-tracking — implementation plan

Closes #7824 / tracked in #7826.

## Problem

On iOS, time tracking and the focus-mode timer freeze when the app is
backgrounded. The WKWebView's WebContent process is suspended within seconds
of `applicationDidEnterBackground`, halting `interval(1000)` and every other
JS timer. Android works around this with a native `TrackingForegroundService`;
no equivalent primitive exists on iOS (silent-audio / location
`UIBackgroundModes` are App Store violations for a time tracker, and
`beginBackgroundTask` does not keep the WebView ticking).

## Strategy: wall-clock reconciliation on resume

Trust `Date.now()` deltas. On `pause` persist whatever we have (handled by the
existing `main.ts` `appStateChange` listener, inside its `BackgroundTask`
budget); on `resume` compute the wall-clock gap and credit it (capped) to the
active task, then nudge the focus-mode reducer so its UI snaps to truth.

The codebase already exposes the three primitives this needs:

- `GlobalTrackingIntervalService._currentTrackingStart` — wall-clock anchor;
  survives JS suspension because nothing mutates it while suspended.
- `triggerWakeUpTick(maxDurationMs)` — emits a capped delta into `tick$`,
  consumed by `TaskService` via the existing `addTimeSpent` path.
- Focus reducer `tick` action — recomputes `elapsed = Date.now() - startedAt`
  on every dispatch (`focus-mode.reducer.ts:62-63`), so a single dispatch
  self-corrects regardless of how many ticks were missed.

## Multi-review findings folded in

This plan was reviewed by parallel reviewers across two rounds (plan review,
then a post-implementation code review). Adjustments:

1. **Cap raised from 30 min → 4 h.** 30 min silently swallowed legitimate
   long sessions; 4 h bounds an overnight-charging scenario (~16 h) but
   keeps an in-flight workday whole. Tunable post-feedback.
2. **Pause persistence stays in `main.ts`, not a new effect.** An earlier
   draft added a `flushOnPause$` effect that called
   `OperationWriteFlushService.flushPendingWrites()`. The post-implementation
   review found this was (a) a duplicate of the drain `main.ts`'s existing iOS
   `appStateChange` listener already performs, (b) run *outside* the
   `BackgroundTask.beforeExit` budget (so unprotected against suspension), and
   (c) racing the `main.ts` listener — if `main.ts` drained first, the
   accumulated time the effect dispatched afterwards could be lost. `flushPendingWrites()`
   also has a 30 s `MAX_WAIT_TIME`, so it is not bounded by the iOS budget.
   Fix: the only new work needed on pause is dispatching accumulated tracked
   time, so `flushAccumulatedTimeSpent()` is called inside the existing
   `main.ts` iOS handler, *before* its budgeted drain. The pause effect is
   removed entirely.
3. **Test seam via `iosInterface.ts`.** A small `iosInterface` exposes
   `onResume$`, fed from a single Capacitor `appStateChange` listener. A plain
   `Subject` (not `ReplaySubject`): unlike `androidInterface`, the producer is
   a JS listener registered at bootstrap, so a resume cannot arrive before the
   effect subscribes. The resume handler body is an exported pure function so
   the spec exercises it directly (no `IS_IOS_NATIVE` gate inside the spec).
4. **Conditional focus dispatch.** Skip the `focusModeActions.tick()`
   dispatch unless the focus timer is actually running (`timer.purpose !==
   null && timer.isRunning`). The reducer no-ops anyway, but conditioning
   avoids spurious action noise.
5. **Reset anchor after wake-up tick.** Android resets
   `_currentTrackingStart` after a sync (`android-foreground-tracking.effects.ts:548`)
   to prevent double-counting. The iOS effect calls `resetTrackingStart()`
   after `triggerWakeUpTick(cap)` so the leftover (uncapped) remainder
   doesn't bleed into the next 1 s interval tick.

## Implementation

### Files

| File | Purpose |
|---|---|
| `src/app/app.constants.ts` | Add `MOBILE_BACKGROUND_IDLE_CAP_MS = 4 * 60 * 60 * 1000`. |
| `src/main.ts` | In the existing iOS `appStateChange` handler, call `flushAccumulatedTimeSpent()` before the budgeted op-log drain. |
| `src/app/features/ios/ios-interface.ts` (new) | `iosInterface` with an `onResume$` Subject; one `appStateChange` listener feeds it when `IS_IOS_NATIVE`. |
| `src/app/features/ios/store/ios-background-tracking.effects.ts` (new) | One `{ dispatch: false }` resume effect gated by `IS_IOS_NATIVE`. Exports the pure handler function for spec. |
| `src/app/features/ios/store/ios-background-tracking.effects.spec.ts` (new) | Karma spec covering the resume edge cases. |
| `src/app/root-store/feature-stores.module.ts` | Register effect under `IS_IOS_NATIVE`, beside Android. |

### Pause (in `main.ts`)

```ts
const taskId = await BackgroundTask.beforeExit(async () => {
  try {
    // Dispatch accumulated tracked time so it is enqueued before the drain.
    appInjector?.get(TaskService).flushAccumulatedTimeSpent();
    await flushPendingOperations('iOS');
  } catch (e) {
    Log.err('iOS background: operation flush failed', e);
  }
  BackgroundTask.finish({ taskId });
});
```

### Resume effect

```ts
// Credit the wall-clock gap to the active task (capped), reset the anchor,
// drain accumulated time, then nudge the focus reducer if a session is running.
reconcileOnResume$ = IS_IOS_NATIVE && createEffect(
  () => iosInterface.onResume$.pipe(
    withLatestFrom(this._store.select(selectTimer)),
    tap(([, timer]) =>
      handleIosResume(
        this._globalTrackingIntervalService,
        this._taskService,
        this._store,
        timer,
      )
    ),
  ),
  { dispatch: false },
);
```

### Pure handler function

```ts
export const handleIosResume = (
  globalTracking: GlobalTrackingIntervalService,
  taskService: TaskService,
  store: Store,
  timer: TimerState,
): void => {
  globalTracking.triggerWakeUpTick(MOBILE_BACKGROUND_IDLE_CAP_MS);
  globalTracking.resetTrackingStart();
  taskService.flushAccumulatedTimeSpent();
  if (timer.purpose !== null && timer.isRunning) {
    store.dispatch(focusModeActions.tick());
  }
};
```

## Sync / lint correctness

- The resume effect is `{ dispatch: false }` and sources from the
  `iosInterface` Subject, not `Actions` — no `LOCAL_ACTIONS`/`Actions`
  injection, `no-actions-in-effects` clean. `require-hydration-guard` exempts
  `{ dispatch: false }`.
- `addTimeSpent` and `focusModeActions.tick` are non-persistent
  (`time-tracking.actions.ts:70` comment confirms; `tick` has no
  `meta.isPersistent`) — no op-log entries replay on other devices.
- Only the batched `syncTimeSpent` from `flushAccumulatedTimeSpent`
  produces an op-log entry — one per resume, not per minute.
- `task.service.ts:226` already gates the `tick$` subscriber on
  `isDataImportInProgress$`, so resume during a `SYNC_IMPORT` window
  is silently dropped (correct).

## Out of scope (separate issues)

- "You were away N hours, add it?" confirm dialog when cap is hit.
- Persisting `_currentTrackingStart` to `Capacitor Preferences` so cold-
  start after WebView kill can still reconcile.
- Native iOS Live Activity / Dynamic Island timer.
- Mac Catalyst tuning (`Capacitor.getPlatform() === 'ios'` also matches
  Catalyst; behavior is harmless there, just unnecessary).

## Acceptance criteria

Manual (no Capacitor `appStateChange` simulation precedent in `e2e/`):

- Lock phone ~5 min while tracking a task → `task.timeSpent` advances ~5 min.
- Lock phone 5 h → advances ~4 h (capped at `MOBILE_BACKGROUND_IDLE_CAP_MS`).
- Focus session backgrounded 2 min → on resume, focus timer shows correct
  `elapsed`.
- No regression on Android (effects don't fire — `IS_IOS_NATIVE` is false).
- No regression on web / desktop (same gate).

Automated (in `ios-background-tracking.effects.spec.ts`):

- `handleIosResume` calls `triggerWakeUpTick(4h)` →
  `resetTrackingStart` → `flushAccumulatedTimeSpent` in order.
- `handleIosResume` dispatches `focusModeActions.tick()` when timer is
  running.
- `handleIosResume` does NOT dispatch when `timer.purpose === null`.
- `handleIosResume` does NOT dispatch when `timer.isRunning === false`
  (paused / BreakOffer).
- Cap exactly at 4 h returns capped duration (delegated to existing
  `global-tracking-interval.service.spec.ts`).

The pause path (accumulated-time flush in `main.ts`) has no new unit test —
it reuses the already-covered `flushAccumulatedTimeSpent` /
`flushPendingWrites` machinery; verified manually on device.
