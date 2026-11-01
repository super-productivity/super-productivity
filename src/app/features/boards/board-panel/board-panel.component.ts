import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { PlannerTaskComponent } from '../../planner/planner-task/planner-task.component';
import {
  BoardPanelCfg,
  BoardPanelCfgDeadlineState,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import {
  BoardPanelTimeframeRanges,
  buildComparator,
  doesTaskMatchPanel,
  doesTaskMatchPanelTimeframes,
  firstSpecificProjectId,
  isAllProjects,
  resolvePanelTimeframeRanges,
  rewriteTagIdsForPanel,
} from '../boards.util';
import { select, Store } from '@ngrx/store';
import {
  selectAllTasksInActiveProjects,
  selectTaskById,
  selectTaskByIdWithSubTaskData,
} from '../../tasks/store/task.selectors';
import { toSignal } from '@angular/core/rxjs-interop';
import { AddTaskInlineComponent } from '../../planner/add-task-inline/add-task-inline.component';
import { T } from '../../../t.const';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { BoardsActions } from '../store/boards.actions';
import { unique } from '../../../util/unique';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { LocalDateStrPipe } from '../../../ui/pipes/local-date-str.pipe';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { MatDialog } from '@angular/material/dialog';
import { fastArrayCompare } from '../../../util/fast-array-compare';
import { first, take } from 'rxjs/operators';
import { dragDelayForTouch } from '../../../util/input-intent';
import { ShortPlannedAtPipe } from '../../../ui/pipes/short-planned-at.pipe';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import {
  moveProjectTaskToBacklogListAuto,
  moveProjectTaskToRegularListAuto,
} from '../../project/store/project.actions';
import { TaskAddEvent } from '../../tasks/add-task-bar/add-task-bar.component';
import { firstValueFrom } from 'rxjs';
import {
  TASK_CARD_LIST,
  TaskCardArrow,
  TaskCardList,
  TaskCardMove,
} from '../../tasks/task-card-list.token';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import { TaskBulkActionService } from '../../tasks/task-bulk-action.service';
import { reorderBoardTasks } from '../reorder-board-tasks';
import { GlobalConfigService } from '../../config/global-config.service';
import { checkKeyCombo } from '../../../util/check-key-combo';
import { ADD_TASK_INLINE_BTN_SELECTOR } from '../../planner/add-task-inline/add-task-inline.const';
import {
  getScheduledDateColor,
  readClockUntilDue,
} from '../../tasks/util/get-scheduled-date-color';
import type { ScheduledDateColor } from '../../tasks/util/get-scheduled-date-color';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../../core/date/date.service';
import { selectStartOfNextDayDiffMs } from '../../../root-store/app-state/app-state.selectors';
import { adjustDateToBoardRange, getBoardTaskDateStr } from '../board-date-filter.util';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DialogDeadlineComponent } from '../../tasks/dialog-deadline/dialog-deadline.component';
import { SnackService } from '../../../core/snack/snack.service';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { truncate } from '../../../util/truncate';
import { getDeadlineAutoPlanFields } from '../../tasks/util/get-deadline-auto-plan-fields';
import { DEFAULT_FIRST_DAY_OF_WEEK } from '../../../core/locale.constants';

export interface BoardPanelNavigation {
  direction: -1 | 1 | 'up' | 'down';
  rowIndex: number;
  taskIds?: string[];
  focusTaskId?: string;
}

@Component({
  selector: 'board-panel',
  standalone: true,
  imports: [
    CdkDrag,
    PlannerTaskComponent,
    CdkDropList,
    AddTaskInlineComponent,
    LocalDateStrPipe,
    MatIcon,
    MatIconButton,
    TranslatePipe,
    ShortPlannedAtPipe,
    MsToStringPipe,
  ],
  templateUrl: './board-panel.component.html',
  styleUrl: './board-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: TASK_CARD_LIST, useExisting: forwardRef(() => BoardPanelComponent) },
    LocaleDatePipe,
  ],
  host: {
    // Angular host bindings use template attribute syntax.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[attr.data-board-selection-scope]': 'panelCfg().id',
  },
})
export class BoardPanelComponent implements TaskCardList {
  T = T;
  dragDelayForTouch = dragDelayForTouch;

