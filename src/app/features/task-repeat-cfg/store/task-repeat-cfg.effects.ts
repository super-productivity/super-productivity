import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import {
  concatMap,
  filter,
  first,
  map,
  mergeMap,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { addTaskRepeatCfgToTask, updateTaskRepeatCfg } from './task-repeat-cfg.actions';
import { Task, TaskCopy, TaskReminderOptionId } from '../../tasks/task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { TaskService } from '../../tasks/task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import { TaskRepeatCfg, TaskRepeatCfgCopy } from '../task-repeat-cfg.model';
import { MatDialog } from '@angular/material/dialog';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../../t.const';
import { Update } from '@ngrx/entity';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { DateService } from '../../../core/date/date.service';
import { Log } from '../../../core/log';
import {
  addSubTask,
  moveSubTask,
  moveSubTaskDown,
  moveSubTaskToBottom,
  moveSubTaskToTop,
  moveSubTaskUp,
} from '../../tasks/store/task.actions';
import { EMPTY, forkJoin, from, Observable, of as rxOf } from 'rxjs';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { remindOptionToMilliseconds } from '../../tasks/util/remind-option-to-milliseconds';
import { devError } from '../../../util/dev-error';
import { getFirstRepeatOccurrence } from './get-first-repeat-occurrence.util';

const SCHEDULE_AFFECTING_FIELDS: (keyof TaskRepeatCfgCopy)[] = [
  'startDate',
  'repeatCycle',
  'repeatEvery',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'order', // controls top/bottom placement of created tasks, which affects rescheduling behavior
  'isPaused',
];

@Injectable()
export class TaskRepeatCfgEffects {
  private _localActions$ = inject(LOCAL_ACTIONS);
  private _taskService = inject(TaskService);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _matDialog = inject(MatDialog);
  private _taskArchiveService = inject(TaskArchiveService);
  private _dateService = inject(DateService);

  addRepeatCfgToTaskUpdateTask$ = createEffect(() =>
    this._localActions$.pipe(
      ofType(addTaskRepeatCfgToTask),
      filter(({ startTime, remindAt }) => !!startTime && !!remindAt),
      concatMap(({ taskId, startTime, remindAt, taskRepeatCfg }) =>
        this._taskService.getByIdOnce$(taskId).pipe(
          map((task) => {
            if (!task) {
              devError(`Task with id ${taskId} not found`);
              return null; // Return null instead of EMPTY
            }
            // Calculate the correct target day based on the repeat pattern (fixes #5594)
            // Use getFirstRepeatOccurrence which handles future start dates correctly
            const calculatedTargetDate = getFirstRepeatOccurrence(
              taskRepeatCfg as TaskRepeatCfg,
              new Date(),
            );

            // Use calculated date if available, otherwise fall back to existing logic
            const targetDayTimestamp = calculatedTargetDate
              ? calculatedTargetDate.getTime()
              : (task.dueDay && dateStrToUtcDate(task.dueDay).getTime()) ||
                task.dueWithTime ||
                Date.now();
            const dateTime = getDateTimeFromClockString(
              startTime as string,
              targetDayTimestamp,
            );

            // Only skip auto-removal from today if the task is scheduled for today
            const scheduledForToday = this._dateService.isToday(dateTime);

            return TaskSharedActions.scheduleTaskWithTime({
              task,
              dueWithTime: dateTime,
              remindAt: remindOptionToMilliseconds(
                dateTime,
                remindAt as TaskReminderOptionId,
              ),
              isMoveToBacklog: false,
              isSkipAutoRemoveFromToday: scheduledForToday,
            });
          }),
          filter(
            (
              action,
            ): action is ReturnType<typeof TaskSharedActions.scheduleTaskWithTime> =>
              action !== null,
          ), // Filter out null
        ),
      ),
    ),
  );

  // NOTE: Archive cleanup for deleteTaskRepeatCfg is now handled by
  // ArchiveOperationHandler._handleDeleteTaskRepeatCfg, which is the single
  // source of truth for archive operations.

  updateTaskAfterMakingItRepeatable$ = createEffect(() =>
    this._localActions$.pipe(
      ofType(addTaskRepeatCfgToTask),
      switchMap(({ taskRepeatCfg, taskId, startTime, remindAt }) => {
        return this._taskService.getByIdWithSubTaskData$(taskId).pipe(
          first(),
          map((taskWithSubTasks) => {
            // Extract subtasks safely, ensuring we handle the type properly
            const subTasks = Array.isArray(taskWithSubTasks.subTasks)
              ? taskWithSubTasks.subTasks
              : [];
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { subTasks: _ignored, ...taskWithoutSubs } = taskWithSubTasks;

            if (subTasks.length === 0) {
              return {
                task: taskWithoutSubs,
                taskRepeatCfg,
                subTaskTemplates: [],
                isTimedTask: !!(startTime && remindAt),
              };
            }

            const subTaskTemplates = this._toSubTaskTemplates(subTasks);

            return {
              task: taskWithoutSubs,
              taskRepeatCfg,
              subTaskTemplates,
              isTimedTask: !!(startTime && remindAt),
            };
          }),
        );
      }),
      map(({ task, taskRepeatCfg, subTaskTemplates, isTimedTask }) => {
        const firstOccurrence = getFirstRepeatOccurrence(
          taskRepeatCfg as TaskRepeatCfg,
          new Date(),
        );
        const firstOccurrenceStr = firstOccurrence
          ? this._dateService.todayStr(firstOccurrence)
          : this._dateService.todayStr();
        const isFirstOccurrenceToday_ = firstOccurrence
          ? this._dateService.isToday(firstOccurrence)
          : true;

        // Update repeat config with subtask templates AND the correct lastTaskCreationDay
        this._taskRepeatCfgService.updateTaskRepeatCfg(taskRepeatCfg.id, {
          subTaskTemplates,
          lastTaskCreationDay: firstOccurrenceStr,
          lastTaskCreation: firstOccurrence?.getTime() || Date.now(),
        });

        if (!isFirstOccurrenceToday_ && firstOccurrence) {
          // FUTURE FIRST OCCURRENCE:
          // Update created to match what the repeat processor would set (noon on
          // first occurrence day). This prevents duplicate creation via the
          // created-date check in _getActionsForTaskRepeatCfg (service.ts:217-219).
          this._taskService.update(task.id, {
            created: firstOccurrence.getTime(),
          });
          // dueDay + planner + Today tag removal handled by planTaskForDay action
        } else {
          // TODAY FIRST OCCURRENCE:
          // Update dueDay if it differs
          const currentDueDay = task.dueDay || getDbDateStr(task.created);
          if (currentDueDay !== firstOccurrenceStr) {
            this._taskService.update(task.id, { dueDay: firstOccurrenceStr });
          }
        }

        // For timed tasks, strip scheduling fields from changes to prevent
        // double-scheduling. addRepeatCfgToTaskUpdateTask$ already handles
        // scheduling via scheduleTaskWithTime with the correct target date.
        // Without this guard, _updateRegularTaskInstance dispatches a second
        // scheduleTaskWithTime using new Date() (today), overwriting the
        // correct future date set by the other effect.
        const changesForUpdate: Partial<TaskRepeatCfgCopy> = isTimedTask
          ? { ...taskRepeatCfg, startTime: undefined, remindAt: undefined }
          : taskRepeatCfg;
        this._updateRegularTaskInstance(
          task,
          changesForUpdate as Partial<TaskRepeatCfgCopy>,
          taskRepeatCfg as TaskRepeatCfgCopy,
        );

        return { task, isFirstOccurrenceToday_, firstOccurrenceStr, isTimedTask };
      }),
      // Skip planTaskForDay for timed tasks — addRepeatCfgToTaskUpdateTask$ handles
      // those via scheduleTaskWithTime. planTaskForDay would overwrite dueWithTime.
      filter(
        ({ isFirstOccurrenceToday_, isTimedTask }) =>
          !isFirstOccurrenceToday_ && !isTimedTask,
      ),
      map(({ task, firstOccurrenceStr }) =>
        PlannerActions.planTaskForDay({
          task: task as TaskCopy,
          day: firstOccurrenceStr,
        }),
      ),
    ),
  );

  /**
   * Reschedules the live task instance when schedule-affecting fields of a repeat config are updated.
   * This mirrors the scheduling logic in updateTaskAfterMakingItRepeatable$ / addRepeatCfgToTaskUpdateTask$
   * but triggers on config edits rather than initial creation.
   */
  rescheduleTaskOnRepeatCfgUpdate$ = createEffect(() =>
    this._localActions$.pipe(
      ofType(updateTaskRepeatCfg),
      filter(({ taskRepeatCfg }) => {
        const changes = taskRepeatCfg.changes as Partial<TaskRepeatCfgCopy>;
        return SCHEDULE_AFFECTING_FIELDS.some((field) => field in changes);
      }),
      switchMap(({ taskRepeatCfg }) => {
        const cfgId = taskRepeatCfg.id as string;
        return this._taskRepeatCfgService.getTaskRepeatCfgById$(cfgId).pipe(
          first(),
          switchMap((fullCfg) => {
            if (fullCfg.isPaused) {
              return EMPTY;
            }
            return this._taskService.getTasksByRepeatCfgId$(cfgId).pipe(
              first(),
              switchMap((liveInstances) => {
                const undoneInstances = liveInstances.filter((t) => !t.isDone);
                if (undoneInstances.length === 0) {
                  return EMPTY;
                }
                const task = undoneInstances.reduce((a, b) =>
                  a.created > b.created ? a : b,
                );

                const firstOccurrence = getFirstRepeatOccurrence(fullCfg, new Date());
                const firstOccurrenceStr = firstOccurrence
                  ? this._dateService.todayStr(firstOccurrence)
                  : this._dateService.todayStr();

                // Update lastTaskCreationDay on the config
                this._taskRepeatCfgService.updateTaskRepeatCfg(cfgId, {
                  lastTaskCreationDay: firstOccurrenceStr,
                  lastTaskCreation: firstOccurrence?.getTime() || Date.now(),
                });

                const isTimedTask = !!(fullCfg.startTime && fullCfg.remindAt);
                const isFirstOccurrenceToday_ = firstOccurrence
                  ? this._dateService.isToday(firstOccurrence)
                  : true;

                if (isTimedTask) {
                  const targetDayTimestamp = firstOccurrence
                    ? firstOccurrence.getTime()
                    : Date.now();
                  const dateTime = getDateTimeFromClockString(
                    fullCfg.startTime as string,
                    targetDayTimestamp,
                  );
                  const scheduledForToday = this._dateService.isToday(dateTime);

                  return rxOf(
                    TaskSharedActions.scheduleTaskWithTime({
                      task,
                      dueWithTime: dateTime,
                      remindAt: remindOptionToMilliseconds(
                        dateTime,
                        fullCfg.remindAt as TaskReminderOptionId,
                      ),
                      isMoveToBacklog: false,
                      isSkipAutoRemoveFromToday: scheduledForToday,
                    }),
                  );
                }

                if (!isFirstOccurrenceToday_ && firstOccurrence) {
                  return rxOf(
                    PlannerActions.planTaskForDay({
                      task: task as TaskCopy,
                      day: firstOccurrenceStr,
                    }),
                  );
                }

                return EMPTY;
              }),
            );
          }),
        );
      }),
    ),
  );

  /**
   * Auto-syncs subtask templates from the newest live instance when auto-update flag is enabled.
   * Triggers on subtask operations like add, move, update, or delete.
   */
  autoSyncSubtaskTemplatesFromNewest$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(
          addSubTask,
          moveSubTask,
          moveSubTaskUp,
          moveSubTaskDown,
          moveSubTaskToTop,
          moveSubTaskToBottom,
          TaskSharedActions.updateTask,
          TaskSharedActions.deleteTask,
        ),
        // Ignore delete for parent tasks (no need to sync after parent removed)
        filter((action) => this._isRelevantSubtaskAction(action)),
        // Only consider updates relevant to subtasks or parent content updates
        switchMap((action) =>
          this._resolveParentTaskFromAction(action).pipe(
            first(),
            switchMap((parent: Task | null) => {
              if (!parent || !parent.repeatCfgId) {
                return EMPTY;
              }
              const repeatCfgId = parent.repeatCfgId;
              // Load config and verify flags
              return this._taskRepeatCfgService.getTaskRepeatCfgById$(repeatCfgId).pipe(
                first(),
                switchMap((cfg) => {
                  if (!cfg.shouldInheritSubtasks) {
                    return EMPTY;
                  }
                  // auto-update is default unless explicitly disabled
                  const isAutoEnabled = !cfg.disableAutoUpdateSubtasks;
                  if (!isAutoEnabled) {
                    return EMPTY;
                  }
                  // Ensure parent is the newest live instance
                  return this._taskService.getTasksByRepeatCfgId$(repeatCfgId).pipe(
                    first(),
                    switchMap((liveInstances) => {
                      if (!liveInstances || liveInstances.length === 0) {
                        return EMPTY;
                      }
                      const newest = liveInstances.reduce((a, b) =>
                        a.created > b.created ? a : b,
                      );
                      if (newest.id !== parent.id) {
                        return EMPTY;
                      }
                      // Build templates from newest.subTaskIds order
                      return rxOf({
                        cfg,
                        newest,
                      } as {
                        cfg: TaskRepeatCfgCopy;
                        newest: Task;
                      });
                    }),
                  );
                }),
              );
            }),
            filter((res): res is { cfg: TaskRepeatCfgCopy; newest: Task } => !!res),
            switchMap(({ cfg, newest }) =>
              this._taskService.getByIdsLive$(newest.subTaskIds).pipe(
                first(),
                map((subs) => ({ cfg, newest, subs })),
              ),
            ),
            mergeMap(({ cfg, subs }) => {
              const newTemplates = this._toSubTaskTemplates(subs || []);
              if (this._templatesEqual(cfg.subTaskTemplates, newTemplates)) {
                return EMPTY;
              }
              return rxOf(
                updateTaskRepeatCfg({
                  taskRepeatCfg: {
                    id: cfg.id as string,
                    changes: { subTaskTemplates: newTemplates },
                  },
                  isAskToUpdateAllTaskInstances: false,
                }),
              );
            }),
            filter((v): v is ReturnType<typeof updateTaskRepeatCfg> => !!v),
          ),
        ),
      ),
    { dispatch: true },
  );

  /**
   * When enabling inherit subtasks in the dialog, immediately snapshots the subtasks
   * from the newest instance to set initial templates.
   */
  enableAutoUpdateOrInheritSnapshot$ = createEffect(() =>
    this._localActions$.pipe(
      ofType(updateTaskRepeatCfg),
      // only react to enabling inherit subtasks; avoids loops
      // Note: this snapshots current subtasks when inherit is enabled, regardless of auto-update flag
      filter(({ taskRepeatCfg }) => {
        const ch = taskRepeatCfg.changes as Partial<TaskRepeatCfgCopy>;
        return ch.shouldInheritSubtasks === true;
      }),
      switchMap(({ taskRepeatCfg }) =>
        this._taskRepeatCfgService.getTaskRepeatCfgById$(taskRepeatCfg.id as string).pipe(
          first(),
          switchMap((cfg) => {
            const ch = taskRepeatCfg.changes as Partial<TaskRepeatCfgCopy>;
            const shouldInherit =
              ch.shouldInheritSubtasks !== undefined
                ? ch.shouldInheritSubtasks
                : cfg.shouldInheritSubtasks;
            if (!shouldInherit) {
              return EMPTY;
            }
            // Snapshot regardless of auto-update flag to set initial templates

            const repeatCfgId = taskRepeatCfg.id as string;
            // Try newest live first
            return this._taskService.getTasksByRepeatCfgId$(repeatCfgId).pipe(
              first(),
              switchMap((liveInstances) => {
                let newestLive: Task | null = null;
                if (liveInstances && liveInstances.length) {
                  newestLive = liveInstances.reduce((a, b) =>
                    a.created > b.created ? a : b,
                  );
                }

                if (newestLive) {
                  return this._taskService.getByIdsLive$(newestLive.subTaskIds).pipe(
                    first(),
                    map((subs) => ({ cfg, subs })),
                  );
                }

                // fallback to archive
                return from(
                  this._taskService.getArchiveTasksForRepeatCfgId(repeatCfgId),
                ).pipe(
                  switchMap((arch) => {
                    if (!arch || arch.length === 0) {
                      return rxOf({ cfg, subs: [] as Task[] });
                    }
                    const newest = arch.reduce((a, b) => (a.created > b.created ? a : b));
                    return from(this._taskArchiveService.load()).pipe(
                      map((archiveState) => {
                        const subs = newest.subTaskIds
                          .map((id) => archiveState.entities[id])
                          .filter(Boolean) as unknown as Task[];
                        return { cfg, subs };
                      }),
                    );
                  }),
                );
              }),
              mergeMap(({ cfg: config, subs }) => {
                const newTemplates = this._toSubTaskTemplates(subs || []);
                if (this._templatesEqual(config.subTaskTemplates, newTemplates)) {
                  return EMPTY;
                }
                return rxOf(
                  updateTaskRepeatCfg({
                    taskRepeatCfg: {
                      id: config.id as string,
                      changes: { subTaskTemplates: newTemplates },
                    },
                    isAskToUpdateAllTaskInstances: false,
                  }),
                );
              }),
              filter((v): v is ReturnType<typeof updateTaskRepeatCfg> => !!v),
            );
          }),
        ),
      ),
    ),
  );

  // Update startDate when a task with repeatOnComplete is marked as done
  updateStartDateOnComplete$ = createEffect(() =>
    this._localActions$.pipe(
      ofType(TaskSharedActions.updateTask),
      filter((a) => a.task.changes.isDone === true),
      switchMap(({ task }) =>
        this._taskService
          .getByIdOnce$(task.id as string)
          .pipe(map((fullTask) => fullTask)),
      ),
      filter((task) => !!task?.repeatCfgId),
      switchMap((task) =>
        this._taskRepeatCfgService.getTaskRepeatCfgById$(task.repeatCfgId as string).pipe(
          take(1),
          map((cfg) => ({ task, cfg })),
        ),
      ),
      filter(({ cfg }) => !!cfg && cfg.repeatFromCompletionDate === true),
      filter(({ task, cfg }) => this._isLatestInstance(task, cfg)),
      map(({ cfg }) => {
        const today = this._dateService.todayStr();
        return updateTaskRepeatCfg({
          taskRepeatCfg: {
            id: cfg.id as string,
            changes: {
              startDate: today,
              lastTaskCreationDay: today,
            },
          },
        });
      }),
    ),
  );

  checkToUpdateAllTaskInstances$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(updateTaskRepeatCfg),
        filter(({ isAskToUpdateAllTaskInstances }) => !!isAskToUpdateAllTaskInstances),
        concatMap(({ taskRepeatCfg }) => {
          const id = taskRepeatCfg.id as string;
          return forkJoin([
            rxOf(taskRepeatCfg),
            this._taskService.getTasksByRepeatCfgId$(id).pipe(first()),
            this._taskService.getArchiveTasksForRepeatCfgId(id),
          ]);
        }),
        concatMap(([{ id, changes }, todayTasks, archiveTasks]) => {
          if (todayTasks.length + archiveTasks.length === 0) {
            return rxOf(false);
          }
          // NOTE: there will always be at least on instance, since we're editing it
          return this._matDialog
            .open(DialogConfirmComponent, {
              restoreFocus: true,
              data: {
                okTxt: T.F.TASK_REPEAT.D_CONFIRM_UPDATE_INSTANCES.OK,
                cancelTxt: T.F.TASK_REPEAT.D_CONFIRM_UPDATE_INSTANCES.CANCEL,
                message: T.F.TASK_REPEAT.D_CONFIRM_UPDATE_INSTANCES.MSG,
                translateParams: { tasksNr: todayTasks.length + archiveTasks.length },
              },
            })
            .afterClosed()
            .pipe(
              withLatestFrom(
                this._taskRepeatCfgService.getTaskRepeatCfgById$(id as string),
              ),
              tap(([isConfirm, completeCfg]) => {
                if (isConfirm) {
                  Log.log(changes);
                  Log.log(todayTasks, archiveTasks);
                  // NOTE: keep in mind that it's very likely that there will be only one task for today
                  // TODO update reminders if given
                  todayTasks.forEach((task) =>
                    this._updateRegularTaskInstance(task, changes, completeCfg),
                  );

                  const archiveUpdates: Update<TaskCopy>[] = archiveTasks.map((task) => {
                    const changesForArchiveTask: Partial<TaskCopy> = {};
                    // NOTE: projects can't be updated from the dialog
                    // if (
                    //   typeof changes.projectId === 'string' &&
                    //   task.projectId !== changes.projectId
                    // ) {
                    //   changesForArchiveTask.projectId = changes.projectId;
                    //   // TODO also update sub tasks
                    //   if (task.subTaskIds) {
                    //     task.subTaskIds.forEach((subTaskId) => {
                    //       this._taskService.updateArchiveTask(
                    //         subTaskId,
                    //         changesForArchiveTask,
                    //       );
                    //     });
                    //   }
                    // }
                    if (changes.tagIds) {
                      changesForArchiveTask.tagIds = changes.tagIds;
                    }
                    if (changes.title) {
                      changesForArchiveTask.title = changes.title;
                    }
                    if (changes.notes) {
                      changesForArchiveTask.notes = changes.notes;
                    }
                    if (
                      typeof changes.defaultEstimate === 'number' &&
                      task.subTaskIds.length === 0
                    ) {
                      changesForArchiveTask.timeEstimate = changes.defaultEstimate;
                    }
                    Log.log('updateArchiveTask', changesForArchiveTask);
                    return { id: task.id, changes: changesForArchiveTask };
                  });
                  this._taskService.updateArchiveTasks(archiveUpdates);
                }
              }),
            );
        }),
      ),
    { dispatch: false },
  );

  private _updateRegularTaskInstance(
    task: TaskCopy,
    changes: Partial<TaskRepeatCfgCopy>,
    completeCfg: TaskRepeatCfgCopy,
  ): void {
    // NOTE: projects can't be updated from the dialog,
    // if (
    //   typeof changes.projectId === 'string' &&
    //   task.projectId !== changes.projectId
    // ) {
    //   const withSubTasks = await this._taskService
    //     .getByIdWithSubTaskData$(task.id)
    //     .pipe(take(1))
    //     .toPromise();
    //   this._taskService.moveToProject(withSubTasks, changes.projectId);
    // }
    if (
      (changes.startTime || changes.remindAt) &&
      completeCfg.remindAt &&
      completeCfg.startTime &&
      this._dateService.isToday(task.created)
    ) {
      const dateTime = getDateTimeFromClockString(
        completeCfg.startTime as string,
        new Date(),
      );
      if (task.remindAt) {
        this._taskService.reScheduleTask({
          task,
          due: dateTime,
          remindCfg: completeCfg.remindAt,
          isMoveToBacklog: false,
        });
      } else {
        this._taskService.scheduleTask(task, dateTime, completeCfg.remindAt);
      }
    }
    if (changes.tagIds) {
      this._taskService.updateTags(task, changes.tagIds);
    }
    if (changes.title || changes.notes) {
      this._taskService.update(task.id, {
        ...(changes.title
          ? {
              title: changes.title,
            }
          : {}),
        ...(changes.notes
          ? {
              notes: changes.notes,
            }
          : {}),
      });
    }
    if (typeof changes.defaultEstimate === 'number' && task.subTaskIds.length === 0) {
      this._taskService.update(task.id, {
        timeEstimate: changes.defaultEstimate,
      });
    }
  }

  private _templatesEqual(
    a: TaskRepeatCfgCopy['subTaskTemplates'] | undefined,
    b: NonNullable<TaskRepeatCfgCopy['subTaskTemplates']>,
  ): boolean {
    const aArr = a || [];
    if (aArr.length !== b.length) {
      return false;
    }
    for (let i = 0; i < aArr.length; i++) {
      const ai = aArr[i];
      const bi = b[i];
      if (
        ai.title !== bi.title ||
        (ai.notes || '') !== (bi.notes || '') ||
        (ai.timeEstimate || 0) !== (bi.timeEstimate || 0)
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Determines if an action is relevant for subtask template syncing
   */
  private _isRelevantSubtaskAction(action: any): boolean {
    if (action.type === TaskSharedActions.deleteTask.type) {
      const task = action.task as Task | undefined;
      return !!task && !!task.parentId;
    }
    return true;
  }

  /**
   * Resolves the parent task from an action that might affect subtasks
   */
  private _resolveParentTaskFromAction(action: any): Observable<Task | null> {
    const parentId: string | undefined = action.parentId || action.srcTaskId;
    const updatedTaskId: string | undefined = action.task?.id || action.id;

    if (!parentId && !updatedTaskId) {
      return EMPTY;
    }

    // Resolve the parent: if parentId given use it, else try to get parent via updated task
    const resolveParent$ = parentId
      ? this._taskService.getByIdOnce$(parentId)
      : updatedTaskId
        ? this._taskService
            .getByIdOnce$(updatedTaskId as string)
            .pipe(
              switchMap((t) =>
                t && t.parentId ? this._taskService.getByIdOnce$(t.parentId) : rxOf(null),
              ),
            )
        : rxOf(null);

    return resolveParent$;
  }

  /**
   * Converts tasks to subtask templates with only essential fields
   */
  private _toSubTaskTemplates(
    subs: Task[],
  ): NonNullable<TaskRepeatCfgCopy['subTaskTemplates']> {
    return subs.map((st) => ({
      title: st.title,
      notes: st.notes,
      timeEstimate: st.timeEstimate,
    }));
  }

  private _isLatestInstance(task: Task, cfg: TaskRepeatCfgCopy): boolean {
    const lastCreationDay = getEffectiveLastTaskCreationDay(cfg);
    if (!lastCreationDay) {
      return true;
    }
    // Only allow repeat-from-completion to advance configs when the finished task
    // represents the most recently generated instance. Completing an archived/old
    // copy previously skipped ahead incorrectly.
    const taskDay =
      task.dueDay ||
      (task.dueWithTime ? getDbDateStr(task.dueWithTime) : getDbDateStr(task.created));
    return taskDay === lastCreationDay;
  }
}
