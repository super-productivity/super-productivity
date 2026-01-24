import { nanoid } from 'nanoid';
import typia from 'typia';
import { distinctUntilChanged, first, map, take, withLatestFrom } from 'rxjs/operators';
import { computed, effect, inject, Injectable, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  ArchiveTask,
  DEFAULT_TASK,
  DropListModelSource,
  HideSubTasksMode,
  Task,
  TaskArchive,
  TaskCopy,
  TaskDetailTargetPanel,
  TaskReminderOptionId,
  TaskState,
  TaskWithSubTasks,
} from './task.model';
import { select, Store } from '@ngrx/store';
import {
  addSubTask,
  moveSubTask,
  moveSubTaskDown,
  moveSubTaskToBottom,
  moveSubTaskToTop,
  moveSubTaskUp,
  removeTimeSpent,
  roundTimeSpentForDay,
  setCurrentTask,
  setSelectedTask,
  toggleStart,
  toggleTaskHideSubTasks,
  unsetCurrentTask,
  updateTaskUi,
} from './store/task.actions';
import { IssueProviderKey } from '../issue/issue.model';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { BatchedTimeSyncAccumulator } from '../../core/util/batched-time-sync-accumulator';
import {
  selectAllTasks,
  selectCurrentTask,
  selectCurrentTaskId,
  selectCurrentTaskParentOrCurrent,
  selectIsTaskDataLoaded,
  selectMainTasksWithoutTag,
  selectSelectedTask,
  selectSelectedTaskId,
  selectStartableTasks,
  selectTaskById,
  selectTaskByIdWithSubTaskData,
  selectTaskDetailTargetPanel,
  selectTaskFeatureState,
  selectTasksById,
  selectTasksByRepeatConfigId,
  selectTasksByTag,
  selectTaskWithSubTasksByRepeatConfigId,
} from './store/task.selectors';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { RoundTimeOption } from '../project/project.model';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import {
  moveTaskDownInTodayList,
  moveTaskInTodayList,
  moveTaskToBottomInTodayList,
  moveTaskToTopInTodayList,
  moveTaskUpInTodayList,
} from '../work-context/store/work-context-meta.actions';
import { getAnchorFromDragDrop } from '../work-context/store/work-context-meta.helper';
import { Router } from '@angular/router';
import { unique } from '../../util/unique';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { remindOptionToMilliseconds } from './util/remind-option-to-milliseconds';
import {
  moveProjectTaskDownInBacklogList,
  moveProjectTaskInBacklogList,
  moveProjectTaskToBacklogList,
  moveProjectTaskToBottomInBacklogList,
  moveProjectTaskToRegularList,
  moveProjectTaskToTopInBacklogList,
  moveProjectTaskUpInBacklogList,
} from '../project/store/project.actions';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-store/root-state';
import { DateService } from '../../core/date/date.service';
import {
  TimeTrackingActions,
  syncTimeSpent,
  syncTimeTracking,
} from '../time-tracking/store/time-tracking.actions';
import { selectTimeTrackingState } from '../time-tracking/store/time-tracking.selectors';
import { ArchiveService } from '../archive/archive.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { TODAY_TAG } from '../tag/tag.const';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { getDbDateStr } from '../../util/get-db-date-str';
import { INBOX_PROJECT } from '../project/project.const';
import { GlobalConfigService } from '../config/global-config.service';
import { TaskLog } from '../../core/log';
import { devError } from '../../util/dev-error';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { TaskFocusService } from './task-focus.service';