  panelCfg = input.required<BoardPanelCfg>();
  editBoard = output<void>();
  adjacentPanel = output<BoardPanelNavigation>();

  store = inject(Store);
  taskService = inject(TaskService);
  _matDialog = inject(MatDialog);
  readonly multiSelect = inject(TaskMultiSelectService);
  private readonly _trackingInterval = inject(GlobalTrackingIntervalService);
  private readonly _dateService = inject(DateService);
  private _element = inject<ElementRef<HTMLElement>>(ElementRef);
  private _injector = inject(Injector);
  private _destroyRef = inject(DestroyRef);
  private _config = inject(GlobalConfigService);
  private _snackService = inject(SnackService);
  private _localeDatePipe = inject(LocaleDatePipe);
  private _translateService = inject(TranslateService);
  private _cards = viewChildren(PlannerTaskComponent, { read: ElementRef });
  readonly isMoving = signal(false);

  rows(): HTMLElement[] {
    return this._cards().map((card) => card.nativeElement as HTMLElement);
  }

  addButton(): HTMLElement | null {
    return this._element.nativeElement.querySelector(ADD_TASK_INLINE_BTN_SELECTOR);
  }

  focusRow(index: number, taskId?: string): void {
    const rows = this.rows();
    const target =
      (taskId && rows.find((row) => row.dataset.taskId === taskId)) ||
      rows[Math.min(index, rows.length - 1)] ||
      this.addButton();
    target?.focus();
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  navigate(taskId: string, key: TaskCardArrow): void {
    const index = this.tasks().findIndex((task) => task.id === taskId);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      this.adjacentPanel.emit({
        direction: key === 'ArrowLeft' ? -1 : 1,
        rowIndex: index,
      });
    } else {
      const next = index + (key === 'ArrowUp' ? -1 : 1);
      if (next >= 0 && next < this.tasks().length) this.focusRow(next);
    }
  }

