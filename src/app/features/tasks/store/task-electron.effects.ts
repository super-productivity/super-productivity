import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { setCurrentTask, unsetCurrentTask } from './task.actions';
import { select, Store } from '@ngrx/store';
import {
  filter,
  map,
  startWith,
  take,
  tap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import { combineLatest as combineLatestObservable, Observable } from 'rxjs';
import {
  selectCurrentTask,
  selectTaskEntities,
  selectUndoneOverdue,
} from './task.selectors';
import {
  selectActiveWorkContext,
  selectTodayTaskIds,
} from '../../work-context/store/work-context.selectors';
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
  tick,
  unPauseFocusSession,
} from '../../focus-mode/store/focus-mode.actions';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import { ipcAddTaskFromAppUri$ } from '../../../core/ipc-events';
import { TaskService } from '../task.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { NoteService } from '../../note/note.service';
import { selectNoteFeatureState } from '../../note/store/note.reducer';
import {
  selectAllTasksDueToday,
  selectPlannerDayMap,
} from '../../planner/store/planner.selectors';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import { selectEnabledSimpleCounters } from '../../simple-counter/store/simple-counter.reducer';
import { selectTodayStr } from '../../../root-store/app-state/app-state.selectors';
import { selectTodayTagTaskIds } from '../../tag/store/tag.reducer';
import { TODAY_TAG } from '../../tag/tag.const';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { SimpleCounterType } from '../../simple-counter/simple-counter.model';
import {
  TaskWidgetGoal,
  TaskWidgetNote,
  TaskWidgetOverview,
  TaskWidgetPlannerDay,
  TaskWidgetProjectGroup,
  TaskWidgetTask,
} from '../task-widget-overview.model';
import { Note, NoteState } from '../../note/note.model';
import { PlannerDayMap } from '../../planner/planner.model';
import { TaskCopy } from '../task.model';
import { WorkContext } from '../../work-context/work-context.model';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';
import { Project } from '../../project/project.model';

// TODO send message to electron when current task changes here

const TASK_WIDGET_MAX_ITEMS = 8;
const TASK_WIDGET_MAX_NOTES = 4;
const TASK_WIDGET_PLANNER_DAYS = 3;

const toWidgetTask = (task: TaskCopy, projectTitle?: string): TaskWidgetTask => ({
  id: task.id,
  title: task.title,
  timeEstimate: task.timeEstimate,
  timeSpent: task.timeSpent,
  isDone: task.isDone,
  projectId: task.projectId,
  projectTitle,
  dueDay: task.dueDay,
  dueWithTime: task.dueWithTime,
});

const toWidgetNote = (id: string, content: string): TaskWidgetNote => ({
  id,
  content: content.length > 240 ? `${content.slice(0, 237)}...` : content,
});

const getNextDateStrs = (todayStr: string): string[] => {
  const today = parseDbDateStr(todayStr);
  return Array.from({ length: TASK_WIDGET_PLANNER_DAYS }, (_, index) => {
    const dayOffsetMs = index * 24 * 60 * 60 * 1000;
    return getDbDateStr(today.getTime() + dayOffsetMs);
  });
};