@Injectable({
  providedIn: 'root',
})
export class TaskService {
  private readonly _store = inject<Store<RootState>>(Store);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _imexMetaService = inject(ImexViewService);
  private readonly _timeTrackingService = inject(GlobalTrackingIntervalService);
  private readonly _dateService = inject(DateService);
  private readonly _router = inject(Router);
  private readonly _archiveService = inject(ArchiveService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _taskFocusService = inject(TaskFocusService);

  currentTaskId$: Observable<string | null> = this._store.pipe(
    select(selectCurrentTaskId),
    // NOTE: we can't use share here, as we need the last emitted value
  );
  currentTaskId = toSignal(this.currentTaskId$, { initialValue: null });

  currentTask$: Observable<Task | null> = this._store.pipe(
    select(selectCurrentTask),
    // NOTE: we can't use share here, as we need the last emitted value
  );

  currentTaskParentOrCurrent$: Observable<Task | undefined> = this._store.pipe(
    select(selectCurrentTaskParentOrCurrent),
    // NOTE: we can't use share here, as we need the last emitted value
  );

  selectedTaskId = toSignal(
    this._store.pipe(
      select(selectSelectedTaskId),
      // NOTE: we can't use share here, as we need the last emitted value
    ),
    { initialValue: null },
  );

  // Shared signal to avoid creating 200+ subscriptions in task components
  // Uses selectTodayTaskIds which computes membership from task.dueDay (virtual tag pattern)
  todayList = toSignal(this._store.pipe(select(selectTodayTaskIds)), {
    initialValue: [] as string[],
  });

  // Set version for O(1) lookup - used by task components to check membership
  todayListSet = computed(() => new Set(this.todayList()));

  selectedTask$: Observable<TaskWithSubTasks | null> = this._store.pipe(
    select(selectSelectedTask),
    // NOTE: we can't use share here, as we need the last emitted value
  );

  firstStartableTask = computed(
    () => this._workContextService.startableTasksForActiveContext()[0],
  );

  taskDetailPanelTargetPanel$: Observable<TaskDetailTargetPanel | null | undefined> =
    this._store.pipe(
      select(selectTaskDetailTargetPanel),
      // NOTE: we can't use share here, as we need the last emitted value
    );

  isTaskDataLoaded$: Observable<boolean> = this._store.pipe(
    select(selectIsTaskDataLoaded),
  );

  taskFeatureState$: Observable<TaskState> = this._store.pipe(
    select(selectTaskFeatureState),
  );

  allTasks$: Observable<Task[]> = this._store.pipe(select(selectAllTasks));

  allStartableTasks$: Observable<Task[]> = this._store.pipe(select(selectStartableTasks));

  isTimeTrackingEnabled = computed(
    () => this._globalConfigService.cfg()?.appFeatures.isTimeTrackingEnabled,
  );

  // META FIELDS
  // -----------
  currentTaskProgress$: Observable<number> = this.currentTask$.pipe(
    map((task) =>
      task && task.timeEstimate > 0 ? task.timeSpent / task.timeEstimate : 0,
    ),
  );

  private _lastFocusedTaskEl: HTMLElement | null = null;
  private _allTasks$: Observable<Task[]> = this._store.pipe(select(selectAllTasks));

  // Batch sync for time tracking: accumulates duration per task, syncs every 5 minutes
  private static readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private _timeAccumulator = new BatchedTimeSyncAccumulator(
    TaskService.SYNC_INTERVAL_MS,
    (taskId, date, duration) =>
      this._store.dispatch(syncTimeSpent({ taskId, date, duration })),
  );
  private _unsyncedContexts: Map<
    string,
    { contextType: 'TAG' | 'PROJECT'; contextId: string; date: string }
  > = new Map();

  constructor() {
    document.addEventListener(
      'focus',
      (ev) => {
        if (
          ev.target &&
          ev.target instanceof HTMLElement &&
          ev.target.tagName.toLowerCase() === 'task'
        ) {
          this._lastFocusedTaskEl = ev.target;
        }
      },
      true,
    );

    // time tracking with batch sync
    this._timeTrackingService.tick$
      .pipe(
        withLatestFrom(this.currentTask$, this._imexMetaService.isDataImportInProgress$),
      )
      .subscribe(([tick, currentTask, isImportInProgress]) => {
        if (currentTask?.id && !isImportInProgress) {
          // Update local state immediately (existing behavior)
          this.addTimeSpent(currentTask, tick.duration, tick.date);

          // Accumulate for batch sync
          this._timeAccumulator.accumulate(currentTask.id, tick.duration, tick.date);

          // Track contexts for TIME_TRACKING sync
          this._trackContextsForSync(currentTask, tick.date);

          // Check if it's time to sync (every 5 minutes)
          if (this._timeAccumulator.shouldFlush()) {
            this._flushAccumulatedTimeSpent();
          }
        }
      });

    // Flush accumulated time when task stops (currentTaskId becomes null or changes)
    this.currentTaskId$.pipe(distinctUntilChanged()).subscribe((newTaskId) => {
      // When task changes or stops, flush any accumulated time
      this._flushAccumulatedTimeSpent();
    });

    effect(() => {
      if (!this.isTimeTrackingEnabled() && untracked(this.currentTaskId) != null) {
        this.toggleStartTask();
      }
    });
  }

  /**
   * Tracks contexts (tags and project) that need TIME_TRACKING sync.
   */
  private _trackContextsForSync(task: Task, date: string): void {
    // Track project context
    if (task.projectId) {
      const key = `PROJECT:${task.projectId}:${date}`;
      this._unsyncedContexts.set(key, {
        contextType: 'PROJECT',
        contextId: task.projectId,
        date,
      });
    }

    // Track tag contexts (including TODAY_TAG)
    for (const tagId of [TODAY_TAG.id, ...task.tagIds]) {
      const key = `TAG:${tagId}:${date}`;
      this._unsyncedContexts.set(key, {
        contextType: 'TAG',
        contextId: tagId,
        date,
      });
    }
  }

  /**
   * Dispatches syncTimeSpent for all accumulated time and resets accumulators.
   */
  private _flushAccumulatedTimeSpent(): void {
    // Sync task.timeSpent totals
    this._timeAccumulator.flush();

    // Sync TIME_TRACKING session data (start/end times)
    if (this._unsyncedContexts.size > 0) {
      this._store
        .pipe(select(selectTimeTrackingState), take(1))
        .subscribe((timeTrackingState) => {
          this._unsyncedContexts.forEach(({ contextType, contextId, date }) => {
            const prop = contextType === 'TAG' ? 'tag' : 'project';
            const data = timeTrackingState?.[prop]?.[contextId]?.[date];
            if (data) {
              this._store.dispatch(
                syncTimeTracking({ contextType, contextId, date, data }),
              );
            }
          });
          this._unsyncedContexts.clear();
        });
    }
  }

  getAllParentWithoutTag$(tagId: string): Observable<Task[]> {
    return this._store.pipe(select(selectMainTasksWithoutTag, { tagId }));
  }

  // META

  // ----
  setCurrentId(id: string | null): void {
    if (id) {
      this._store.dispatch(setCurrentTask({ id }));
    } else {
      this._store.dispatch(unsetCurrentTask());
    }
  }

  setSelectedId(
    id: string | null,
    taskDetailTargetPanel: TaskDetailTargetPanel = TaskDetailTargetPanel.Default,
  ): void {
    this._store.dispatch(setSelectedTask({ id, taskDetailTargetPanel }));
  }

  async setSelectedIdToParentAndSwitchContextIfNecessary(task: TaskCopy): Promise<void> {
    if (!task.parentId) {
      throw new Error('No task with parent task given');
    }
    const parentTask = await this.getByIdOnce$(task.parentId).toPromise();
    const activeContext = await this._workContextService.activeWorkContext$
      .pipe(first())
      .toPromise();

    if (!activeContext) {
      throw new Error('No active work context');
    }

    // Check if parent task is actually visible in the current context
    const isParentVisibleInCurrentContext = activeContext.taskIds.includes(task.parentId);

    if (!isParentVisibleInCurrentContext) {
      // Navigate to the context where the parent task belongs
      if (parentTask.projectId) {
        await this._router.navigate([`project/${parentTask.projectId}/tasks`]);
      } else if (parentTask.tagIds[0]) {
        await this._router.navigate([`tag/${parentTask.tagIds[0]}/tasks`]);
      } else {
        throw new Error('No valid context found for parent task');
      }
    }

    this._store.dispatch(
      setSelectedTask({
        id: task.parentId,
        taskDetailTargetPanel: TaskDetailTargetPanel.Default,
      }),
    );
  }

  startFirstStartable(): void {
    this._workContextService.startableTasksForActiveContext$
      .pipe(take(1))
      .subscribe((tasks) => {
        if (tasks[0] && !this.currentTaskId()) {
          this.setCurrentId(tasks[0].id);
        }
      });
  }

  pauseCurrent(): void {
    this._store.dispatch(unsetCurrentTask());
  }

  // Tasks
  // -----
  add(
    title: string | null,
    isAddToBacklog: boolean = false,
    additional: Partial<Task> = {},
    isAddToBottom: boolean = false,
  ): string {
    const workContextId = this._workContextService.activeWorkContextId as string;
    const workContextType = this._workContextService
      .activeWorkContextType as WorkContextType;
    const task = this.createNewTaskWithDefaults({
      title,
      additional,
      workContextType,
      workContextId,
    });

    TaskLog.log(task, additional);

    this._store.dispatch(
      TaskSharedActions.addTask({
        task,
        workContextId,
        workContextType,
        isAddToBacklog,
        isAddToBottom,
      }),
    );
    return task && task.id;
  }

  async addAndSchedule(
    title: string | null,
    additional: Partial<Task> = {},
    due: number,
    remindCfg?: TaskReminderOptionId,
  ): Promise<string> {
    const id = this.add(title, undefined, additional, undefined);
    const task = await this.getByIdOnce$(id).toPromise();
    this.scheduleTask(
      task,
      due,
      remindCfg ??
        this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
        DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
    );
    return id;
  }

  addToToday(task: TaskWithSubTasks): void {
    this._store.dispatch(TaskSharedActions.planTasksForToday({ taskIds: [task.id] }));
  }

  remove(task: TaskWithSubTasks): void {
    this._store.dispatch(TaskSharedActions.deleteTask({ task }));
  }

  removeMultipleTasks(taskIds: string[]): void {
    this._store.dispatch(TaskSharedActions.deleteTasks({ taskIds }));
  }

  update(id: string, changedFields: Partial<Task>): void {
    this._store.dispatch(
      TaskSharedActions.updateTask({
        task: { id, changes: changedFields },
      }),
    );
  }

  updateTags(task: Task, newTagIds: string[]): void {
    this._store.dispatch(
      TaskSharedActions.updateTask({
        task: {
          id: task.id,
          changes: {
            tagIds: unique(newTagIds),
          },
        },
      }),
    );
  }

  removeTagsForAllTask(tagsToRemove: string[]): void {
    this._store.dispatch(
      TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: tagsToRemove,
      }),
    );
  }

  updateUi(id: string, changes: Partial<Task>): void {
    this._store.dispatch(
      updateTaskUi({
        task: { id, changes },
      }),
    );
  }

  move(
    taskId: string,
    src: DropListModelSource,
    target: DropListModelSource,
    newOrderedIds: string[],
  ): void {
    const isSrcTodayList = src === 'DONE' || src === 'UNDONE';
    const isTargetTodayList = target === 'DONE' || target === 'UNDONE';
    const workContextId = this._workContextService.activeWorkContextId as string;

    if (isSrcTodayList && isTargetTodayList) {
      // move inside today
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        moveTaskInTodayList({
          taskId,
          afterTaskId,
          src,
          target,
          workContextId,
          workContextType,
        }),
      );
    } else if (src === 'BACKLOG' && target === 'BACKLOG') {
      // move inside backlog
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        moveProjectTaskInBacklogList({ taskId, afterTaskId, workContextId }),
      );
    } else if (src === 'BACKLOG' && isTargetTodayList) {
      // move from backlog to today
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        moveProjectTaskToRegularList({
          taskId,
          afterTaskId,
          src,
          target,
          workContextId,
        }),
      );
    } else if (isSrcTodayList && target === 'BACKLOG') {
      // move from today to backlog
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        moveProjectTaskToBacklogList({ taskId, afterTaskId, workContextId }),
      );
    } else {
      // move sub task
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        moveSubTask({ taskId, srcTaskId: src, targetTaskId: target, afterTaskId }),
      );
    }
  }

  async moveUp(
    id: string,
    parentId: string | null = null,
    isBacklog: boolean,
  ): Promise<void> {
    const allMainTaskIds = [
      ...(await this._workContextService.mainListTaskIds$.pipe(first()).toPromise()),
      ...(await this._workContextService.backlogTaskIds$.pipe(first()).toPromise()),
    ];
    const isSubTaskAsMain = parentId && allMainTaskIds.includes(id);

    if (parentId && !isSubTaskAsMain) {
      const parentTask = await this.getByIdOnce$(parentId).toPromise();
      if (parentTask.subTaskIds[0] === id) {
        return await this.moveUp(parentId, undefined, false);
      } else {
        this._store.dispatch(moveSubTaskUp({ id, parentId }));
      }
    } else {
      const workContextId = this._workContextService.activeWorkContextId as string;
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;

      if (isBacklog) {
        const doneBacklogTaskIds = await this._workContextService.doneBacklogTaskIds$
          .pipe(take(1))
          .toPromise();
        if (!doneBacklogTaskIds) {
          throw new Error('No doneBacklogTaskIds found');
        }
        this._store.dispatch(
          moveProjectTaskUpInBacklogList({
            taskId: id,
            workContextId,
            doneBacklogTaskIds,
          }),
        );
      } else {
        const doneTaskIds = await this._workContextService.doneTaskIds$
          .pipe(take(1))
          .toPromise();
        this._store.dispatch(
          moveTaskUpInTodayList({
            taskId: id,
            workContextType,
            workContextId,
            doneTaskIds,
          }),
        );
      }
    }
  }

  async moveDown(
    id: string,
    parentId: string | null = null,
    isBacklog: boolean,
  ): Promise<void> {
    const allMainTaskIds = [
      ...(await this._workContextService.mainListTaskIds$.pipe(first()).toPromise()),
      ...(await this._workContextService.backlogTaskIds$.pipe(first()).toPromise()),
    ];
    const isSubTaskAsMain = parentId && allMainTaskIds.includes(id);

    if (parentId && !isSubTaskAsMain) {
      const parentTask = await this.getByIdOnce$(parentId).toPromise();
      if (parentTask.subTaskIds[parentTask.subTaskIds.length - 1] === id) {
        return await this.moveDown(parentId, undefined, false);
      } else {
        this._store.dispatch(moveSubTaskDown({ id, parentId }));
      }
    } else {
      const workContextId = this._workContextService.activeWorkContextId as string;
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;

      // this.
      if (isBacklog) {
        const doneBacklogTaskIds = await this._workContextService.doneBacklogTaskIds$
          .pipe(take(1))
          .toPromise();
        if (!doneBacklogTaskIds) {
          throw new Error('No doneBacklogTaskIds found');
        }
        this._store.dispatch(
          moveProjectTaskDownInBacklogList({
            taskId: id,
            workContextId,
            doneBacklogTaskIds,
          }),
        );
      } else {
        const doneTaskIds = await this._workContextService.doneTaskIds$
          .pipe(take(1))
          .toPromise();
        this._store.dispatch(
          moveTaskDownInTodayList({
            taskId: id,
            workContextType,
            workContextId,
            doneTaskIds,
          }),
        );
      }
    }
  }

  moveToTop(id: string, parentId: string | null = null, isBacklog: boolean): void {
    if (parentId) {
      this._store.dispatch(moveSubTaskToTop({ id, parentId }));
    } else {
      const workContextId = this._workContextService.activeWorkContextId as string;
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;

      if (isBacklog) {
        this._workContextService.doneBacklogTaskIds$
          .pipe(take(1))
          .subscribe((doneBacklogTaskIds) => {
            if (!doneBacklogTaskIds) {
              throw new Error('No doneBacklogTaskIds found');
            }
            this._store.dispatch(
              moveProjectTaskToTopInBacklogList({
                taskId: id,
                workContextId,
                doneBacklogTaskIds,
              }),
            );
          });
      } else {
        this._workContextService.doneTaskIds$.pipe(take(1)).subscribe((doneTaskIds) => {
          this._store.dispatch(
            moveTaskToTopInTodayList({
              taskId: id,
              workContextType,
              workContextId,
              doneTaskIds,
            }),
          );
        });
      }
    }
  }

  moveToBottom(id: string, parentId: string | null = null, isBacklog: boolean): void {
    if (parentId) {
      this._store.dispatch(moveSubTaskToBottom({ id, parentId }));
    } else {
      const workContextId = this._workContextService.activeWorkContextId as string;
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;

      if (isBacklog) {
        this._workContextService.doneBacklogTaskIds$
          .pipe(take(1))
          .subscribe((doneBacklogTaskIds) => {
            if (!doneBacklogTaskIds) {
              throw new Error('No doneBacklogTaskIds found');
            }
            this._store.dispatch(
              moveProjectTaskToBottomInBacklogList({
                taskId: id,
                workContextId,
                doneBacklogTaskIds,
              }),
            );
          });
      } else {
        this._workContextService.doneTaskIds$.pipe(take(1)).subscribe((doneTaskIds) => {
          this._store.dispatch(
            moveTaskToBottomInTodayList({
              taskId: id,
              workContextType,
              workContextId,
              doneTaskIds,
            }),
          );
        });
      }
    }
  }

  addSubTaskTo(parentId: string, additional: Partial<Task> = {}): string {
    const task = this.createNewTaskWithDefaults({
      title: additional.title || '',
      additional: { dueDay: additional.dueDay || undefined, ...additional },
    });
    console.log(task);

    this._store.dispatch(
      addSubTask({
        task,
        parentId,
      }),
    );

    this._focusNewlyCreatedTask(task.id, !task.title?.trim().length);

    return task.id;
  }

  private _focusNewlyCreatedTask(taskId: string, shouldStartEditing: boolean): void {
    // Use double-RAF to ensure Angular has completed rendering after change detection.
    // First RAF queues after the current frame, second RAF runs after the render.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const taskElement = document.getElementById(`t-${taskId}`);
        if (!taskElement) return;

        taskElement.focus();

        if (shouldStartEditing) {
          const taskComponent = this._taskFocusService.lastFocusedTaskComponent();
          if (
            taskComponent &&
            taskComponent.task().id === taskId &&
            !taskComponent.task().title?.trim().length
          ) {
            taskComponent.focusTitleForEdit();
          }
        }
      });
    });
  }

  addTimeSpent(
    task: Task,
    duration: number,
    date: string = this._dateService.todayStr(),
    isFromTrackingReminder = false,
  ): void {
    this._store.dispatch(
      TimeTrackingActions.addTimeSpent({ task, date, duration, isFromTrackingReminder }),
    );
  }

  removeTimeSpent(
    id: string,
    duration: number,
    date: string = this._dateService.todayStr(),
  ): void {
    this._store.dispatch(removeTimeSpent({ id, date, duration }));
  }

  focusTask(id: string): void {
    const el = document.getElementById('t-' + id);
    if (!el) {
      throw new Error('Cannot find focus el');
    }
    el.focus();
  }

  focusLastFocusedTask(): void {
    if (this._lastFocusedTaskEl) {
      this._lastFocusedTaskEl.focus();
    }
  }

  focusTaskIfPossible(id: string): void {
    const tEl = document.getElementById('t-' + id);

    if (tEl) {
      tEl.focus();
    }
  }

  focusFirstTaskIfVisible(): void {
    const tEl = document.getElementsByTagName('task');
    if (tEl && tEl[0]) {
      (tEl[0] as HTMLElement).focus();
    }
  }

  async moveToArchive(tasks: TaskWithSubTasks | TaskWithSubTasks[]): Promise<void> {
    // Add comprehensive validation and logging
    if (!tasks) {
      console.error('[TaskService] moveToArchive called with null/undefined tasks');
      return;
    }

    if (!Array.isArray(tasks)) {
      console.warn('[TaskService] moveToArchive converting single task to array', tasks);
      tasks = [tasks];
    }

    // Double-check it's an array after conversion
    if (!Array.isArray(tasks)) {
      console.error('[TaskService] Failed to convert tasks to array:', tasks);
      throw new Error('moveToArchive: tasks could not be converted to array');
    }

    TaskLog.log('[TaskService] moveToArchive called with:', {
      count: tasks.length,
      taskIds: tasks.map((t) => t?.id || 'undefined'),
      tasksType: typeof tasks,
      isArray: Array.isArray(tasks),
    });

    // NOTE: we only update real parents since otherwise we move sub-tasks without their parent into the archive
    const subTasks = tasks.filter((t) => t?.parentId);
    const parentTasks = tasks.filter((t) => t && !t.parentId);

    TaskLog.log('[TaskService] Filtered tasks:', {
      parentTasks: parentTasks.map((t) => t.id),
      subTasks: subTasks.map((t) => t.id),
    });

    if (subTasks.length) {
      if (this._workContextService.activeWorkContextType !== WorkContextType.TAG) {
        // this should be handled by moving parentTasks to archive
        devError('Trying to move sub tasks into archive for project');
      } else {
        // when on a tag such as today, we simply remove the tag instead of attempting to move to archive
        const tagToRemove = this._workContextService.activeWorkContextId;
        TaskLog.log('[TaskService] Removing tag from subtasks:', tagToRemove);
        subTasks.forEach((st) => {
          this.updateTags(
            st,
            st.tagIds.filter((tid) => tid !== tagToRemove),
          );
        });
      }
    }

    if (parentTasks.length) {
      TaskLog.log('[TaskService] Dispatching moveToArchive action for parent tasks');
      // Only move parent tasks to archive, never subtasks
      // Note: Full task payload required for sync - see docs/archive-operation-redesign.md
      this._store.dispatch(TaskSharedActions.moveToArchive({ tasks: parentTasks }));
      // Only archive parent tasks to prevent orphaned subtasks
      TaskLog.log('[TaskService] Calling archive service to persist tasks');
      await this._archiveService.moveTasksToArchiveAndFlushArchiveIfDue(parentTasks);
      TaskLog.log('[TaskService] Archive operation completed successfully');
    } else {
      TaskLog.log('[TaskService] No parent tasks to archive');
    }
  }

  moveToProject(task: TaskWithSubTasks, projectId: string): void {
    if (!!task.parentId) {
      throw new Error('Wrong task model');
    }
    this._store.dispatch(
      TaskSharedActions.moveToOtherProject({ task, targetProjectId: projectId }),
    );
  }

  moveToCurrentWorkContext(task: TaskWithSubTasks | Task): void {
    if (this._workContextService.activeWorkContextType === WorkContextType.TAG) {
      if (this._workContextService.activeWorkContextId === TODAY_TAG.id) {
        this._store.dispatch(TaskSharedActions.planTasksForToday({ taskIds: [task.id] }));
      } else {
        this.updateTags(task, [this._workContextService.activeWorkContextId as string]);
      }
    } else {
      if (!('subTasks' in task)) {
        throw new Error('Wrong task model');
      }
      this.moveToProject(task, this._workContextService.activeWorkContextId as string);
    }
  }

  toggleStartTask(): void {
    if (this.isTimeTrackingEnabled() || this.currentTaskId() != null) {
      this._store.dispatch(toggleStart());
    }
  }

  restoreTask(task: Task, subTasks: Task[]): void {
    this._store.dispatch(TaskSharedActions.restoreTask({ task, subTasks }));
  }

  async roundTimeSpentForDayEverywhere({
    day,
    taskIds,
    roundTo,
    isRoundUp = false,
    projectId,
  }: {
    day: string;
    taskIds: string[];
    roundTo: RoundTimeOption;
    isRoundUp: boolean;
    projectId?: string | null;
  }): Promise<void> {
    // NOTE: doing it this way round is quicker since it only has to be calculated when the action is triggered
    const taskState = await this.taskFeatureState$.pipe(first()).toPromise();
    const archivedIds: string[] = [];
    const todayIds: string[] = [];
    taskIds.forEach((id) => {
      if (taskState.ids.includes(id)) {
        todayIds.push(id);
      } else {
        // NOTE we don't check if they actually exist there
        archivedIds.push(id);
      }
    });

    // today
    this._store.dispatch(
      roundTimeSpentForDay({ day, taskIds: todayIds, roundTo, isRoundUp, projectId }),
    );

    // archive
    await this._taskArchiveService.roundTimeSpent({
      day,
      taskIds: archivedIds,
      roundTo,
      isRoundUp,
      projectId,
    });
  }

  // REMINDER
  // --------
  scheduleTask(
    task: Task | TaskWithSubTasks,
    due: number,
    remindCfg: TaskReminderOptionId,
    isMoveToBacklog: boolean = false,
  ): void {
    this._store.dispatch(
      TaskSharedActions.scheduleTaskWithTime({
        task,
        dueWithTime: due,
        remindAt: remindOptionToMilliseconds(due, remindCfg),
        isMoveToBacklog,
      }),
    );
  }

  reScheduleTask({
    task,
    due,
    remindCfg,
    isMoveToBacklog = false,
  }: {
    task: Task;
    due: number;
    remindCfg: TaskReminderOptionId;
    isMoveToBacklog: boolean;
  }): void {
    this._store.dispatch(
      TaskSharedActions.reScheduleTaskWithTime({
        task,
        dueWithTime: due,
        remindAt: remindOptionToMilliseconds(due, remindCfg),
        isMoveToBacklog,
      }),
    );
  }

  // ------
  getByIdOnce$(id: string): Observable<Task> {
    return this._store.pipe(select(selectTaskById, { id }), take(1));
  }

  getByIdLive$(id: string): Observable<Task> {
    return this._store.pipe(select(selectTaskById, { id }));
  }

  getByIdsLive$(ids: string[]): Observable<Task[]> {
    return this._store.pipe(select(selectTasksById, { ids }));
  }

  getByIdWithSubTaskData$(id: string): Observable<TaskWithSubTasks> {
    return this._store.pipe(select(selectTaskByIdWithSubTaskData, { id }), take(1));
  }

  getTasksByRepeatCfgId$(repeatCfgId: string): Observable<Task[]> {
    return this._store.pipe(
      select(selectTasksByRepeatConfigId, { repeatCfgId }),
      take(1),
    );
  }

  getTasksWithSubTasksByRepeatCfgId$(
    repeatCfgId: string,
  ): Observable<TaskWithSubTasks[]> {
    if (!repeatCfgId) {
      throw new Error('No repeatCfgId');
    }
    return this._store.pipe(
      select(selectTaskWithSubTasksByRepeatConfigId, { repeatCfgId }),
    );
  }

  getTasksByTag(tagId: string): Observable<TaskWithSubTasks[]> {
    return this._store.pipe(select(selectTasksByTag, { tagId }));
  }

  setDone(id: string): void {
    this.update(id, { isDone: true });
  }

  markIssueUpdatesAsRead(id: string): void {
    this.update(id, { issueWasUpdated: false });
  }

  setUnDone(id: string): void {
    this.update(id, { isDone: false });
  }

  showSubTasks(id: string): void {
    this.updateUi(id, { _hideSubTasksMode: undefined });
  }

  toggleSubTaskMode(
    taskId: string,
    isShowLess: boolean = true,
    isEndless: boolean = false,
  ): void {
    this._store.dispatch(toggleTaskHideSubTasks({ taskId, isShowLess, isEndless }));
  }

  hideSubTasks(id: string): void {
    this.updateUi(id, { _hideSubTasksMode: HideSubTasksMode.HideAll });
  }

  async convertToMainTask(task: Task): Promise<void> {
    const parent = await this.getByIdOnce$(task.parentId as string).toPromise();
    this._store.dispatch(
      TaskSharedActions.convertToMainTask({
        task,
        parentTagIds: parent.tagIds,
        isPlanForToday: this._workContextService.activeWorkContextId === TODAY_TAG.id,
      }),
    );
  }

  // GLOBAL TASK MODEL STUFF
  // -----------------------

  // BEWARE: does only work for task model updates, but not for related models
  async updateEverywhere(id: string, changedFields: Partial<Task>): Promise<void> {
    const state = await this.taskFeatureState$.pipe(first()).toPromise();
    const { entities } = state;
    if (entities[id]) {
      this.update(id, changedFields);
    } else {
      await this.updateArchiveTask(id, changedFields);
    }
  }

  // TODO remove in favor of calling this directly
  // BEWARE: does only work for task model updates, but not the meta models
  async updateArchiveTask(id: string, changedFields: Partial<Task>): Promise<void> {
    return this._taskArchiveService.updateTask(id, changedFields);
  }

  // BEWARE: does only work for task model updates, but not the meta models
  async updateArchiveTasks(updates: Update<Task>[]): Promise<void> {
    return this._taskArchiveService.updateTasks(updates);
  }

  async getByIdFromEverywhere(id: string, isArchive?: boolean): Promise<Task> {
    if (isArchive === undefined) {
      const task = await this.getByIdOnce$(id).toPromise();
      if (task) {
        return task;
      }
      return await this._taskArchiveService.getById(id);
    }

    if (isArchive) {
      return await this._taskArchiveService.getById(id);
    } else {
      return await this.getByIdOnce$(id).toPromise();
    }
  }

  async getAllTasksForProject(projectId: string): Promise<Task[]> {
    const allTasks = await this._allTasks$.pipe(first()).toPromise();
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    const archiveTasks = ids.map((id) => archiveTaskState.entities[id]);
    return [...allTasks, ...archiveTasks].filter(
      (task) => (task as Task).projectId === projectId,
    ) as Task[];
  }

  async getArchiveTasksForRepeatCfgId(repeatCfgId: string): Promise<Task[]> {
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    const archiveTasks = ids.map((id) => archiveTaskState.entities[id]);
    return archiveTasks.filter(
      (task) => (task as Task).repeatCfgId === repeatCfgId,
    ) as Task[];
  }

  async getArchivedTasks(): Promise<Task[]> {
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    const archiveTasks = ids.map((id) => archiveTaskState.entities[id]) as Task[];
    return archiveTasks;
  }

  async getAllIssueIdsForProject(
    projectId: string,
    issueProviderKey: IssueProviderKey,
  ): Promise<string[]> {
    const allTasks = await this.getAllTasksForProject(projectId);
    return allTasks
      .filter((task) => task.issueType === issueProviderKey)
      .map((task) => task.issueId) as string[];
  }

  async getAllIssueIdsForProviderEverywhere(issueProviderId: string): Promise<string[]> {
    const allTasks = await this.getAllTasksEverywhere();
    return allTasks
      .filter((task) => task.issueProviderId === issueProviderId)
      .map((task) => task.issueId) as string[];
  }

  async getAllTasksEverywhere(): Promise<Task[]> {
    const allTasks = await this._allTasks$.pipe(first()).toPromise();
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    const archiveTasks = ids.map((id) => archiveTaskState.entities[id]);
    return [...allTasks, ...archiveTasks] as Task[];
  }

  async checkForTaskWithIssueEverywhere(
    issueId: string | number,
    issueProviderKey: IssueProviderKey,
    issueProviderId: string,
  ): Promise<{
    task: Task;
    subTasks: Task[] | null;
    isFromArchive: boolean;
  } | null> {
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const findTaskFn = (task: Task | ArchiveTask | undefined): boolean =>
      !!task &&
      // NOTE: we check all, since it is theoretically possible for the same issueId to appear across issue providers
      task.issueId === issueId &&
      task.issueType === issueProviderKey &&
      task.issueProviderId === issueProviderId;

    const allTasks = (await this._allTasks$.pipe(first()).toPromise()) as Task[];
    const taskWithSameIssue: Task = allTasks.find(findTaskFn) as Task;

    if (taskWithSameIssue) {
      return {
        task: taskWithSameIssue,
        isFromArchive: false,
        subTasks: null,
      };
    } else {
      const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
      const ids = archiveTaskState && (archiveTaskState.ids as string[]);
      if (ids) {
        const archiveTaskWithSameIssue = ids
          .map((id) => archiveTaskState.entities[id])
          .find(findTaskFn);

        return archiveTaskWithSameIssue
          ? {
              task: archiveTaskWithSameIssue as Task,
              subTasks: archiveTaskWithSameIssue.subTaskIds
                ? (archiveTaskWithSameIssue.subTaskIds.map(
                    (id) => archiveTaskState.entities[id],
                  ) as Task[])
                : null,
              isFromArchive: true,
            }
          : null;
      }
      return null;
    }
  }

  createNewTaskWithDefaults({
    title,
    id,
    additional = {},
    workContextType = this._workContextService.activeWorkContextType as WorkContextType,
    workContextId = this._workContextService.activeWorkContextId as string,
  }: {
    title: string | null;
    id?: string;
    additional?: Partial<Task>;
    workContextType?: WorkContextType;
    workContextId?: string;
  }): Task {
    const d1 = {
      // NOTE needs to be created every time
      ...DEFAULT_TASK,
      created: Date.now(),
      title: title as string,
      id: id || nanoid(),

      ...(workContextType === WorkContextType.PROJECT
        ? { projectId: workContextId }
        : {
            projectId:
              this._globalConfigService.cfg()?.tasks.defaultProjectId || INBOX_PROJECT.id,
          }),

      tagIds:
        workContextType === WorkContextType.TAG &&
        !additional.parentId &&
        workContextId !== TODAY_TAG.id
          ? [workContextId]
          : [],

      ...(workContextId === TODAY_TAG.id &&
      !additional.parentId &&
      !additional.dueWithTime &&
      !('dueDay' in additional)
        ? { dueDay: getDbDateStr() }
        : {}),

      ...additional,
    };

    if (!d1.projectId) {
      d1.projectId =
        workContextType === WorkContextType.PROJECT
          ? workContextId
          : this._globalConfigService.cfg()?.tasks.defaultProjectId || INBOX_PROJECT.id;
    }

    // Validate that we have a valid task before returning
    typia.assert<Task>(d1);

    if (d1.projectId === undefined) {
      return { ...d1, projectId: INBOX_PROJECT.id };
    }
    return d1;
  }
}