  @HostListener('keydown', ['$event'])
  onAddButtonKeydown(event: KeyboardEvent): void {
    if (
      event.target !== this.addButton() ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const keys = this._config.cfg()?.keyboard;
    if (
      keys &&
      Object.values(keys).some(
        (combo) => typeof combo === 'string' && combo && checkKeyCombo(event, combo),
      )
    )
      return;
    this.adjacentPanel.emit({
      direction: event.key === 'ArrowLeft' ? -1 : 1,
      rowIndex: 0,
    });
    event.preventDefault();
    event.stopPropagation();
  }

  moveToAdjacent(taskId: string, direction: -1 | 1): void {
    const taskIds = this._taskIdsToMove(taskId);
    if (!taskIds.length) return;
    this.adjacentPanel.emit({
      direction,
      rowIndex: 0,
      taskIds,
      focusTaskId: taskId,
    });
  }

  reorder(taskId: string, direction: TaskCardMove): void {
    const ids = this.tasks().map((task) => task.id);
    const selected = new Set(this._taskIdsToMove(taskId));
    if (!selected.size) return;
    if (
      (direction === 'up' && ids[0] === taskId) ||
      (direction === 'down' && ids[ids.length - 1] === taskId)
    ) {
      this.adjacentPanel.emit({
        direction,
        rowIndex: 0,
        taskIds: [...selected],
        focusTaskId: taskId,
      });
      return;
    }
    if (!this.isManualOrder()) return;
    const taskIds = reorderBoardTasks(ids, selected, direction);
    if (!fastArrayCompare(ids, taskIds)) {
      this.store.dispatch(
        BoardsActions.updatePanelCfgTaskIds({ panelId: this.panelCfg().id, taskIds }),
      );
      afterNextRender(() => this.focusRow(0, taskId), { injector: this._injector });
    }
  }

  private _taskIdsToMove(taskId: string, sourceTasks = this.tasks()): string[] {
    if (!this.multiSelect.has(taskId)) return [taskId];
    const selected = this.multiSelect.selectedIds();
    const ids = sourceTasks
      .filter((task) => selected.has(task.id))
      .map((task) => task.id);
    return ids.length === selected.size ? ids : [];
  }

  allTasks$ = this.store.select(selectAllTasksInActiveProjects);
  allTasks = toSignal(this.allTasks$, {
    initialValue: [],
  });

  private _startOfNextDayDiffMs = toSignal(
    this.store.select(selectStartOfNextDayDiffMs),
    {
      initialValue: 0,
    },
  );

  private _timeframeRanges = computed<BoardPanelTimeframeRanges>(() =>
    resolvePanelTimeframeRanges(
      this.panelCfg(),
      this._trackingInterval.todayDateStr(),
      this._config.localization()?.firstDayOfWeek ?? DEFAULT_FIRST_DAY_OF_WEEK,
    ),
  );

  // Use selectUnarchivedProjects (not selectUnarchivedVisibleProjects) to include
  // hidden projects and INBOX, ensuring backlog filtering works for all tasks
  allProjects$ = this.store.select(selectUnarchivedProjects);
  allProjects = toSignal(this.allProjects$, {
    initialValue: [],
  });

  // Create a Set of all backlog task IDs for fast lookup
  allBacklogTaskIds = computed(() => {
    const backlogIds = new Set<string>();
    for (const project of this.allProjects()) {
      if (project && project.backlogTaskIds && Array.isArray(project.backlogTaskIds)) {
        project.backlogTaskIds.forEach((id) => backlogIds.add(id));
      }
    }
    return backlogIds;
  });

  totalEstimate = computed(() =>
    this.tasks().reduce((acc, task) => acc + (task.timeEstimate || 0), 0),
  );

  isManualOrder = computed(() => !this.panelCfg().sortBy);

  // Tags to auto-apply on a new task created via the inline-add row.
  // - AND mode (default): all required tags.
  // - OR mode: just the first required tag (one is enough).
  tagsToAddForInlineCreate = computed<string[]>(() => {
    const cfg = this.panelCfg();
    if (!cfg.includedTagIds?.length) return [];
    return cfg.includedTagsMatch === 'any' ? [cfg.includedTagIds[0]] : cfg.includedTagIds;
  });

  // Tags to strip from user input on a new task created via the inline-add row.
  // - OR mode (default): strip all excluded (any match disqualifies the task).
  // - AND mode: don't strip. add-task-bar applies this list blindly against the
  //   user's typed tags, so stripping "one excluded tag" would wrongly remove a
  //   single tag the user legitimately entered (task still wouldn't hit the
  //   AND-all exclusion). If the user somehow types every excluded tag, the
  //   new task simply won't appear in this panel on next filter pass.
  tagsToRemoveForInlineCreate = computed<string[]>(() => {
    const cfg = this.panelCfg();
    if (!cfg.excludedTagIds?.length) return [];
    return cfg.excludedTagsMatch === 'all' ? [] : cfg.excludedTagIds;
  });

  additionalTaskFields = computed(() => {
    const panelCfg = this.panelCfg();
    const tagsToAdd = this.tagsToAddForInlineCreate();
    const firstProjectId = isAllProjects(panelCfg.projectIds)
      ? undefined
      : firstSpecificProjectId(panelCfg.projectIds);

    return {
      ...(tagsToAdd.length ? { tagIds: tagsToAdd } : {}),
      ...(panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.Done
        ? { isDone: true }
        : {}),
      ...(panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.UnDone
        ? { isDone: false }
        : {}),
      ...(firstProjectId ? { projectId: firstProjectId } : {}),
      // TODO scheduledState
    };
  });

  tasks = computed(() => {
    const panelCfg = this.panelCfg();
    const orderedTasks: TaskCopy[] = [];
    const nonOrderedTasks: TaskCopy[] = [];
    const taskOrder = new Map<string, number>();
    panelCfg.taskIds.forEach((id, index) => {
      // Preserve indexOf's first-occurrence ordering for repeated IDs.
      if (!taskOrder.has(id)) {
        taskOrder.set(id, index);
      }
    });

    // Hoist the backlog predicate out of the filter callback so it's allocated
    // once per recompute, not once per task.
    const isInBacklog = (t: Readonly<TaskCopy>): boolean => this._isTaskInBacklog(t);
    const ranges = this._timeframeRanges();
    const startOfNextDayDiffMs = this._startOfNextDayDiffMs();
    const allFilteredTasks = this.allTasks().filter(
      (task) =>
        doesTaskMatchPanel(task, panelCfg, isInBacklog) &&
        doesTaskMatchPanelTimeframes(task, ranges, startOfNextDayDiffMs),
    );

    allFilteredTasks.forEach((task) => {
      const index = taskOrder.get(task.id);
      if (index !== undefined) {
        orderedTasks[index] = task;
      } else {
        nonOrderedTasks.push(task);
      }
    });
    const merged = [...orderedTasks, ...nonOrderedTasks].filter((t) => !!t);

    if (panelCfg.sortBy) {
      const dir = panelCfg.sortDir === 'desc' ? -1 : 1;
      const cmp = buildComparator(panelCfg.sortBy);
      merged.sort((a, b) => dir * cmp(a, b));
    }

    return merged;
  });

  async drop(ev: CdkDragDrop<TaskCopy[], TaskCopy[], TaskCopy>): Promise<void> {
    if (ev.previousContainer.id === ev.container.id && !this.isManualOrder()) {
      return;
    }
    const ids = this._taskIdsToMove(ev.item.data.id, ev.previousContainer.data);
    if (!ids.length) return;
    const isSamePanel = ev.previousContainer.id === ev.container.id;
    const moving = new Set(ids);
    // CDK removes only the dragged row when calculating its insertion index.
    // Group placement removes every moving row, including destination duplicates.
    const index = this.tasks()
      .filter((task) => !isSamePanel || task.id !== ev.item.data.id)
      .slice(0, ev.currentIndex)
      .filter((task) => !moving.has(task.id)).length;
    if (isSamePanel) {
      this._placeInOrder(ids, index);
      return;
    }
    await this.moveTasks(ids, index);
  }

  /** Shared by dragging and keyboard placement; normal task actions retain their effects. */
  async moveTasks(ids: string[], index = this.tasks().length): Promise<boolean> {
    if (this.isMoving()) return false;
    this.isMoving.set(true);
    const panelCfg = this.panelCfg();
    try {
      const tasks = (
        await Promise.all(
          unique(ids).map((id) =>
            firstValueFrom(this.store.select(selectTaskById, { id })),
          ),
        )
      ).filter((task): task is TaskCopy => !!task);
      const ranges = this._timeframeRanges();
      // A timeframe panel moves tasks into its range itself (`_applyPanelDates`);
      // only an unrestricted panel has to ask for a date.
      const unscheduled =
        panelCfg.scheduledState === BoardPanelCfgScheduledState.Scheduled &&
        ranges.scheduled === undefined
          ? tasks.filter((task) => !task.dueDay && !task.dueWithTime)
          : [];
      const withoutDeadline =
        panelCfg.deadlineState === BoardPanelCfgDeadlineState.HasDeadline &&
        ranges.deadline === undefined
          ? tasks.filter((task) => !task.deadlineDay && !task.deadlineWithTime)
          : [];
      let schedule: Parameters<TaskBulkActionService['scheduleFor']>[0] | undefined;
      if (unscheduled.length) {
        schedule = await firstValueFrom(
          this._matDialog
            .open(DialogScheduleTaskComponent, {
              data: { isSelectDueOnly: true },
            })
            .afterClosed(),
        );
        if (!schedule?.date) return false;
      }
      let deadline: Parameters<TaskBulkActionService['setDeadlineFor']>[0] | undefined;
      if (withoutDeadline.length) {
        deadline = await firstValueFrom(
          this._matDialog
            .open(DialogDeadlineComponent, {
              autoFocus: false,
              data: { isSelectDeadlineOnly: true },
            })
            .afterClosed(),
        );
        if (!deadline?.date) return false;
      }
      if (this._destroyRef.destroyed) return false;
      this.multiSelect.setBulkFeedbackSuppressed(true);
      try {
        for (const original of tasks) {
          // A preceding parent/project move can change the next selected task.
          const task = await firstValueFrom(
            this.store.select(selectTaskById, { id: original.id }),
          );
          if (!task) continue;
          await this._applyPanel(task, panelCfg);
          const updated = await firstValueFrom(
            this.store.select(selectTaskById, { id: task.id }),
          );
          if (updated) {
            this._applyPanelDates(updated, panelCfg, ranges, tasks.length === 1);
          }
        }
        // Flush captured task operations before the dependent panel-order write.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const movingIds = tasks.map((task) => task.id);
        this._placeInOrder(movingIds, index);
        if (schedule) {
          // Panel placement may have moved a parent and its children to a new
          // project. Scheduling actions must carry the resulting task data.
          const tasksToSchedule = (
            await Promise.all(
              unscheduled.map((task) =>
                firstValueFrom(this.store.select(selectTaskById, { id: task.id })),
              ),
            )
          ).filter(
            (task): task is TaskCopy => !!task && !task.dueDay && !task.dueWithTime,
          );
          await this._injector
            .get(TaskBulkActionService)
            .scheduleFor(schedule, tasksToSchedule);
        }
        if (deadline) {
          const tasksForDeadline = (
            await Promise.all(
              withoutDeadline.map((task) =>
                firstValueFrom(this.store.select(selectTaskById, { id: task.id })),
              ),
            )
          ).filter(
            (task): task is TaskCopy =>
              !!task && !task.deadlineDay && !task.deadlineWithTime,
          );
          await this._injector
            .get(TaskBulkActionService)
            .setDeadlineFor(deadline, tasksForDeadline);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.multiSelect.reanchorAfterMove(movingIds, this.rows());
      } finally {
        this.multiSelect.setBulkFeedbackSuppressed(false);
      }
      return true;
    } finally {
      this.isMoving.set(false);
    }
  }

  private _placeInOrder(ids: string[], index: number): void {
    const moving = new Set(ids);
    const remainingIds = this.tasks()
      .map((task) => task.id)
      .filter((id) => !moving.has(id));
    remainingIds.splice(index, 0, ...ids);
    this.store.dispatch(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: this.panelCfg().id,
        taskIds: remainingIds,
      }),
    );
  }

