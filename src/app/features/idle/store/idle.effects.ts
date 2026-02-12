import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
import { ChromeExtensionInterfaceService } from '../../../core/chrome-extension-interface/chrome-extension-interface.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../../tasks/task.service';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { UiHelperService } from '../../ui-helper/ui-helper.service';
import { IS_ELECTRON } from '../../../app.constants';
import {
  idleDialogResult,
  openIdleDialog,
  resetIdle,
  setIdleTime,
  triggerIdle,
} from './idle.actions';
import {
  distinctUntilChanged,
  exhaustMap,
  filter,
  first,
  map,
  mapTo,
  switchMap,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { lazySetInterval } from '../../../../../electron/shared-with-frontend/lazy-set-interval';
import { EMPTY, iif, Observable, of } from 'rxjs';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import { SimpleCounterService } from '../../simple-counter/simple-counter.service';
import { selectIdleTime, selectIsIdle } from './idle.selectors';
import { turnOffAllSimpleCounterCounters } from '../../simple-counter/store/simple-counter.actions';
import { DialogIdleComponent } from '../dialog-idle/dialog-idle.component';
import { selectIdleConfig } from '../../config/store/global-config.reducer';
import { devError } from '../../../util/dev-error';
import {
  DialogIdlePassedData,
  DialogIdleReturnData,
  IdleTrackItem,
  SimpleCounterIdleBtn,
} from '../dialog-idle/dialog-idle.model';
import { isNotNullOrUndefined } from '../../../util/is-not-null-or-undefined';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../../t.const';
import { DateService } from '../../../core/date/date.service';
import { ipcIdleTime$ } from '../../../core/ipc-events';
import { selectIsSessionRunning } from '../../focus-mode/store/focus-mode.selectors';
import {
  completeFocusSession,
  showFocusOverlay,
  unPauseFocusSession,
} from '../../focus-mode/store/focus-mode.actions';
import { Log } from '../../../core/log';

const DEFAULT_MIN_IDLE_TIME = 60000;
const IDLE_POLL_INTERVAL = 1000;

@Injectable()
export class IdleEffects {
  private actions$ = inject(LOCAL_ACTIONS);
  private _chromeExtensionInterfaceService = inject(ChromeExtensionInterfaceService);
  private _workContextService = inject(WorkContextService);
  private _taskService = inject(TaskService);
  private _simpleCounterService = inject(SimpleCounterService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _uiHelperService = inject(UiHelperService);
  private _dateService = inject(DateService);

  private _clearIdlePollInterval?: () => void;
  private _isDialogOpen: boolean = false;

  // NOTE: needs to live forever since we can't unsubscribe from ipcEvent$
  private _isFocusSessionRunning$ = this._store.select(selectIsSessionRunning);

  private _triggerIdleApis$ = IS_ELECTRON
    ? ipcIdleTime$
    : this._chromeExtensionInterfaceService.onReady$.pipe(
        first(),
        switchMap(() => {
          return new Observable((subscriber) => {
            this._chromeExtensionInterfaceService.addEventListener(
              IPC.IDLE_TIME,
              (ev: Event, data?: unknown) => {
                const idleTimeInMs = Number(data);
                subscriber.next(idleTimeInMs);
              },
            );
          });
        }),
      );

  // NOTE: Why we filter out triggers when already idle (fixes #5652):
  // When the idle dialog is open, two timers compete to update idleTime in the store:
  // 1. The IPC stream from Electron (this effect) - reports current system idle time
  // 2. The internal poll timer (_initIdlePoll) - calculates initialIdleTime + elapsed time
  //
  // The internal poll timer is MORE ACCURATE for display because:
  // - It uses Date.now() with a fixed reference point (idleStart) for precise calculation
  // - The IPC system idle time resets whenever the user moves the mouse slightly
  // - We want to show "total time away" not "current system idle time"
  //
  // By filtering when isIdle=true, we let the internal poll timer control the display
  // while the dialog is open, preventing the flickering between two different values.
  triggerIdleWhenEnabled$ = createEffect(() =>
    this._store.select(selectIdleConfig).pipe(
      skipWhileApplyingRemoteOps(),
      switchMap(
        ({
          isEnableIdleTimeTracking,
          isOnlyOpenIdleWhenCurrentTask,
          minIdleTime = DEFAULT_MIN_IDLE_TIME,
        }) =>
          !isEnableIdleTimeTracking
            ? of(resetIdle())
            : this._triggerIdleApis$.pipe(
                withLatestFrom(this._store.select(selectIsIdle)),
                switchMap(([idleTimeInMs, isAlreadyIdle]) => {
                  // Skip if already in idle state - let internal poll timer handle updates
                  if (isAlreadyIdle) {
                    return EMPTY;
                  }
                  Log.verbose('triggerIdleWhenEnabled$', {
                    idleTimeInMs,
                    isEnableIdleTimeTracking,
                    isOnlyOpenIdleWhenCurrentTask,
                    minIdleTime,
                  });
                  if (
                    isOnlyOpenIdleWhenCurrentTask &&
                    !this._taskService.currentTaskId()
                  ) {
                    return of(resetIdle());
                  }
                  const idleTime = idleTimeInMs as number;
                  return idleTime >= minIdleTime ? of(triggerIdle({ idleTime })) : EMPTY;
                }),
              ),
      ),
    ),
  );

  handleIdleInit$ = createEffect(() =>
    this._store.select(selectIsIdle).pipe(
      // Guard: skip idle state changes during sync - CRITICAL because this effect
      // has data mutations (removeTimeSpent, setCurrentId, decreaseCounterToday)
      skipWhileApplyingRemoteOps(),
      distinctUntilChanged(),
      switchMap((isIdle) => iif(() => isIdle, of(isIdle), EMPTY)),
      withLatestFrom(
        this._store.select(selectIdleTime),
        this._simpleCounterService.enabledSimpleStopWatchCounters$,
        this._isFocusSessionRunning$,
      ),
      map(([, idleTime, enabledSimpleStopWatchCounters, isFocusSessionRunning]) => {
        // ALL IDLE SIDE EFFECTS
        // ---------------------
        if (IS_ELECTRON) {
          this._uiHelperService.focusAppAfterNotification();
        }

        // untrack current task time und unselect
        let lastCurrentTaskId: string | null;
        const tid = this._taskService.currentTaskId();
        if (tid) {
          lastCurrentTaskId = tid;
          // remove idle time already tracked
          this._taskService.removeTimeSpent(tid, idleTime);
          this._taskService.setCurrentId(null);
        } else {
          lastCurrentTaskId = null;
        }

        // untrack on simple counter time and turn off
        if (enabledSimpleStopWatchCounters.length) {
          enabledSimpleStopWatchCounters.forEach((simpleCounter) => {
            if (simpleCounter.isOn) {
              this._simpleCounterService.decreaseCounterToday(simpleCounter.id, idleTime);
            }
          });
          this._store.dispatch(turnOffAllSimpleCounterCounters());
        }

        // NOTE: we need a new idleTimer since the other values are reset as soon as the user is active again
        this._initIdlePoll(idleTime);

        // this._openDialog(enabledSimpleStopWatchCounters, lastCurrentTaskId);
        // finally open dialog
        return openIdleDialog({
          enabledSimpleStopWatchCounters,
          lastCurrentTaskId,
          wasFocusSessionRunning: isFocusSessionRunning,
        });
      }),
    ),
  );

  idleDialog$ = createEffect(() =>
    this.actions$.pipe(
      ofType(openIdleDialog),
      filter(() => !this._isDialogOpen),
      tap(() => (this._isDialogOpen = true)),
      // use exhaustMap to prevent opening up multiple dialogs
      exhaustMap(
        ({ enabledSimpleStopWatchCounters, lastCurrentTaskId, wasFocusSessionRunning }) =>
          this._matDialog
            .open<
              DialogIdleComponent,
              DialogIdlePassedData,
              DialogIdleReturnData | undefined
            >(DialogIdleComponent, {
              restoreFocus: true,
              disableClose: true,
              closeOnNavigation: false,
              data: {
                lastCurrentTaskId,
                enabledSimpleStopWatchCounters,
                wasFocusSessionRunning,
              },
            })
            .afterClosed(),
      ),
      tap((dialogRes) => {
        if (!dialogRes) {
          devError('Idle dialog unexpected empty result ???');
        }
      }),
      isNotNullOrUndefined(),
      withLatestFrom(this._store.select(selectIdleTime)),
      map(([dialogRes, idleTime]) =>
        idleDialogResult({
          ...dialogRes,
          idleTime,
          // TODO
        }),
      ),
      tap(() => (this._isDialogOpen = false)),
    ),
  );

  handleIdleDialogResult$ = createEffect(() =>
    this.actions$.pipe(
      ofType(idleDialogResult),
      tap(
        ({
          trackItems,
          simpleCounterToggleBtnsWhenNoTrackItems,
          idleTime,
          wasFocusSessionRunning,
          isResetBreakTimer,
        }) => {
          this._cancelIdlePoll();
          // handle dialog result weirdness :(
          if (!trackItems) {
            devError('No track items ???');
            return;
          }

          if (trackItems.length === 0 && simpleCounterToggleBtnsWhenNoTrackItems) {
            if (wasFocusSessionRunning) {
              this._store.dispatch(completeFocusSession({ isManual: false }));
              this._store.dispatch(showFocusOverlay());
            }

            const activatedItemNr = simpleCounterToggleBtnsWhenNoTrackItems.filter(
              (btn) => btn.isTrackTo,
            ).length;

            // TODO maybe move to effect
            if (activatedItemNr > 0) {
              this._matDialog
                .open(DialogConfirmComponent, {
                  restoreFocus: true,
                  data: {
                    cancelTxt: T.F.TIME_TRACKING.D_IDLE.SIMPLE_CONFIRM_COUNTER_CANCEL,
                    okTxt: T.F.TIME_TRACKING.D_IDLE.SIMPLE_CONFIRM_COUNTER_OK,
                    message: T.F.TIME_TRACKING.D_IDLE.SIMPLE_COUNTER_CONFIRM_TXT,
                    translateParams: {
                      nr: activatedItemNr,
                    },
                  },
                })
                .afterClosed()
                .subscribe((isConfirm: boolean) => {
                  if (isConfirm) {
                    // TODO maybe move to effect
                    this._updateSimpleCounterValues(
                      simpleCounterToggleBtnsWhenNoTrackItems,
                      idleTime,
                    );
                  }
                });
            }
            return;
          }

          const itemsWithMappedIdleTime = trackItems.map((trackItem) => ({
            ...trackItem,
            time: trackItem.time === 'IDLE_TIME' ? idleTime : trackItem.time,
          }));

          itemsWithMappedIdleTime.forEach((item) => {
            this._updateSimpleCounterValues(item.simpleCounterToggleBtns, item.time);
          });

          const breakItems = itemsWithMappedIdleTime.filter(
            (item: IdleTrackItem) => item.type === 'BREAK',
          );
          // NOTE: break timer reset is handled in takeABrea
          if (breakItems.length) {
            breakItems.forEach((item) => {
              this._workContextService.addToBreakTimeForActiveContext(
                undefined,
                item.time,
              );
            });
            if (wasFocusSessionRunning) {
              this._store.dispatch(completeFocusSession({ isManual: false }));
              this._store.dispatch(showFocusOverlay());
            }
          } else if (wasFocusSessionRunning) {
            this._store.dispatch(unPauseFocusSession());
            this._store.dispatch(showFocusOverlay());
          }

          const taskItems = itemsWithMappedIdleTime.filter(
            (item: IdleTrackItem) => item.type === 'TASK',
          );
          let taskItemId: string | undefined;
          taskItems.forEach((taskItem) => {
            if (typeof taskItem.title === 'string') {
              taskItemId = this._taskService.add(taskItem.title, false, {
                timeSpent: taskItem.time,
                timeSpentOnDay: {
                  [this._dateService.todayStr()]: taskItem.time,
                },
              });
            } else if (taskItem.task) {
              taskItemId = taskItem.task.id;
              this._taskService.addTimeSpentAndSync(taskItem.task, taskItem.time);
            }
          });

          if (taskItems.length === 1 && taskItemId) {
            this._taskService.setCurrentId(taskItemId);
          }
        },
      ),
      // unset idle at the end
      mapTo(resetIdle()),
    ),
  );

  // constructor() {
  //   window.setTimeout(() => {
  //     this._store.dispatch(triggerIdle({ idleTime: 60 * 1000 }));
  //   }, 8700);
  // }

  private _initIdlePoll(initialIdleTime: number): void {
    const idleStart = Date.now();
    this._store.dispatch(setIdleTime({ idleTime: initialIdleTime }));

    this._clearIdlePollInterval = lazySetInterval(() => {
      const delta = Date.now() - idleStart;
      this._store.dispatch(setIdleTime({ idleTime: initialIdleTime + delta }));
    }, IDLE_POLL_INTERVAL);
  }

  private _cancelIdlePoll(): void {
    if (this._clearIdlePollInterval) {
      this._clearIdlePollInterval();
      this._clearIdlePollInterval = undefined;
    }
  }

  private async _updateSimpleCounterValues(
    simpleCounterToggleBtns: SimpleCounterIdleBtn[],
    idleTime: number,
  ): Promise<void> {
    simpleCounterToggleBtns.forEach((tglBtn) => {
      if (tglBtn.isTrackTo) {
        this._simpleCounterService.increaseCounterToday(tglBtn.id, idleTime);
        if (tglBtn.isWasEnabledBefore) {
          this._simpleCounterService.toggleCounter(tglBtn.id);
        }
      }
    });
  }
}
