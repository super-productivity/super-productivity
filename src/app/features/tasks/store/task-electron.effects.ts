import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { setCurrentTask, unsetCurrentTask } from './task.actions';
import { select, Store } from '@ngrx/store';
import { filter, startWith, take, tap, withLatestFrom } from 'rxjs/operators';
import { selectCurrentTask, selectTaskEntities } from './task.selectors';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { GlobalConfigService } from '../../config/global-config.service';
import { selectIsOverlayShown } from '../../focus-mode/store/focus-mode.selectors';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';
import { FocusModeService } from '../../focus-mode/focus-mode.service';
import {
  cancelFocusSession,
  completeFocusSession,
  hideFocusOverlay,
  pauseFocusSession,
  showFocusOverlay,
  startFocusSession,
  unPauseFocusSession,
} from '../../focus-mode/store/focus-mode.actions';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import { ipcAddTaskFromAppUri$ } from '../../../core/ipc-events';
import { TaskService } from '../task.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';

// TODO send message to electron when current task changes here

@Injectable()
export class TaskElectronEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject<Store<any>>(Store);
  private _configService = inject(GlobalConfigService);
  private _focusModeService = inject(FocusModeService);
  private _taskService = inject(TaskService);

  // -----------------------------------------------------------------------------------
  // NOTE: IS_ELECTRON checks not necessary, since we check before importing this module
  // -----------------------------------------------------------------------------------

  constructor() {
    /**
     * SYNC-SAFE: This IPC listener is safe during sync/hydration because:
     * - Read-only operation - only reads current state and sends to Electron
     * - No store mutations or action dispatches
     * - Responds to explicit IPC request, not store-change driven
     * - take(1) ensures single response per request
     */
    window.ea.on(IPC.REQUEST_CURRENT_TASK_FOR_OVERLAY, () => {
      this._store$
        .pipe(
          select(selectCurrentTask),
          withLatestFrom(
            this._store$.pipe(select(selectIsOverlayShown)),
            this._focusModeService.currentSessionTime$,
          ),
          // Only take the first value and complete
          take(1),
        )
        .subscribe(([current, isFocusModeEnabled, currentFocusSessionTime]) => {
          window.ea.updateCurrentTask(
            current,
            false, // isPomodoroEnabled - legacy, always false
            0, // currentPomodoroSessionTime - legacy, always 0
            isFocusModeEnabled,
            currentFocusSessionTime,
            this._focusModeService.mode(),
          );
        });
    });

    window.ea.onSwitchTask((taskId) => {
      this._taskService.setCurrentId(taskId);
    });
  }

  syncTodayTasksToElectron$ = createEffect(
    () =>
      this._store$.pipe(
        select(selectTodayTaskIds),
        withLatestFrom(this._store$.pipe(select(selectTaskEntities))),
        tap(([todayTaskIds, taskEntities]) => {
          const tasks = todayTaskIds
            .map((id) => taskEntities[id])
            .filter((t) => !!t && !t.isDone)
            .map((t) => ({
              id: t!.id,
              title: t!.title,
              timeEstimate: t!.timeEstimate,
              timeSpent: t!.timeSpent,
            }));
          window.ea.updateTodayTasks(tasks);
        }),
      ),
    { dispatch: false },
  );

  taskChangeElectron$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          setCurrentTask,
          unsetCurrentTask,
          TimeTrackingActions.addTimeSpent,
          showFocusOverlay,
          hideFocusOverlay,
          startFocusSession,
          cancelFocusSession,
          pauseFocusSession,
          unPauseFocusSession,
          completeFocusSession,
        ),

        withLatestFrom(
          this._store$.pipe(select(selectCurrentTask)),
          this._store$.pipe(select(selectIsOverlayShown)),
          this._focusModeService.currentSessionTime$.pipe(startWith(0)),
        ),
        tap(([action, current, isFocusModeEnabled, currentFocusSessionTime]) => {
          window.ea.updateCurrentTask(
            current,
            false, // isPomodoroEnabled - legacy, always false
            0, // currentPomodoroSessionTime - legacy, always 0
            isFocusModeEnabled,
            currentFocusSessionTime,
            this._focusModeService.mode(),
          );
        }),
      ),
    { dispatch: false },
  );

  setTaskBarNoProgress$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setCurrentTask),
        tap(({ id }) => {
          if (!id) {
            window.ea.setProgressBar({
              progress: -1,
              progressBarMode: 'none',
            });
          }
        }),
      ),
    { dispatch: false },
  );

  clearTaskBarOnTaskDone$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        tap(({ task }) => {
          if (task.changes.isDone) {
            window.ea.setProgressBar({
              progress: -1,
              progressBarMode: 'none',
            });
          }
        }),
      ),
    { dispatch: false },
  );

  setTaskBarProgress$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TimeTrackingActions.addTimeSpent),
        withLatestFrom(this._store$.select(selectIsOverlayShown)),
        // Don't show progress bar when focus session is running
        filter(([a, isFocusSessionRunning]) => !isFocusSessionRunning),
        tap(([{ task }]) => {
          const progress = task.timeSpent / task.timeEstimate;
          window.ea.setProgressBar({
            progress,
            progressBarMode: 'normal',
          });
        }),
      ),
    { dispatch: false },
  );

  handleAddTaskFromProtocol$ = createEffect(
    () =>
      ipcAddTaskFromAppUri$.pipe(
        tap((data) => {
          // Double-check data validity as defensive programming
          if (!data || !data.title || typeof data.title !== 'string') {
            console.error('handleAddTaskFromProtocol$ received invalid data:', data);
            return;
          }
          this._taskService.add(data.title);
        }),
      ),
    { dispatch: false },
  );
}
