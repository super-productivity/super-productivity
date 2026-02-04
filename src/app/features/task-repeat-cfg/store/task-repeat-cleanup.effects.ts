import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { debounceTime, distinctUntilChanged, first, switchMap } from 'rxjs/operators';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { SyncWrapperService } from '../../../imex/sync/sync-wrapper.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { waitForSyncWindow } from '../../../util/wait-for-sync-window.operator';
import { selectAllRepeatableTaskWithSubTasks } from '../../tasks/store/task.selectors';
import { TaskWithSubTasks } from '../../tasks/task.model';
import { Log } from '../../../core/log';

@Injectable()
export class TaskRepeatCleanupEffects {
  private _store = inject(Store);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _syncTriggerService = inject(SyncTriggerService);
  private _syncWrapperService = inject(SyncWrapperService);
  private _hydrationState = inject(HydrationStateService);

  /**
   * After initial sync + date change, detect and remove stale duplicate
   * repeatable task instances created by the sync duplication bug.
   *
   * Only acts when multiple active instances exist for the same repeatCfgId.
   * Keeps the newest instance and removes older ones that have no progress
   * (not done, no time spent, no subtask progress).
   *
   * A single overdue instance is never touched — this avoids false positives
   * where a user simply didn't finish yesterday's recurring task.
   *
   * Uses a 3s debounce to run AFTER createRepeatableTasksAndAddDueToday$ (1s debounce).
   */
  cleanupDuplicateRepeatInstances$ = createEffect(
    () => {
      return this._syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$.pipe(
        first(),
        switchMap(() =>
          this._globalTrackingIntervalService.todayDateStr$.pipe(
            distinctUntilChanged(),
            waitForSyncWindow(
              this._hydrationState,
              'TaskRepeatCleanupEffects:cleanupDuplicateRepeatInstances$',
            ),
            switchMap(() => this._syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$),
            debounceTime(3000),
            switchMap(() => this._syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$),
            switchMap(() =>
              this._store.select(selectAllRepeatableTaskWithSubTasks).pipe(first()),
            ),
            switchMap((repeatableTasks: TaskWithSubTasks[]) => {
              // Group parent tasks by repeatCfgId
              const tasksByRepeatCfg = new Map<string, TaskWithSubTasks[]>();
              for (const task of repeatableTasks) {
                if (task.parentId || !task.repeatCfgId) {
                  continue;
                }
                const group = tasksByRepeatCfg.get(task.repeatCfgId);
                if (group) {
                  group.push(task);
                } else {
                  tasksByRepeatCfg.set(task.repeatCfgId, [task]);
                }
              }

              const deleteIds: string[] = [];
              for (const [, tasks] of tasksByRepeatCfg) {
                // Only act when there are actual duplicates
                if (tasks.length <= 1) {
                  continue;
                }

                // Sort by creation day descending — newest first
                tasks.sort((a, b) => {
                  const dayA = getDbDateStr(a.created);
                  const dayB = getDbDateStr(b.created);
                  return dayB.localeCompare(dayA);
                });

                // Keep the newest, consider deleting older ones
                for (let i = 1; i < tasks.length; i++) {
                  const task = tasks[i];
                  if (task.isDone) {
                    continue;
                  }
                  if (task.timeSpent > 0) {
                    continue;
                  }
                  const hasSubtaskProgress = task.subTasks.some(
                    (st) => st.isDone || st.timeSpent > 0,
                  );
                  if (hasSubtaskProgress) {
                    continue;
                  }
                  deleteIds.push(task.id);
                }
              }

              if (deleteIds.length > 0) {
                Log.log(
                  '[TaskRepeatCleanupEffects] Removing stale duplicate repeat instances:',
                  deleteIds,
                );
                this._store.dispatch(
                  TaskSharedActions.deleteTasks({ taskIds: deleteIds }),
                );
              }

              return [];
            }),
          ),
        ),
      );
    },
    { dispatch: false },
  );
}