  private async _applyPanel(task: TaskCopy, panelCfg: BoardPanelCfg): Promise<void> {
    const newTagIds = rewriteTagIdsForPanel(task.tagIds || [], panelCfg);

    const updates: Partial<TaskCopy> = {};

    // conditional updates
    if (!fastArrayCompare(task.tagIds || [], newTagIds)) {
      this.taskService.updateTags(task, unique(newTagIds));
    }
    if (panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.Done && !task.isDone) {
      updates.isDone = true;
    } else if (
      panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.UnDone &&
      task.isDone
    ) {
      updates.isDone = false;
    }

    const firstProjectId = firstSpecificProjectId(panelCfg.projectIds);
    if (
      firstProjectId &&
      panelCfg.projectIds &&
      panelCfg.projectIds.length > 0 &&
      !isAllProjects(panelCfg.projectIds) &&
      !panelCfg.projectIds.includes(task.projectId)
    ) {
      const taskWithSubTasks = await this.store
        .pipe(
          select(selectTaskByIdWithSubTaskData, { id: task.parentId || task.id }),
          take(1),
        )
        .toPromise();

      if (taskWithSubTasks) {
        this.store.dispatch(
          TaskSharedActions.moveToOtherProject({
            task: taskWithSubTasks,
            targetProjectId: firstProjectId,
          }),
        );
      }
    }

    if (Object.keys(updates).length > 0) {
      this.store.dispatch(
        TaskSharedActions.updateTask({ task: { id: task.id, changes: updates } }),
      );
    }

    if (panelCfg.scheduledState === BoardPanelCfgScheduledState.NotScheduled) {
      this.store.dispatch(
        TaskSharedActions.unscheduleTask({ id: task.id, isSkipToast: true }),
      );
    }
    if (
      panelCfg.deadlineState === BoardPanelCfgDeadlineState.NoDeadline &&
      (task.deadlineDay || task.deadlineWithTime)
    ) {
      this.store.dispatch(
        TaskSharedActions.removeDeadline({ taskId: task.id, isSkipSnack: true }),
      );
    }
    await this._checkBacklogState(panelCfg, task.id);
  }

