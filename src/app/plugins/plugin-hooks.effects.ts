import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { select, Store } from '@ngrx/store';
import {
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  startWith,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import {
  selectCurrentTask,
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
import { WorkContextService } from '../features/work-context/work-context.service';
import { toActiveWorkContext } from './util/active-work-context.util';
import { SyncTriggerService } from '../imex/sync/sync-trigger.service';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';
import { diffChangedPluginIds } from './util/plugin-data-diff.util';

@Injectable()
export class PluginHooksEffects {
  private readonly actions$ = inject(LOCAL_ACTIONS);
  private readonly store = inject(Store);
  private readonly pluginService = inject(PluginService);
  private readonly pluginI18nService = inject(PluginI18nService);
  private readonly workContextService = inject(WorkContextService);
  private readonly syncTrigger = inject(SyncTriggerService);

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
          ),
        ),
      ),
    { dispatch: false },
  );

  // Observe the current-task selector directly so we catch every transition,
  // including those caused by reducer paths that don't dispatch
  // setCurrentTask/unsetCurrentTask (e.g. loadAllData, project delete,
  // bulk task delete). pairwise gives us { current, previous } for the
  // payload — plugins react to a single, authoritative source of truth
  // without needing to track previous state themselves.
  onCurrentTaskChange$ = createEffect(
    () =>
      this.store.pipe(
        select(selectCurrentTask),
        startWith(null as Task | null),
        pairwise(),
        // Only fire on id transitions (start/stop/switch). Same-id emissions
        // are dropped HERE rather than via distinctUntilChanged so that
        // `previous` always carries the latest snapshot of the running task
        // when it stops — including updates a plugin made to it while it
        // was running (e.g. addTag → state mutation → selector re-emits).
        filter(([prev, curr]) => prev?.id !== curr?.id),
        tap(([previous, current]) => {
          this.pluginService.dispatchHook(PluginHooks.CURRENT_TASK_CHANGE, {
            current,
            previous,
          });
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
          TaskSharedActions.moveToOtherProject,
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
          } else if (action.type === TaskSharedActions.moveToOtherProject.type) {
            taskId = action.task.id;
            changes = { projectId: action.targetProjectId };
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
              }
            }),
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

  // Fires once per work-context navigation. Distincts by (id, type) so it
  // doesn't fire when project/tag data changes (e.g. task added).
  workContextChange$ = createEffect(
    () =>
      this.workContextService.activeWorkContext$.pipe(
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.type === b?.type),
        tap((ctx) => {
          this.pluginService.dispatchHook(
            PluginHooks.WORK_CONTEXT_CHANGE,
            toActiveWorkContext(ctx),
          );
        }),
      ),
    { dispatch: false },
  );

  // Selector-based (not action-based) because remote `PLUGIN_USER_DATA`
  // upserts arrive through `bulkApplyOperations` — an `ofType` filter on the
  // local action wouldn't see them. The feature-state subscription catches
  // local writes, remote incremental sync, and post-boot `loadAllData` paths
  // (SYNC_IMPORT / BACKUP_IMPORT / validation repair / recovery) alike.
  //
  // Gated on `afterInitialSyncDoneAndDataLoadedInitially$` so the boot-time
  // selector emission seeds `pairwise` as the baseline rather than producing
  // a per-plugin flood at startup. House pattern, cf. `task-due.effects.ts`.
  //
  // No inner `waitForSyncWindow` / `skipDuringSyncWindow`: the effect is
  // `{ dispatch: false }` and creates no ops, so sync rule 2 does not apply.
  // Critically, `skipDuringSyncWindow` would suppress emissions during
  // `_isApplyingRemoteOps` — exactly the remote-sync delivery this hook
  // exists to fire on.
  firePersistedDataChanged$ = createEffect(
    () =>
      this.syncTrigger.afterInitialSyncDoneAndDataLoadedInitially$.pipe(
        filter((done) => done),
        switchMap(() =>
          this.store.pipe(
            select(selectPluginUserDataFeatureState),
            pairwise(),
            map(([prev, next]) => diffChangedPluginIds(prev, next)),
            filter((ids) => ids.length > 0),
            tap((ids) => {
              for (const pluginId of ids) {
                this.pluginService.dispatchHookToPlugin(
                  pluginId,
                  PluginHooks.PERSISTED_DATA_CHANGED,
                );
              }
            }),
          ),
        ),
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
