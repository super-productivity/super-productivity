import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { select, Store } from '@ngrx/store';
import {
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import {
  selectTaskById,
  selectTaskFeatureState,
} from '../features/tasks/store/task.selectors';
import { selectProjectFeatureState } from '../features/project/store/project.selectors';
import { selectLocalizationConfig } from '../features/config/store/global-config.reducer';
import { updateGlobalConfigSection } from '../features/config/store/global-config.actions';
import { Task } from '../features/tasks/task.model';
import { PluginService } from './plugin.service';
import { PluginHooks } from './plugin-api.model';
import { PluginI18nService } from './plugin-i18n.service';
import { TaskSharedActions } from '../root-store/meta/task-shared.actions';
import {
  setCurrentTask,
  unsetCurrentTask,
  moveSubTask,
  moveSubTaskUp,
  moveSubTaskDown,
  moveSubTaskToTop,
  moveSubTaskToBottom,
  addSubTask, // Added
} from '../features/tasks/store/task.actions';
import * as projectActions from '../features/project/store/project.actions';
import { updateProject } from '../features/project/store/project.actions';
import {
  moveTaskDownInTodayList,
  moveTaskInTodayList,
  moveTaskToBottomInTodayList,
  moveTaskToTopInTodayList,
  moveTaskUpInTodayList,
} from '../features/work-context/store/work-context-meta.actions';
import { LOCAL_ACTIONS } from '../util/local-actions.token';
import { PlannerActions } from '../features/planner/store/planner.actions';
import { LanguageCode } from '../core/locale.constants';

@Injectable()
export class PluginHooksEffects {
  private readonly actions$ = inject(LOCAL_ACTIONS);
  private readonly store = inject(Store);
  private readonly pluginService = inject(PluginService);
  private readonly pluginI18nService = inject(PluginI18nService);

  taskComplete$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter((action) => action.task.changes.isDone === true),
        switchMap((action) =>
          this.store.pipe(
            select(selectTaskById, { id: action.task.id as string }),
            take(1),
            tap((task: Task | undefined) => {
              if (task) {
                this.pluginService.dispatchHook(PluginHooks.TASK_COMPLETE, {
                  taskId: task.id,
                  task,
                });
              }
            }),
            map(() => EMPTY),
          ),
        ),
      ),
    { dispatch: false },
  );

  onCurrentTaskChange$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(setCurrentTask, unsetCurrentTask),
        withLatestFrom(this.store.pipe(select(selectTaskFeatureState))),
        map(([action, taskState]) => {
          this.pluginService.dispatchHook(
            PluginHooks.CURRENT_TASK_CHANGE,
            taskState.currentTaskId,
          );
        }),
      ),
    { dispatch: false },
  );

  taskUpdate$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          TaskSharedActions.updateTask,
          TaskSharedActions.scheduleTaskWithTime,
          TaskSharedActions.reScheduleTaskWithTime,
          TaskSharedActions.unscheduleTask,
          PlannerActions.planTaskForDay,
          PlannerActions.transferTask,
        ),
        switchMap((action) => {
          // Extract task ID and changes based on action type
          let taskId: string;
          let changes: Partial<Task>;

          if (action.type === TaskSharedActions.updateTask.type) {
            taskId = action.task.id as string;
            changes = action.task.changes;
          } else if (
            action.type === TaskSharedActions.scheduleTaskWithTime.type ||
            action.type === TaskSharedActions.reScheduleTaskWithTime.type
          ) {
            taskId = action.task.id;
            changes = { dueWithTime: action.dueWithTime, dueDay: undefined };
          } else if (action.type === TaskSharedActions.unscheduleTask.type) {
            taskId = action.id;
            changes = { dueWithTime: undefined, reminderId: undefined };
          } else if (action.type === PlannerActions.planTaskForDay.type) {
            taskId = action.task.id;
            changes = { dueDay: action.day, dueWithTime: undefined };
          } else if (action.type === PlannerActions.transferTask.type) {
            taskId = action.task.id;
            changes = { dueDay: action.newDay as string };
          } else {
            return EMPTY;
          }

          return this.store.pipe(
            select(selectTaskById, { id: taskId }),
            take(1),
            tap((task: Task | undefined) => {
              if (task) {
                this.pluginService.dispatchHook(PluginHooks.TASK_UPDATE, {
                  taskId: task.id,
                  task,
                  changes,
                });
              }
            }),
            map(() => EMPTY),
          );
        }),
      ),
    { dispatch: false },
  );

  taskDelete$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        tap((action) => {
          this.pluginService.dispatchHook(PluginHooks.TASK_DELETE, {
            taskId: action.task.id,
          });
        }),
      ),
    { dispatch: false },
  );

  tasksDelete$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(TaskSharedActions.deleteTasks),
        tap((action) => {
          this.pluginService.dispatchHook(PluginHooks.TASK_DELETE, {
            taskIds: action.taskIds,
          });
        }),
      ),
    { dispatch: false },
  );

  taskAdd$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(TaskSharedActions.addTask, addSubTask),
        switchMap((action) =>
          this.store.pipe(
            select(selectTaskById, { id: action.task.id }),
            take(1),
            filter((task) => !!task),
            tap((task: Task | undefined) => {
              if (task) {
                this.pluginService.dispatchHook(PluginHooks.TASK_CREATED, {
                  taskId: task.id,
                  task,
                });
                // Also dispatch legacy update for backward compatibility if needed,
                // but generally TASK_CREATED should be preferred.
                // Leaving TASK_UPDATE out as 'taskCreated' is the specific hook now.
              }
            }),
            map(() => EMPTY),
          ),
        ),
      ),
    { dispatch: false },
  );

  // Language change effect - listens to actual language config changes
  languageChange$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(updateGlobalConfigSection),
        filter((action) => action.sectionKey === 'localization'),
        withLatestFrom(this.store.pipe(select(selectLocalizationConfig))),
        map(([_, localizationConfig]) => localizationConfig.lng),
        filter((lng): lng is LanguageCode => typeof lng === 'string' && lng.length > 0),
        distinctUntilChanged(),
        tap((newLanguage) => {
          // Update plugin i18n service with new language
          this.pluginI18nService.setCurrentLanguage(newLanguage);

          // Dispatch hook to notify plugins
          this.pluginService.dispatchHook(PluginHooks.LANGUAGE_CHANGE, {
            newLanguage,
          });
        }),
      ),
    { dispatch: false },
  );

  finishDay$ = createEffect(
    () =>
      this.actions$.pipe(
        filter((action) => action.type === 'FINISH_DAY'),
        tap(() => {
          this.pluginService.dispatchHook(PluginHooks.FINISH_DAY);
        }),
      ),
    { dispatch: false },
  );

  // Trigger for ANY task update (add, update, delete, move subtasks)
  anyTaskUpdate$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          TaskSharedActions.addTask,
          TaskSharedActions.updateTask,
          TaskSharedActions.deleteTask,
          TaskSharedActions.deleteTasks,
          // Include subtask move actions
          moveSubTask,
          moveSubTaskUp,
          moveSubTaskDown,
          moveSubTaskToTop,
          moveSubTaskToBottom,
        ),
        withLatestFrom(this.store.pipe(select(selectTaskFeatureState))),
        tap(([action, taskState]) => {
          let task: Task | undefined;
          let taskId: string | undefined;

          if ('task' in action) {
            taskId = typeof action.task.id === 'string' ? action.task.id : undefined;
            // Check if it's a full Task object (has title) vs Update<Task>
            if ('title' in action.task) {
              task = action.task as Task;
            }
          } else if ('taskId' in action) {
            taskId = action.taskId;
          } else if ('id' in action) {
            taskId = action.id;
          } else if ('taskIds' in action) {
            if (action.taskIds.length === 1) {
              taskId = action.taskIds[0];
            }
          }

          // If we have an ID but no task object (e.g. updateTask, move actions), try to get it from state
          if (!task && taskId) {
            task = taskState.entities[taskId];
          }

          this.pluginService.dispatchHook(PluginHooks.ANY_TASK_UPDATE, {
            action: action.type,
            task,
            taskId,
            taskState,
          });
        }),
      ),
    { dispatch: false },
  );

  // Trigger when project taskIds or backlogTaskIds change
  projectListUpdate$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          // Direct project updates
          updateProject,
          // Task-related actions that affect project lists
          TaskSharedActions.addTask,
          TaskSharedActions.deleteTask,
          TaskSharedActions.deleteTasks,
          TaskSharedActions.moveToOtherProject,
          // Project task list actions
          projectActions.moveProjectTaskToBacklogListAuto,
          projectActions.moveProjectTaskToRegularListAuto,
          projectActions.moveProjectTaskUpInBacklogList,
          projectActions.moveProjectTaskDownInBacklogList,
          projectActions.moveProjectTaskToTopInBacklogList,
          projectActions.moveProjectTaskToBottomInBacklogList,
          projectActions.moveProjectTaskInBacklogList,
          projectActions.moveProjectTaskToBacklogList,
          projectActions.moveProjectTaskToRegularList,
          projectActions.moveAllProjectBacklogTasksToRegularList,

          // cross model
          moveTaskInTodayList,
          moveTaskUpInTodayList,
          moveTaskDownInTodayList,
          moveTaskToTopInTodayList,
          moveTaskToBottomInTodayList,
        ),
        withLatestFrom(this.store.pipe(select(selectProjectFeatureState))),
        tap(([action, projectState]) => {
          this.pluginService.dispatchHook(PluginHooks.PROJECT_LIST_UPDATE, {
            action: action.type,
            projectState,
          });
        }),
      ),
    { dispatch: false },
  );

  // private static hiddenActions = [];
  anyAction$ = createEffect(
    () =>
      this.actions$.pipe(
        tap((action) => {
          this.pluginService.dispatchHook(PluginHooks.ACTION, {
            action,
          });
        }),
      ),
    { dispatch: false },
  );
}