  /**
   * Moves the task's scheduled day / deadline to the nearest day inside the
   * panel's timeframe, so a dropped task stays in the panel. Only panels with a
   * restricted timeframe do this.
   */
  private _applyPanelDates(
    task: TaskCopy,
    panelCfg: BoardPanelCfg,
    ranges: BoardPanelTimeframeRanges,
    isShowSnack: boolean,
  ): void {
    const todayStr = this._trackingInterval.todayDateStr();
    const startOfNextDayDiffMs = this._startOfNextDayDiffMs();

    if (ranges.scheduled !== undefined) {
      const currentDay = getBoardTaskDateStr(
        task.dueDay,
        task.dueWithTime,
        startOfNextDayDiffMs,
      );
      const day = adjustDateToBoardRange(ranges.scheduled, currentDay, todayStr);
      if (day && day !== currentDay) {
        this.store.dispatch(PlannerActions.planTaskForDay({ task, day }));
        if (isShowSnack) {
          this._showDateAdjustedSnack(task, day, T.F.TASK.S.SCHEDULED_DATE_ADJUSTED);
        }
      }
    }

    if (ranges.deadline !== undefined) {
      const currentDay = getBoardTaskDateStr(
        task.deadlineDay,
        task.deadlineWithTime,
        startOfNextDayDiffMs,
      );
      const deadlineDay = adjustDateToBoardRange(ranges.deadline, currentDay, todayStr);
      if (deadlineDay && deadlineDay !== currentDay) {
        this.store.dispatch(
          TaskSharedActions.setDeadline({
            taskId: task.id,
            deadlineDay,
            // Same as setting this deadline anywhere else: a deadline of today
            // also plans the task for today.
            ...getDeadlineAutoPlanFields(this._dateService, deadlineDay),
            isSkipSnack: true,
          }),
        );
        if (isShowSnack) {
          this._showDateAdjustedSnack(task, deadlineDay, T.F.TASK.S.DEADLINE_ADJUSTED);
        }
      }
    }
  }