const uniqueTasks = (tasks: (TaskCopy | undefined)[]): TaskCopy[] => {
  const seen = new Set<string>();
  return tasks.filter((task): task is TaskCopy => {
    if (!task || seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
};

const removeSubTasksWithListedParent = (tasks: TaskCopy[]): TaskCopy[] => {
  const taskIds = new Set(tasks.map((task) => task.id));
  return tasks.filter((task) => !task.parentId || !taskIds.has(task.parentId));
};

const sortWidgetTasks = (tasks: TaskCopy[]): TaskCopy[] =>
  [...tasks].sort((a, b) => {
    if (!!a.isDone !== !!b.isDone) return Number(a.isDone) - Number(b.isDone);
    if (a.dueWithTime && b.dueWithTime) return a.dueWithTime - b.dueWithTime;
    if (a.dueWithTime) return -1;
    if (b.dueWithTime) return 1;
    return (a.dueDay || '').localeCompare(b.dueDay || '');
  });

const getTasksForDay = (
  dayDate: string,
  plannerDayMap: PlannerDayMap,
  taskEntities: Record<string, TaskCopy | undefined>,
): TaskCopy[] => {
  const plannedTasks = plannerDayMap[dayDate] || [];
  const dueTasks = Object.values(taskEntities).filter(
    (task): task is TaskCopy =>
      !!task &&
      (task.dueDay === dayDate ||
        (!!task.dueWithTime && getDbDateStr(task.dueWithTime) === dayDate)),
  );
  return sortWidgetTasks(uniqueTasks([...plannedTasks, ...dueTasks]));
};

const mapTodayTasks = (
  todayTaskIds: string[],
  rawTodayTagTaskIds: string[],
  activeContextTodayTaskIds: string[],
  taskEntities: Record<string, TaskCopy | undefined>,
  tasksDueToday: TaskCopy[],
  plannerDayMap: PlannerDayMap,
  todayStr: string,
): TaskWidgetTask[] => {
  const todayTasks = removeSubTasksWithListedParent(
    uniqueTasks([
      ...todayTaskIds.map((id) => taskEntities[id]),
      ...activeContextTodayTaskIds.map((id) => taskEntities[id]),
      ...rawTodayTagTaskIds.map((id) => taskEntities[id]),
      ...getTasksForDay(todayStr, plannerDayMap, taskEntities),
      ...tasksDueToday,
    ]),
  );

  return sortWidgetTasks(todayTasks)
    .slice(0, TASK_WIDGET_MAX_ITEMS)
    .map((task) => toWidgetTask(task));
};

const mapTodayNotes = (noteState: NoteState): TaskWidgetNote[] =>
  noteState.todayOrder
    .map((id) => noteState.entities[id])
    .filter((note): note is Note => !!note)
    .slice(0, TASK_WIDGET_MAX_NOTES)
    .map((note) => toWidgetNote(note.id, note.content));

const mapContextNotes = (
  noteState: NoteState,
  activeContext: WorkContext | null | undefined,
): TaskWidgetNote[] =>
  (activeContext?.noteIds || [])
    .map((id) => noteState.entities[id])
    .filter((note): note is Note => !!note)
    .slice(0, TASK_WIDGET_MAX_NOTES)
    .map((note) => toWidgetNote(note.id, note.content));

const mapPlannerDays = (
  plannerDayMap: PlannerDayMap,
  todayStr: string,
  taskEntities: Record<string, TaskCopy | undefined>,
): TaskWidgetPlannerDay[] =>
  getNextDateStrs(todayStr).map((dayDate) => ({
    dayDate,
    tasks: getTasksForDay(dayDate, plannerDayMap, taskEntities)
      .filter((task) => !task.isDone)
      .slice(0, TASK_WIDGET_MAX_ITEMS)
      .map((task) => toWidgetTask(task)),
  }));

const mapProjectTaskGroups = (
  projects: Project[],
  taskEntities: Record<string, TaskCopy | undefined>,
): TaskWidgetProjectGroup[] =>
  projects
    .map((project) => {
      const indexedTaskIds = [
        ...(project.taskIds || []),
        ...(project.backlogTaskIds || []),
      ];
      const fallbackTaskIds = Object.values(taskEntities)
        .filter((task): task is TaskCopy => !!task && task.projectId === project.id)
        .map((task) => task.id);
      const taskIds = [...new Set([...indexedTaskIds, ...fallbackTaskIds])];

      return {
        id: project.id,
        title: project.title,
        tasks: taskIds
          .map((id) => taskEntities[id])
          .filter((task): task is TaskCopy => !!task && !task.parentId)
          .sort((a, b) => Number(a.isDone) - Number(b.isDone))
          .slice(0, TASK_WIDGET_MAX_ITEMS)
          .map((task) => toWidgetTask(task, project.title)),
      };
    })
    .filter((group) => group.tasks.length > 0)
    .slice(0, 6);

const mapTimelineTasks = (
  todayTasks: TaskWidgetTask[],
  taskEntities: Record<string, TaskCopy | undefined>,
): TaskWidgetTask[] =>
  todayTasks
    .map((task) => taskEntities[task.id])
    .filter((task): task is TaskCopy => !!task && !task.isDone && !!task.dueWithTime)
    .sort((a, b) => (a.dueWithTime || 0) - (b.dueWithTime || 0))
    .slice(0, TASK_WIDGET_MAX_ITEMS)
    .map((task) => toWidgetTask(task));

const mapSimpleCounterGoals = (
  counters: SimpleCounter[],
  todayStr: string,
): TaskWidgetGoal[] =>
  counters
    .filter((counter) => !!counter.isTrackStreaks && !!counter.streakMinValue)
    .slice(0, TASK_WIDGET_MAX_ITEMS)
    .map((counter) => {
      const target = counter.streakMinValue || 1;
      const value = counter.countOnDay?.[todayStr] || 0;
      return {
        id: counter.id,
        title: counter.title,
        value,
        target,
        valueType: counter.type === SimpleCounterType.StopWatch ? 'duration' : 'count',
        isReached: value >= target,
      };
    });

@Injectable()
export class TaskElectronEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject<Store<any>>(Store);
  private _configService = inject(GlobalConfigService);
  private _focusModeService = inject(FocusModeService);
  private _taskService = inject(TaskService);
  private _noteService = inject(NoteService);

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
    window.ea.on(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET, () => {
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

    window.ea.on(IPC.REQUEST_TASK_WIDGET_OVERVIEW, () => {
      this._selectTaskWidgetOverview$()
        .pipe(take(1))
        .subscribe((overview) => {
          window.ea.updateTaskWidgetOverview(overview);
        });
    });

    window.ea.onSwitchTask((taskId) => {
      this._taskService.setCurrentId(taskId);
    });

    window.ea.on(IPC.TASK_WIDGET_ADD_NOTE, (_ev, content) => {
      if (typeof content === 'string' && content.trim().length > 0) {
        this._noteService.add({ content: content.trim() }, true);
      }
    });

    window.ea.on(IPC.TASK_WIDGET_TOGGLE_TASK_DONE, (_ev, data) => {
      if (
        data &&
        typeof data === 'object' &&
        typeof (data as { taskId?: unknown }).taskId === 'string' &&
        typeof (data as { isDone?: unknown }).isDone === 'boolean'
      ) {
        this._taskService.update((data as { taskId: string }).taskId, {
          isDone: (data as { isDone: boolean }).isDone,
        });
      }
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

  private _selectTaskWidgetOverview$(): Observable<TaskWidgetOverview> {
    return combineLatestObservable([
      this._store$.pipe(select(selectTodayTaskIds)),
      this._store$.pipe(select(selectTodayTagTaskIds)),
      this._store$.pipe(select(selectTaskEntities)),
      this._store$.pipe(select(selectAllTasksDueToday)),
      this._store$.pipe(select(selectUndoneOverdue)),
      this._store$.pipe(select(selectPlannerDayMap)),
      this._store$.pipe(select(selectUnarchivedProjects)),
      this._store$.pipe(select(selectNoteFeatureState)),
      this._store$.pipe(select(selectActiveWorkContext)),
      this._store$.pipe(select(selectEnabledSimpleCounters)),
      this._store$.pipe(select(selectTodayStr)),
    ]).pipe(
      map(
        ([
          todayTaskIds,
          rawTodayTagTaskIds,
          taskEntities,
          tasksDueToday,
          overdueTasks,
          plannerDayMap,
          projects,
          noteState,
          activeContext,
          simpleCounters,
          todayStr,
        ]): TaskWidgetOverview => {
          const activeContextTodayTaskIds =
            activeContext?.id === TODAY_TAG.id ? activeContext.taskIds || [] : [];
          const todayTasks = mapTodayTasks(
            todayTaskIds,
            rawTodayTagTaskIds,
            activeContextTodayTaskIds,
            taskEntities,
            tasksDueToday,
            plannerDayMap,
            todayStr,
          );
          return {
            todayTasks,
            overdueTasks: sortWidgetTasks(overdueTasks)
              .slice(0, TASK_WIDGET_MAX_ITEMS)
              .map((task) => toWidgetTask(task)),
            projectTaskGroups: mapProjectTaskGroups(projects, taskEntities),
            timelineTasks: mapTimelineTasks(todayTasks, taskEntities),
            plannerDays: mapPlannerDays(plannerDayMap, todayStr, taskEntities),
            todayNotes: mapTodayNotes(noteState),
            projectNotes: mapContextNotes(noteState, activeContext),
            activeContextTitle: activeContext?.title || 'Today',
            simpleCounterGoals: mapSimpleCounterGoals(simpleCounters, todayStr),
          };
        },
      ),
    );
  }

  syncTaskWidgetOverviewToElectron$ = createEffect(
    () =>
      this._selectTaskWidgetOverview$().pipe(
        throttleTime(1000, undefined, { leading: true, trailing: true }),
        tap((overview) => {
          window.ea.updateTaskWidgetOverview(overview);
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
          // Keep tray time in sync during focus-mode breaks and focus sessions
          // without an active task (addTimeSpent is gated on currentTask.id).
          tick,
        ),
        // addTimeSpent and tick both fire every 1s during an active-task focus
        // session (same shared globalInterval source), so collapse them into a
        // single IPC/sec. Leading+trailing preserves immediate feedback for the
        // non-tick actions (setCurrentTask, startFocusSession, ...).
        throttleTime(500, undefined, { leading: true, trailing: true }),
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
        // The OS taskbar progress bar moves imperceptibly per second; throttling
        // collapses 1 IPC/sec into ~1 IPC/3s. Leading+trailing keeps the first
        // tick after start instant and the final value at the end of a window.
        throttleTime(3000, undefined, { leading: true, trailing: true }),
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
