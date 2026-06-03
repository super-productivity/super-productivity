import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { forkJoin } from 'rxjs';
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
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { selectAllTaskRepeatCfgs } from './task-repeat-cfg.selectors';
import { DateService } from '../../../core/date/date.service';
import { Log } from '../../../core/log';
import { DeletedTaskIssueSidecarService } from '../../issue/two-way-sync/deleted-task-issue-sidecar.service';

@Injectable()
export class TaskRepeatCleanupEffects {
  private _store = inject(Store);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _syncTriggerService = inject(SyncTriggerService);
  private _syncWrapperService = inject(SyncWrapperService);
  private _hydrationState = inject(HydrationStateService);
  private _deletedTaskIssueSidecar = inject(DeletedTaskIssueSidecarService);
  private _dateService = inject(DateService);

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
   * Scope of grouping depends on the repeat config:
   * - Default configs: only SAME-DAY duplicates are collapsed (the sync bug).
   *   A previous-day overdue instance is deliberately kept (#7718).
   * - skipOverdue configs: instances are collapsed across ALL days, so the
   *   older empty overdue instance is reaped once a newer one exists. This is
   *   what makes "skip overdue instances" actually work for daily tasks, where
   *   today is always a scheduled day so the creation-time skip never fires
   *   (#7977). Instances with real progress are still preserved.
   *
   * Uses a 3s debounce to run AFTER createRepeatableTasksAndAddDueToday$ (1s debounce).
   * Uses afterInitialSyncDoneStrict$ to ensure sync has completed (including for SuperSync).
   */
  cleanupDuplicateRepeatInstances$ = createEffect(
    () => {
      return this._syncTriggerService.afterInitialSyncDoneStrict$.pipe(
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
              forkJoin([
                this._store.select(selectAllRepeatableTaskWithSubTasks).pipe(first()),
                this._store.select(selectAllTaskRepeatCfgs).pipe(first()),
              ]),
            ),
            switchMap(([repeatableTasks, repeatCfgs]) => {
              const cfgById = new Map<string, TaskRepeatCfg>(
                repeatCfgs.map((c) => [c.id as string, c]),
              );
              const todayStr = this._dateService.todayStr();

              // Group parent tasks.
              // - Default configs: key by (repeatCfgId, creation day). Two
              //   instances created on DIFFERENT days are not duplicates — they
              //   represent separate scheduled occurrences (e.g. yesterday's
              //   overdue instance + today's freshly-created instance). Only
              //   same-day collisions are the sync-bug we want to clean up
              //   (#7718).
              // - skipOverdue configs: key by repeatCfgId alone so instances
              //   from earlier days collapse together and the empty overdue
              //   ones can be reaped once a newer one exists (#7977).
              const tasksByKey = new Map<string, TaskWithSubTasks[]>();
              for (const task of repeatableTasks) {
                if (task.parentId || !task.repeatCfgId) {
                  continue;
                }
                const key = cfgById.get(task.repeatCfgId)?.skipOverdue
                  ? task.repeatCfgId
                  : `${task.repeatCfgId}|${getDbDateStr(task.created)}`;
                const group = tasksByKey.get(key);
                if (group) {
                  group.push(task);
                } else {
                  tasksByKey.set(key, [task]);
                }
              }

              const deleteIds: string[] = [];
              const deleteTasks: TaskWithSubTasks[] = [];
              for (const [, tasks] of tasksByKey) {
                // Only act when the key has more than one instance — a single
                // (possibly overdue) instance is always kept.
                if (tasks.length <= 1) {
                  continue;
                }

                const cfg = cfgById.get(tasks[0].repeatCfgId as string);
                const isSkipOverdueGroup = !!cfg?.skipOverdue;

                // Sort by raw creation timestamp descending — true newest first.
                // (Same-day strings are tied, so sorting by ms picks an
                // unambiguous survivor.)
                tasks.sort((a, b) => b.created - a.created);

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

                  // For the cross-day skipOverdue group, "older" is not enough
                  // to reap: a planned-ahead future instance has a later
                  // creation time than today's, so only remove instances that
                  // are genuinely OVERDUE (due before today) — never today's or
                  // a future instance. And never discard a prior-day instance
                  // the user actually edited (attachments or notes that differ
                  // from the template).
                  if (isSkipOverdueGroup) {
                    const dueStr = task.dueWithTime
                      ? getDbDateStr(task.dueWithTime)
                      : (task.dueDay ?? null);
                    if (!dueStr || dueStr >= todayStr) {
                      continue;
                    }
                    if (task.attachments?.length) {
                      continue;
                    }
                    if ((task.notes ?? '').trim() !== (cfg?.notes ?? '').trim()) {
                      continue;
                    }
                  }

                  deleteIds.push(task.id);
                  deleteTasks.push(task);
                }
              }

              if (deleteIds.length > 0) {
                Log.log(
                  '[TaskRepeatCleanupEffects] Removing stale duplicate repeat instances:',
                  deleteIds,
                );
                this._deletedTaskIssueSidecar.set(
                  deleteTasks
                    .filter((t) => !!t.issueId && !!t.issueType && !!t.issueProviderId)
                    .map((t) => ({
                      issueId: t.issueId!,
                      issueType: t.issueType!,
                      issueProviderId: t.issueProviderId!,
                    })),
                );
                this._store.dispatch(
                  TaskSharedActions.deleteTasks({
                    taskIds: deleteIds,
                  }),
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