  private _showDateAdjustedSnack(task: TaskCopy, day: string, msg: string): void {
    const date =
      day === this._trackingInterval.todayDateStr()
        ? this._translateService.instant(T.G.TODAY_TAG_TITLE)
        : this._localeDatePipe.transform(day, 'shortDate');
    this._snackService.open({
      type: 'SUCCESS',
      msg,
      translateParams: { title: truncate(task.title, 20), date: date || '' },
    });
  }

  async afterTaskAdd({ taskId, isAddToBottom, isNewTask }: TaskAddEvent): Promise<void> {
    const panelCfg = this.panelCfg();

    if (!isNewTask) {
      const task = await this.store
        .select(selectTaskById, { id: taskId })
        .pipe(first())
        .toPromise();
      if (!task) {
        return;
      }

      const newTagIds = unique(rewriteTagIdsForPanel(task.tagIds || [], panelCfg));

      if (!fastArrayCompare(task.tagIds || [], newTagIds)) {
        this.taskService.updateTags(task, newTagIds);
      }
      return;
    }

    this.store.dispatch(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: panelCfg.id,
        taskIds: isAddToBottom
          ? [...panelCfg.taskIds, taskId]
          : [taskId, ...panelCfg.taskIds],
      }),
    );

    await this._checkToScheduledTask(panelCfg, taskId);
    await this._checkDeadlineState(panelCfg, taskId);
    await this._checkBacklogState(panelCfg, taskId);
  }

  scheduledDateColor(task: TaskCopy): ScheduledDateColor {
    if (
      task.isDone ||
      this.taskService.currentTaskId() === task.id ||
      (!task.dueDay && !task.dueWithTime)
    ) {
      return '';
    }
    return getScheduledDateColor(
      task,
      this._trackingInterval.todayDateStr(),
      this._dateService.getStartOfNextDayDiffMs(),
      task.dueWithTime
        ? readClockUntilDue(
            this._trackingInterval.clockTimestamp,
            this._trackingInterval.clockMinute,
            task.dueWithTime,
          )
        : 0,
    );
  }

  scheduleTask(task: TaskCopy, ev?: MouseEvent): void {
    ev?.preventDefault();
    ev?.stopPropagation();
    this._matDialog.open(DialogScheduleTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  editDeadline(task: TaskCopy): void {
    this._matDialog.open(DialogDeadlineComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  private async _checkToScheduledTask(
    panelCfg: BoardPanelCfg,
    taskId: string,
  ): Promise<void> {
    if (panelCfg.scheduledState === BoardPanelCfgScheduledState.Scheduled) {
      const task = await firstValueFrom(
        this.store.select(selectTaskById, { id: taskId }),
      );
      if (!task) return;
      const ranges = this._timeframeRanges();
      if (ranges.scheduled !== undefined) {
        this._applyPanelDates(task, panelCfg, { scheduled: ranges.scheduled }, true);
      } else if (!task.dueDay && !task.dueWithTime) {
        this.scheduleTask(task);
      }
    }
    if (panelCfg.scheduledState === BoardPanelCfgScheduledState.NotScheduled) {
      this.store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: taskId,
          isSkipToast: false,
        }),
      );
    }
  }

  private async _checkDeadlineState(
    panelCfg: BoardPanelCfg,
    taskId: string,
  ): Promise<void> {
    if (panelCfg.deadlineState !== BoardPanelCfgDeadlineState.HasDeadline) {
      return;
    }
    const task = await firstValueFrom(this.store.select(selectTaskById, { id: taskId }));
    if (!task) return;
    const ranges = this._timeframeRanges();
    if (ranges.deadline !== undefined) {
      this._applyPanelDates(task, panelCfg, { deadline: ranges.deadline }, true);
    } else if (!task.deadlineDay && !task.deadlineWithTime) {
      this.editDeadline(task);
    }
  }

  private async _checkBacklogState(
    panelCfg: BoardPanelCfg,
    taskId: string,
  ): Promise<void> {
    if (
      !panelCfg.backlogState ||
      panelCfg.backlogState === BoardPanelCfgTaskTypeFilter.All
    ) {
      return;
    }

    const task = await this.store
      .select(selectTaskById, { id: taskId })
      .pipe(first())
      .toPromise();

    if (!task || !task.projectId) {
      return;
    }

    const project = this.allProjects().find((p) => p.id === task.projectId);
    const isInBacklog = this._isTaskInBacklog(task);

    if (panelCfg.backlogState === BoardPanelCfgTaskTypeFilter.NoBacklog && isInBacklog) {
      this.store.dispatch(
        moveProjectTaskToRegularListAuto({
          taskId: task.id,
          projectId: task.projectId,
          isMoveToTop: false,
        }),
      );
    } else if (
      panelCfg.backlogState === BoardPanelCfgTaskTypeFilter.OnlyBacklog &&
      !isInBacklog &&
      project?.isEnableBacklog
    ) {
      this.store.dispatch(
        moveProjectTaskToBacklogListAuto({
          taskId: task.id,
          projectId: task.projectId,
        }),
      );
    }
  }

  _isTaskInBacklog(task: Readonly<TaskCopy>): boolean {
    return this.allBacklogTaskIds().has(task.parentId || task.id);
  }
}
