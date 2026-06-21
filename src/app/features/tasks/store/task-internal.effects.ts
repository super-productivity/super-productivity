import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import {
  addSubTask,
  setCurrentTask,
  toggleStart,
  unsetCurrentTask,
} from './task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { select, Store } from '@ngrx/store';
import { filter, map, mergeMap, withLatestFrom, concatMap } from 'rxjs/operators';
import { selectTaskFeatureState } from './task.selectors';
import { MatDialog } from '@angular/material/dialog';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../../t.const';
import {
  selectConfigFeatureState,
  selectTasksConfig,
} from '../../config/store/global-config.reducer';
import { Task, TaskCopy, TaskState } from '../task.model';
import { EMPTY, of } from 'rxjs';
import { WorkContextService } from '../../work-context/work-context.service';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import {
  moveProjectTaskToBacklogList,
  moveProjectTaskToBacklogListAuto,
} from '../../project/store/project.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DateService } from '../../../core/date/date.service';

@Injectable()
export class TaskInternalEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject(Store);
  private _workContextSession = inject(WorkContextService);
  private _dateService = inject(DateService);
  private _matDialog = inject(MatDialog);

  onAllSubTasksDone$ = createEffect(() =>
    this._actions$.pipe(
      ofType(TaskSharedActions.updateTask),
      withLatestFrom(
        this._store$.pipe(select(selectTasksConfig)),
        this._store$.pipe(select(selectTaskFeatureState)),
      ),
      filter(
        ([{ task }, tasksCfg, state]) =>
          !!tasksCfg &&
          tasksCfg.isAutoMarkParentAsDone &&
          !!task.changes.isDone &&
          !!state.entities[task.id as string]?.parentId,
      ),
      filter(([action, miscCfg, state]) => {
        const task = state.entities[action.task.id];
        if (!task || !task.parentId) {
          return false;
        }
        const parent = state.entities[task.parentId] as Task;
        const undoneSubTasks = parent.subTaskIds.filter(
          (id) => !(state.entities[id] as Task).isDone,
        );
        return undoneSubTasks.length === 0;
      }),
      map(([action, miscCfg, state]) =>
        TaskSharedActions.updateTask({
          task: {
            id: (state.entities[action.task.id] as Task).parentId as string,
            changes: { isDone: true },
          },
        }),
      ),
    ),
  );

  confirmAndUpdateSubtaskDates$ = createEffect(() =>
    this._actions$.pipe(
      ofType(
        TaskSharedActions.updateTask,
        TaskSharedActions.updateTasks,
        TaskSharedActions.scheduleTaskWithTime,
        TaskSharedActions.reScheduleTaskWithTime,
        TaskSharedActions.unscheduleTask,
        PlannerActions.planTaskForDay,
        TaskSharedActions.planTasksForToday,
        TaskSharedActions.setDeadline,
        TaskSharedActions.removeDeadline,
      ),
      filter(
        (action) =>
          !(action as { isSkipSubTaskDateUpdatePrompt?: boolean })
            .isSkipSubTaskDateUpdatePrompt,
      ),
      filter((action) => {
        if (action.type === TaskSharedActions.updateTask.type) {
          const changes = (action as any).task.changes;
          return (
            'dueDay' in changes ||
            'dueWithTime' in changes ||
            'remindAt' in changes ||
            'deadlineDay' in changes ||
            'deadlineWithTime' in changes ||
            'deadlineRemindAt' in changes
          );
        }
        if (action.type === TaskSharedActions.updateTasks.type) {
          return (action as any).tasks.some(
            (t: any) =>
              'dueDay' in t.changes ||
              'dueWithTime' in t.changes ||
              'remindAt' in t.changes ||
              'deadlineDay' in t.changes ||
              'deadlineWithTime' in t.changes ||
              'deadlineRemindAt' in t.changes,
          );
        }
        return true;
      }),
      withLatestFrom(this._store$.pipe(select(selectTaskFeatureState))),
      map(([action, state]) => {
        let taskIds: string[] = [];
        if (action.type === TaskSharedActions.updateTask.type) {
          taskIds = [(action as any).task.id];
        } else if (action.type === TaskSharedActions.updateTasks.type) {
          taskIds = (action as any).tasks.map((t: any) => t.id);
        } else if (
          action.type === TaskSharedActions.scheduleTaskWithTime.type ||
          action.type === TaskSharedActions.reScheduleTaskWithTime.type ||
          action.type === PlannerActions.planTaskForDay.type
        ) {
          taskIds = [(action as any).task.id];
        } else if (action.type === TaskSharedActions.unscheduleTask.type) {
          taskIds = [(action as any).id];
        } else if (action.type === TaskSharedActions.planTasksForToday.type) {
          taskIds = (action as any).taskIds;
        } else if (
          action.type === TaskSharedActions.setDeadline.type ||
          action.type === TaskSharedActions.removeDeadline.type
        ) {
          taskIds = [(action as any).taskId];
        }

        const isDueDateAction =
          (action.type === TaskSharedActions.updateTask.type &&
            ('dueDay' in (action as any).task.changes ||
              'dueWithTime' in (action as any).task.changes ||
              'remindAt' in (action as any).task.changes)) ||
          (action.type === TaskSharedActions.updateTasks.type &&
            (action as any).tasks.some(
              (t: any) =>
                'dueDay' in t.changes ||
                'dueWithTime' in t.changes ||
                'remindAt' in t.changes,
            )) ||
          action.type === TaskSharedActions.scheduleTaskWithTime.type ||
          action.type === TaskSharedActions.reScheduleTaskWithTime.type ||
          action.type === TaskSharedActions.unscheduleTask.type ||
          action.type === PlannerActions.planTaskForDay.type ||
          action.type === TaskSharedActions.planTasksForToday.type;

        const isDeadlineAction =
          (action.type === TaskSharedActions.updateTask.type &&
            ('deadlineDay' in (action as any).task.changes ||
              'deadlineWithTime' in (action as any).task.changes ||
              'deadlineRemindAt' in (action as any).task.changes)) ||
          (action.type === TaskSharedActions.updateTasks.type &&
            (action as any).tasks.some(
              (t: any) =>
                'deadlineDay' in t.changes ||
                'deadlineWithTime' in t.changes ||
                'deadlineRemindAt' in t.changes,
            )) ||
          action.type === TaskSharedActions.setDeadline.type ||
          action.type === TaskSharedActions.removeDeadline.type;

        const promptRequests: {
          subTaskIds: string[];
          message: string;
          okTxt: string;
          changes: Partial<TaskCopy>;
        }[] = [];

        for (const id of taskIds) {
          const parent = state.entities[id];
          if (parent && parent.subTaskIds && parent.subTaskIds.length > 0) {
            if (isDueDateAction) {
              const hasDifferentDueDate = parent.subTaskIds.some((subId) => {
                const subtask = state.entities[subId];
                if (!subtask) return false;
                return (
                  subtask.dueDay !== parent.dueDay ||
                  subtask.dueWithTime !== parent.dueWithTime ||
                  subtask.remindAt !== parent.remindAt
                );
              });
              if (hasDifferentDueDate) {
                const isRemoval = !parent.dueDay && !parent.dueWithTime;
                promptRequests.push({
                  subTaskIds: parent.subTaskIds,
                  message: isRemoval
                    ? T.F.TASK.D_CONFIRM_REMOVE_SUBTASK_DUE_DATE.MSG
                    : T.F.TASK.D_CONFIRM_UPDATE_SUBTASK_DUE_DATE.MSG,
                  okTxt: isRemoval
                    ? T.F.TASK.D_CONFIRM_REMOVE_SUBTASK_DUE_DATE.OK
                    : T.F.TASK.D_CONFIRM_UPDATE_SUBTASK_DUE_DATE.OK,
                  changes: {
                    dueDay: parent.dueDay || null,
                    dueWithTime: parent.dueWithTime || null,
                    remindAt: parent.remindAt || undefined,
                  },
                });
              }
            }
            if (isDeadlineAction) {
              const hasDifferentDeadline = parent.subTaskIds.some((subId) => {
                const subtask = state.entities[subId];
                if (!subtask) return false;
                return (
                  subtask.deadlineDay !== parent.deadlineDay ||
                  subtask.deadlineWithTime !== parent.deadlineWithTime ||
                  subtask.deadlineRemindAt !== parent.deadlineRemindAt
                );
              });
              if (hasDifferentDeadline) {
                const isRemoval = !parent.deadlineDay && !parent.deadlineWithTime;
                promptRequests.push({
                  subTaskIds: parent.subTaskIds,
                  message: isRemoval
                    ? T.F.TASK.D_CONFIRM_REMOVE_SUBTASK_DEADLINE.MSG
                    : T.F.TASK.D_CONFIRM_UPDATE_SUBTASK_DEADLINE.MSG,
                  okTxt: isRemoval
                    ? T.F.TASK.D_CONFIRM_REMOVE_SUBTASK_DEADLINE.OK
                    : T.F.TASK.D_CONFIRM_UPDATE_SUBTASK_DEADLINE.OK,
                  changes: {
                    deadlineDay: parent.deadlineDay || null,
                    deadlineWithTime: parent.deadlineWithTime || null,
                    deadlineRemindAt: parent.deadlineRemindAt || null,
                  },
                });
              }
            }
          }
        }

        return promptRequests.length > 0 ? promptRequests : null;
      }),
      filter((requests): requests is NonNullable<typeof requests> => requests !== null),
      concatMap((requests) => {
        return of(...requests).pipe(
          concatMap((req) => {
            return this._matDialog
              .open(DialogConfirmComponent, {
                data: {
                  message: req.message,
                  okTxt: req.okTxt,
                },
              })
              .afterClosed()
              .pipe(
                map((isConfirm) => ({
                  isConfirm,
                  req,
                })),
              );
          }),
        );
      }),
      filter(({ isConfirm }) => !!isConfirm),
      map(({ req }) => {
        const updates = req.subTaskIds.map((subTaskId) => ({
          id: subTaskId,
          changes: req.changes,
        }));
        return TaskSharedActions.updateTasks({ tasks: updates });
      }),
    ),
  );

  setDefaultEstimateIfNonGiven$ = createEffect(() =>
    this._actions$.pipe(
      ofType(TaskSharedActions.addTask, addSubTask),
      filter(({ task }) => !task.timeEstimate),
      withLatestFrom(this._store$.pipe(select(selectConfigFeatureState))),
      map(([action, cfg]) => ({
        timeEstimate:
          (action.task.parentId || (action.type === addSubTask.type && action.parentId)
            ? cfg.timeTracking.defaultEstimateSubTasks
            : cfg.timeTracking.defaultEstimate) || 0,
        task: action.task,
      })),
      filter(({ timeEstimate }) => timeEstimate > 0),
      map(({ task, timeEstimate }) =>
        TaskSharedActions.updateTask({
          task: {
            id: task.id,
            changes: {
              timeEstimate,
            },
          },
        }),
      ),
    ),
  );

  planStartedTaskForToday$ = createEffect(() =>
    this._actions$.pipe(
      ofType(setCurrentTask),
      withLatestFrom(
        this._store$.pipe(select(selectTaskFeatureState)),
        this._store$.pipe(select(selectTodayTaskIds)),
      ),
      mergeMap(([, state, todayTaskIds]) => {
        const currentTaskId = state.currentTaskId;
        if (!currentTaskId) {
          return EMPTY;
        }

        const currentTask = state.entities[currentTaskId] as Task | undefined;
        if (
          !currentTask ||
          todayTaskIds.includes(currentTaskId) ||
          (!!currentTask.parentId && todayTaskIds.includes(currentTask.parentId))
        ) {
          return EMPTY;
        }

        return of(
          TaskSharedActions.planTasksForToday({
            taskIds: [currentTaskId],
            today: this._dateService.todayStr(),
            startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
            parentTaskMap: { [currentTaskId]: currentTask.parentId },
          }),
        );
      }),
    ),
  );

  autoSetNextTask$ = createEffect(() =>
    this._actions$.pipe(
      ofType(
        toggleStart,
        TaskSharedActions.updateTask,
        TaskSharedActions.deleteTask,
        TaskSharedActions.moveToArchive,

        moveProjectTaskToBacklogList.type,
        moveProjectTaskToBacklogListAuto.type,
      ),
      withLatestFrom(
        this._store$.pipe(select(selectConfigFeatureState)),
        this._store$.pipe(select(selectTaskFeatureState)),
        this._workContextSession.mainListTaskIds$,
        (action, globalCfg, state, todaysTaskIds) => ({
          action,
          state,
          isAutoStartNextTask: globalCfg.timeTracking.isAutoStartNextTask,
          todaysTaskIds,
        }),
      ),
      mergeMap(({ action, state, isAutoStartNextTask, todaysTaskIds }) => {
        const currentId = state.currentTaskId;
        let nextId: 'NO_UPDATE' | string | null;

        switch (action.type) {
          case toggleStart.type: {
            nextId = state.currentTaskId
              ? null
              : this._findNextTask(state, todaysTaskIds);
            break;
          }

          case TaskSharedActions.updateTask.type: {
            // TODO fix typing here
            const a = action as any;
            const { isDone } = a.task.changes;
            const oldId = a.task.id;
            const isCurrent = oldId === currentId;
            nextId =
              isDone && isCurrent
                ? isAutoStartNextTask
                  ? this._findNextTask(state, todaysTaskIds, oldId as string)
                  : null
                : 'NO_UPDATE';
            break;
          }

          case moveProjectTaskToBacklogList.type:
          case moveProjectTaskToBacklogListAuto.type: {
            const isCurrent = currentId === (action as any).taskId;
            nextId = isCurrent ? null : 'NO_UPDATE';
            break;
          }

          // QUICK FIX FOR THE ISSUE
          // TODO better solution
          case TaskSharedActions.deleteTask.type: {
            nextId = state.currentTaskId;
            break;
          }
          default:
            nextId = null;

          // NOTE: currently no solution for this, but we're probably fine, as the current task
          // gets unset every time we go to the finish day view
          // case TaskSharedActions.moveToArchive: {}
        }

        if (nextId === 'NO_UPDATE') {
          return EMPTY;
        } else {
          if (nextId) {
            return of(setCurrentTask({ id: nextId }));
          } else {
            return of(unsetCurrentTask());
          }
        }
      }),
    ),
  );

  private _findNextTask(
    state: TaskState,
    todaysTaskIds: string[],
    oldCurrentId?: string,
  ): string | null {
    let nextId: string | null = null;
    const { entities } = state;

    const filterUndoneNotCurrent = (id: string): boolean =>
      !(entities[id] as Task).isDone && id !== oldCurrentId;
    const flattenToSelectable = (arr: string[]): string[] =>
      arr.reduce((acc: string[], next: string) => {
        return (entities[next] as Task).subTaskIds.length > 0
          ? acc.concat((entities[next] as Task).subTaskIds)
          : acc.concat(next);
      }, []);

    if (oldCurrentId) {
      const oldCurTask = entities[oldCurrentId];
      if (oldCurTask && oldCurTask.parentId) {
        (entities[oldCurTask.parentId] as Task).subTaskIds.some((id) => {
          return id !== oldCurrentId && !(entities[id] as Task).isDone
            ? (nextId = id) && true // assign !!!
            : false;
        });
      }

      if (!nextId) {
        const oldCurIndex = todaysTaskIds.indexOf(oldCurrentId);
        const mainTasksBefore = todaysTaskIds.slice(0, oldCurIndex);
        const mainTasksAfter = todaysTaskIds.slice(oldCurIndex + 1);
        const selectableBefore = flattenToSelectable(mainTasksBefore);
        const selectableAfter = flattenToSelectable(mainTasksAfter);
        nextId =
          selectableAfter.find(filterUndoneNotCurrent) ||
          selectableBefore.reverse().find(filterUndoneNotCurrent) ||
          null;
        nextId = Array.isArray(nextId) ? nextId[0] : nextId;
      }
    } else {
      const lastTask = state.lastCurrentTaskId && entities[state.lastCurrentTaskId];
      const isLastSelectable =
        state.lastCurrentTaskId &&
        lastTask &&
        !lastTask.isDone &&
        !lastTask.subTaskIds.length;
      if (isLastSelectable) {
        nextId = state.lastCurrentTaskId;
      } else {
        const selectable =
          flattenToSelectable(todaysTaskIds).find(filterUndoneNotCurrent);
        nextId = Array.isArray(selectable) ? selectable[0] : selectable;
      }
    }

    return nextId;
  }
}
