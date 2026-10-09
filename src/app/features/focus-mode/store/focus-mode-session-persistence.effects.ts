import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest, fromEvent, merge, Observable } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  startWith,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { MOBILE_BACKGROUND_IDLE_CAP_MS } from '../../../app.constants';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import {
  selectCurrentTaskId,
  selectTaskEntities,
} from '../../tasks/store/task.selectors';
import { TaskService } from '../../tasks/task.service';
import { FocusModeState } from '../focus-mode.model';
import {
  FocusModeStorageService,
  FocusSessionSnapshot,
} from '../focus-mode-storage.service';
import { restoreFocusSession } from './focus-mode.actions';
import { selectFocusModeState } from './focus-mode.selectors';

type SnapshotInput = Omit<FocusSessionSnapshot, 'savedAt'>;

const toSnapshotInput = (
  state: FocusModeState,
  currentTaskId: string | null,
): SnapshotInput | null =>
  state.timer.purpose === null
    ? null
    : {
        timer: state.timer,
        mode: state.mode,
        currentCycle: state.currentCycle,
        pausedTaskId: state.pausedTaskId,
        trackedTaskId: currentTaskId,
      };

// `elapsed` changes every tick while running but is derivable from
// `startedAt`, so ignore it there to avoid a localStorage write per second.
const snapshotKey = (input: SnapshotInput | null): string =>
  JSON.stringify(
    input?.timer.isRunning ? { ...input, timer: { ...input.timer, elapsed: 0 } } : input,
  );

const isSessionOver = (timer: FocusSessionSnapshot['timer'], now: number): boolean =>
  timer.duration > 0 && !!timer.startedAt && now - timer.startedAt >= timer.duration;

/**
 * Keeps a running/paused focus session in localStorage and re-adopts it when the
 * app starts with an idle store, so a WebView killed in the background (iOS,
 * Android process death) does not reset the Pomodoro or stop task tracking.
 * Focus state is local-only (never op-logged), so this has no sync surface.
 * Not registered on Android: AndroidFocusModeEffects recovers from the native
 * foreground service, and a second restore path would race it.
 */
@Injectable()
export class FocusModeSessionPersistenceEffects {
  private _store = inject(Store);
  private _storage = inject(FocusModeStorageService);
  private _dataInitState = inject(DataInitStateService);
  private _taskService = inject(TaskService);
  private _globalTrackingInterval = inject(GlobalTrackingIntervalService);

  // Restore must read the snapshot before the first (idle) state is persisted,
  // which would otherwise clear it.
  restoreThenPersist$ = createEffect(
    () =>
      this._dataInitState.isAllDataLoadedInitially$.pipe(
        filter(Boolean),
        take(1),
        withLatestFrom(
          this._store.select(selectFocusModeState),
          this._store.select(selectTaskEntities),
        ),
        tap(([, state, entities]) => {
          if (state.timer.purpose === null) {
            this._restore((id) => {
              const task = entities[id];
              return !!task && !task.isDone;
            });
          }
        }),
        switchMap(() => this._persist$()),
      ),
    { dispatch: false },
  );

  private _persist$(): Observable<unknown> {
    // Refresh `savedAt` when the app is backgrounded/closed: it marks how long
    // the app was away, which decides whether the session is still worth restoring.
    const pageHidden$ = merge(
      fromEvent(document, 'visibilitychange').pipe(
        filter(() => document.visibilityState === 'hidden'),
      ),
      fromEvent(window, 'pagehide'),
    ).pipe(startWith(undefined));

    const input$ = combineLatest([
      this._store.select(selectFocusModeState),
      this._store.select(selectCurrentTaskId),
    ]).pipe(
      map(([state, currentTaskId]) => toSnapshotInput(state, currentTaskId)),
      distinctUntilChanged((a, b) => snapshotKey(a) === snapshotKey(b)),
    );

    return combineLatest([input$, pageHidden$]).pipe(
      tap(([input]) =>
        input
          ? this._storage.setSessionSnapshot({ ...input, savedAt: Date.now() })
          : this._storage.clearSessionSnapshot(),
      ),
    );
  }

  private _restore(isTrackable: (taskId: string) => boolean): void {
    const snapshot = this._storage.getSessionSnapshot();
    const now = Date.now();
    // shortcut: same cap as the iOS resume gap — a session left for longer
    // was most likely abandoned on purpose.
    if (!snapshot || now - snapshot.savedAt > MOBILE_BACKGROUND_IDLE_CAP_MS) return;
    const { timer, mode, currentCycle, pausedTaskId, trackedTaskId } = snapshot;
    this._store.dispatch(
      restoreFocusSession({ timer, mode, currentCycle, pausedTaskId }),
    );

    // A session that ended while the app was gone completes via the tick
    // reducer; tracking it again would count time after its end.
    if (
      trackedTaskId &&
      timer.purpose === 'work' &&
      timer.isRunning &&
      !isSessionOver(timer, now) &&
      isTrackable(trackedTaskId)
    ) {
      this._globalTrackingInterval.resetTrackingStart();
      this._taskService.setCurrentId(trackedTaskId);
    }
  }
}
