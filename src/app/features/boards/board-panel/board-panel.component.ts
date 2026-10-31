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
import { NgTemplateOutlet } from '@angular/common';
import { PlannerTaskComponent } from '../../planner/planner-task/planner-task.component';
import { BoardPanelCfg, BoardPanelCfgTaskDoneState } from '../boards.model';
import {
  firstSpecificProjectId,
  getCalendarDateForDueDay,
  getPanelHeaderCount,
  getPanelRowIds,
  getPanelSortKey,
  isAllProjects,
  isPanelDoneSplit,
  matchPanelTasks,
  panelToCriteria,
} from '../boards.util';
import {
  buildTaskComparator,
  getChangesToMatch,
  isCriteriaUnreachableForNewTasks,
} from '../../tasks/task-criteria/task-criteria';
import { TaskMatchChanges } from '../../tasks/task-criteria/task-criteria.model';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { TODAY_TAG } from '../../tag/tag.const';
import {
  mapIdsToTasksWithSubTasks,
  selectTaskFeatureState,
  TaskWithSubTasksCache,
} from '../../tasks/store/task.selectors';
import { TaskListComponent } from '../../tasks/task-list/task-list.component';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import {
  VIEW_TASK_LIST,
  ViewNewTaskTarget,
  ViewTaskListHost,
} from '../../tasks/view-task-list.token';
import { INBOX_PROJECT } from '../../project/project.const';
import { selectAllTags } from '../../tag/store/tag.reducer';
import { getDeadlineAutoPlanFields } from '../../tasks/util/get-deadline-auto-plan-fields';
import { Store } from '@ngrx/store';
import {
  selectAllTasksInActiveProjects,
  selectTaskById,
  selectTaskByIdWithSubTaskData,
} from '../../tasks/store/task.selectors';
import { toSignal } from '@angular/core/rxjs-interop';
import { T } from '../../../t.const';
import { TaskCopy, TaskWithSubTasks } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { BoardsActions } from '../store/boards.actions';
import { unique } from '../../../util/unique';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { LocalDateStrPipe } from '../../../ui/pipes/local-date-str.pipe';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { MatDialog } from '@angular/material/dialog';
import { fastArrayCompare } from '../../../util/fast-array-compare';
import { dragDelayForTouch } from '../../../util/input-intent';
import { ShortPlannedAtPipe } from '../../../ui/pipes/short-planned-at.pipe';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import {
  moveProjectTaskToBacklogListAuto,
  moveProjectTaskToRegularListAuto,
} from '../../project/store/project.actions';
import {
  AddTaskBarComponent,
  TaskAddEvent,
} from '../../tasks/add-task-bar/add-task-bar.component';
import { MatTooltip } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import {
  TASK_CARD_LIST,
  TASK_CARD_LIST_ADD_BTN_SELECTOR,
  TaskCardArrow,
  TaskCardList,
  TaskCardMove,
} from '../../tasks/task-card-list.token';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import { TaskBulkActionService } from '../../tasks/task-bulk-action.service';
import { reorderBoardTasks } from '../reorder-board-tasks';
import { GlobalConfigService } from '../../config/global-config.service';
import { checkKeyCombo } from '../../../util/check-key-combo';
import {
  getScheduledDateColor,
  readClockUntilDue,
} from '../../tasks/util/get-scheduled-date-color';
import type { ScheduledDateColor } from '../../tasks/util/get-scheduled-date-color';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../../core/date/date.service';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { SnackService } from '../../../core/snack/snack.service';

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
    AddTaskBarComponent,
    MatTooltip,
    LocalDateStrPipe,
    MatIcon,
    MatIconButton,
    MatButton,
    TranslatePipe,
    ShortPlannedAtPipe,
    MsToStringPipe,
    TaskListComponent,
    CollapsibleComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './board-panel.component.html',
  styleUrl: './board-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: TASK_CARD_LIST, useExisting: forwardRef(() => BoardPanelComponent) },
    // Read by the task rows and task lists of the list layout only.
    { provide: VIEW_TASK_LIST, useExisting: forwardRef(() => BoardPanelComponent) },
  ],
  host: {
    // Angular host bindings use template attribute syntax. The list layout
    // drops the board scope, so multi-select scopes to its task list.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[attr.data-board-selection-scope]': 'isListLayout() ? null : panelCfg().id',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.isListLayout]': 'isListLayout()',
  },
})
export class BoardPanelComponent implements TaskCardList, ViewTaskListHost {
  T = T;
  dragDelayForTouch = dragDelayForTouch;

  panelCfg = input.required<BoardPanelCfg>();
  // One-column views show task rows (`task-list`) instead of cards.
  isListLayout = input<boolean>(false);
  // List layout with several panels: this panel is one section of the list.
  isSection = input<boolean>(false);
  editBoard = output<void>();
  /** A column's title: edit the view with this column open. */
  editColumn = output<void>();
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
  private _cards = viewChildren(PlannerTaskComponent, { read: ElementRef });
  readonly isMoving = signal(false);

  // Shared with the other columns and the view editor's live count.
  private readonly _viewCtx = inject(ViewCriteriaContextService);
  readonly criteria = computed(() => panelToCriteria(this.panelCfg()));
  readonly criteriaCtx = this._viewCtx.ctx;
  // Rules no change of a new task can meet (overdue, a minimum estimate …),
  // or a new task would get a tag that doesn't exist: adding would only create
  // tasks that never show up here, or a task with a dangling tag id.
  readonly isAddTaskHidden = computed(
    () =>
      isCriteriaUnreachableForNewTasks(this.criteria()) ||
      this._hasMissingTag(this.tagsToAddForInlineCreate()),
  );

  /** Whether a change of the task can make it match (refused moves stay put). */
  canEnter(task: TaskCopy): boolean {
    return this._changesToMatch(task) !== null;
  }

  /**
   * What the task needs to match this panel (`getChangesToMatch`), or `null`
   * when no change can make it match, which includes a change that would add a
   * tag that doesn't exist (a view naming a tag not created yet): the task
   * would point to a missing tag. Every path that applies the panel's rules to
   * a task goes through here.
   */
  private _changesToMatch(
    task: TaskCopy,
    criteria = this.criteria(),
    ctx = this.criteriaCtx(),
  ): TaskMatchChanges | null {
    const changes = getChangesToMatch(task, criteria, ctx);
    if (!changes?.tagIds) return changes;
    const added = changes.tagIds.filter((id) => !task.tagIds.includes(id));
    return this._hasMissingTag(added) ? null : changes;
  }

  private _hasMissingTag(tagIds: readonly string[]): boolean {
    if (!tagIds.length) return false;
    const existing = this._viewCtx.tagIdSet();
    return tagIds.some((id) => !existing.has(id));
  }

  // CDK only passes the dragged item; `moveTasks` checks the whole selection.
  readonly canEnterCard = (drag: CdkDrag<TaskCopy>): boolean =>
    !drag.data || this.canEnter(drag.data);

  rows(): HTMLElement[] {
    if (this.isListLayout()) {
      // Top-level task rows of this panel (not nested subtasks). Rows of a
      // task shown in two sections are told apart by their panel. A row that
      // left stays in the DOM while it animates out: skip destroyed hosts.
      return Array.from(
        this._element.nativeElement.querySelectorAll<HTMLElement>('task[data-task-id]'),
      ).filter(
        (row) =>
          !row.parentElement?.closest('task') && !this.multiSelect.isDestroyedHost(row),
      );
    }
    return this._cards().map((card) => card.nativeElement as HTMLElement);
  }

  /** The header "+" (absent where the panel takes no new tasks). */
  addButton(): HTMLElement | null {
    return this._element.nativeElement.querySelector<HTMLElement>(
      TASK_CARD_LIST_ADD_BTN_SELECTOR,
    );
  }

  /**
   * A column's title (a button that opens the editor). With the "+" it is a
   * header stop the arrow keys leave sideways; it takes the focus in an empty
   * column that has no "+".
   */
  private _columnTitle(): HTMLElement | null {
    return this._element.nativeElement.querySelector<HTMLElement>(
      ':scope > header > .title',
    );
  }

  // Local only, never synced: the add-task bar at the top of this panel.
  readonly isAddOpen = signal(false);

  /** The header "+": the add-task bar opens at the top (it focuses itself). */
  openAddTask(): void {
    this.isSectionExpanded.set(true);
    this.isAddOpen.set(true);
  }

  /** A collapsed section drops its add bar, so it doesn't come back on expand. */
  onSectionExpandedChange(isExpanded: boolean): void {
    this.isSectionExpanded.set(isExpanded);
    if (!isExpanded) this.isAddOpen.set(false);
  }

  /** Escape (`isRefocus`) returns focus to the "+"; a click outside doesn't. */
  closeAddTask(isRefocus: boolean): void {
    this.isAddOpen.set(false);
    if (isRefocus) this.addButton()?.focus();
  }

  focusRow(index: number, taskId?: string): void {
    if (this.isListLayout()) {
      // A section a row was moved into may be collapsed; rows render later.
      this.isSectionExpanded.set(true);
      afterNextRender(() => this._focusRowNow(index, taskId), {
        injector: this._injector,
      });
      return;
    }
    this._focusRowNow(index, taskId);
  }

  private _focusRowNow(index: number, taskId?: string): void {
    const rows = this.rows();
    const target =
      (taskId &&
        (rows.find((row) => row.dataset.taskId === taskId) ||
          this._nestedListRow(taskId))) ||
      rows[Math.min(index, rows.length - 1)] ||
      this.addButton() ||
      this._columnTitle();
    target?.focus();
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // A subtask moved into a section that shows its parent is nested there.
  private _nestedListRow(taskId: string): HTMLElement | undefined {
    if (!this.isListLayout()) return undefined;
    return Array.from(
      this._element.nativeElement.querySelectorAll<HTMLElement>('task[data-task-id]'),
    ).find(
      (row) => row.dataset.taskId === taskId && !this.multiSelect.isDestroyedHost(row),
    );
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
      (event.target !== this.addButton() && event.target !== this._columnTitle()) ||
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

  // In the list layout, the open rows the header counts: a parent's estimate
  // already covers its nested subtasks.
  totalEstimate = computed(() =>
    (this.isListLayout() ? this.mainRows() : this.tasks()).reduce(
      (acc, task) => acc + (task.timeEstimate || 0),
      0,
    ),
  );

  readonly sortKey = computed(() => getPanelSortKey(this.panelCfg()));
  isManualOrder = computed(() => !this.sortKey());

  // Only read for the tag sort; `selectSignal` doesn't subscribe until then.
  private readonly _allTags = this.store.selectSignal(selectAllTags);
  // The UI language, like the task lists' sort, so a saved view sorts titles
  // like the list it came from.
  private readonly _collator = new Intl.Collator(
    this._injector.get(TranslateService).currentLang || undefined,
    { sensitivity: 'base', numeric: true },
  );

  // Tags to auto-apply on a new task created from the panel (its "+" or the
  // add-task bar).
  // - AND mode (default): all required tags.
  // - OR mode: just the first required tag (one is enough).
  tagsToAddForInlineCreate = computed<string[]>(() => {
    const cfg = this.panelCfg();
    if (!cfg.includedTagIds?.length) return [];
    return cfg.includedTagsMatch === 'any' ? [cfg.includedTagIds[0]] : cfg.includedTagIds;
  });

  // Tags to strip from user input on a new task created from the panel.
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
    const priority = this.criteria().priority;
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
      ...(typeof priority === 'number' ? { priority } : {}),
      // Dates, deadline and backlog are applied after creation (afterTaskAdd).
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

    const allFilteredTasks = matchPanelTasks(
      this.allTasks(),
      this.criteria(),
      this.criteriaCtx(),
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

    const sortKey = this.sortKey();
    if (sortKey) {
      const dir = panelCfg.sortDir === 'desc' ? -1 : 1;
      const cmp = buildTaskComparator(sortKey, {
        collator: this._collator,
        tagRankById: sortKey === 'tag' ? this._tagRankById() : undefined,
      });
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
    try {
      const tasks = (
        await Promise.all(
          unique(ids).map((id) =>
            firstValueFrom(this.store.select(selectTaskById, { id })),
          ),
        )
      ).filter((task): task is TaskCopy => !!task);
      // One task no change can make match refuses the whole move.
      const criteria = this.criteria();
      const ctx = this.criteriaCtx();
      const changesById = new Map(
        tasks.map((task) => [task.id, this._changesToMatch(task, criteria, ctx)]),
      );
      if ([...changesById.values()].some((changes) => changes === null)) {
        this._injector.get(SnackService).open({
          type: 'CUSTOM',
          ico: 'block',
          msg: T.F.BOARDS.V.S_CANT_MOVE_HERE,
        });
        return false;
      }
      // "Scheduled" without a day: ask once for the whole move.
      const unscheduled = tasks.filter(
        (task) => changesById.get(task.id)?.isAskForSchedule,
      );
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
      if (this._destroyRef.destroyed) return false;
      this.multiSelect.setBulkFeedbackSuppressed(true);
      try {
        for (const original of tasks) {
          // A preceding parent/project move can change the next selected task.
          const task = await firstValueFrom(
            this.store.select(selectTaskById, { id: original.id }),
          );
          const changes = task && this._changesToMatch(task, criteria, ctx);
          if (task && changes) await this._applyTaskChanges(task, changes);
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
        await this._applyDateChanges(movingIds);
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

  /**
   * Applies the per-task part of what a task needs to match the panel, in the
   * order the changes depend on: project (moves the parent with its subtasks)
   * → backlog (on the parent) → one `updateTask` for tags, done and priority
   * → unschedule. Dates follow in `_applyDateChanges`.
   */
  private async _applyTaskChanges(
    task: TaskCopy,
    changes: TaskMatchChanges,
  ): Promise<void> {
    if (changes.projectId) {
      const taskWithSubTasks = await firstValueFrom(
        this.store.select(selectTaskByIdWithSubTaskData, {
          id: task.parentId || task.id,
        }),
      );
      if (taskWithSubTasks) {
        this.store.dispatch(
          TaskSharedActions.moveToOtherProject({
            task: taskWithSubTasks,
            targetProjectId: changes.projectId,
          }),
        );
      }
    }
    const projectId = changes.projectId ?? task.projectId;
    if (changes.backlog && projectId) {
      const taskId = task.parentId || task.id;
      this.store.dispatch(
        changes.backlog === 'moveIn'
          ? moveProjectTaskToBacklogListAuto({ taskId, projectId })
          : moveProjectTaskToRegularListAuto({ taskId, projectId, isMoveToTop: false }),
      );
    }
    const updates: Partial<TaskCopy> = {
      ...(changes.tagIds ? { tagIds: unique(changes.tagIds) } : {}),
      ...(changes.isDone !== undefined ? { isDone: changes.isDone } : {}),
      // `null` clears it; `undefined` would be dropped from the synced op (#9776).
      ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
    };
    if (Object.keys(updates).length > 0) {
      this.store.dispatch(
        TaskSharedActions.updateTask({ task: { id: task.id, changes: updates } }),
      );
    }
    if (changes.isUnschedule) {
      this.store.dispatch(
        TaskSharedActions.unscheduleTask({ id: task.id, isSkipToast: true }),
      );
    }
  }

  /**
   * Plans tasks for the day and sets the deadline the panel's rules ask for.
   * Re-reads each task first: earlier changes may have moved it. A planned day
   * is the logical day; a timed task keeps its time on the matching calendar
   * date. The deadline goes last: its auto-plan into Today then sees the
   * planned date.
   */
  private async _applyDateChanges(taskIds: string[]): Promise<void> {
    const criteria = this.criteria();
    const ctx = this.criteriaCtx();
    const tasksByDay = new Map<string, TaskCopy[]>();
    const deadlineChanges: [TaskCopy, TaskMatchChanges][] = [];
    for (const id of taskIds) {
      const task = await firstValueFrom(this.store.select(selectTaskById, { id }));
      const changes = task && this._changesToMatch(task, criteria, ctx);
      if (!task || !changes) continue;
      if (changes.scheduleDay) {
        const day = getCalendarDateForDueDay(
          task,
          changes.scheduleDay,
          ctx.startOfNextDayDiffMs,
        );
        tasksByDay.set(day, [...(tasksByDay.get(day) ?? []), task]);
      }
      if (changes.deadlineDay || changes.isRemoveDeadline) {
        deadlineChanges.push([task, changes]);
      }
    }
    for (const [day, tasks] of tasksByDay) {
      await this._injector
        .get(TaskBulkActionService)
        .scheduleFor(
          { date: dateStrToUtcDate(day), time: null, remindOption: null },
          tasks,
        );
    }
    for (const [task, changes] of deadlineChanges) {
      this.store.dispatch(
        changes.deadlineDay
          ? TaskSharedActions.setDeadline({
              taskId: task.id,
              deadlineDay: changes.deadlineDay,
              isSkipSnack: true,
              ...getDeadlineAutoPlanFields(this._dateService, changes.deadlineDay),
            })
          : TaskSharedActions.removeDeadline({ taskId: task.id, isSkipSnack: true }),
      );
    }
  }

  async afterTaskAdd({ taskId, isAddToBottom, isNewTask }: TaskAddEvent): Promise<void> {
    const panelCfg = this.panelCfg();
    if (isNewTask) {
      this.store.dispatch(
        BoardsActions.updatePanelCfgTaskIds({
          panelId: panelCfg.id,
          taskIds: isAddToBottom
            ? [...panelCfg.taskIds, taskId]
            : [taskId, ...panelCfg.taskIds],
        }),
      );
    }
    // A new task already got tags, done state, project and priority on
    // creation (`additionalTaskFields`); an existing one found through the add
    // row gets everything here.
    const task = await firstValueFrom(this.store.select(selectTaskById, { id: taskId }));
    const changes = task && this._changesToMatch(task);
    if (!task || !changes) {
      return;
    }
    await this._applyTaskChanges(task, changes);
    if (changes.isAskForSchedule) {
      this.scheduleTask(task);
    }
    await this._applyDateChanges([taskId]);
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

  // Side-menu tag order, for sorting by tag like task lists do. Only read when
  // the panel sorts by tag.
  private readonly _tagRankById = computed(
    () =>
      new Map(
        this._injector
          .get(MenuTreeService)
          .buildTagListInTreeOrder(
            this._allTags().filter((tag) => tag.id !== TODAY_TAG.id),
          )
          .map((tag, index) => [tag.id, index]),
      ),
  );

  // === LIST LAYOUT (ViewTaskListHost) ===

  // Built through a long-lived cache: the task list re-emits every second
  // while time is tracked, and untouched rows must keep their object so they
  // don't re-render (the task row is the hot path).
  private readonly _taskState = this.store.selectSignal(selectTaskFeatureState);
  private readonly _rowCache: TaskWithSubTasksCache = new Map();

  /**
   * Top-level rows: a matching task, unless its parent matches too (then it
   * shows under the parent). A row's parent carries all its subtasks, like a
   * project list; a subtask whose parent doesn't match is a row of its own.
   */
  private readonly _rowIds = computed(
    () => getPanelRowIds(this.tasks(), this._isDoneSplit()),
    { equal: fastArrayCompare },
  );
  private readonly _rowIdSet = computed(() => new Set(this._rowIds()));
  private readonly _rows = computed(
    () =>
      mapIdsToTasksWithSubTasks(
        this._rowIds(),
        this._taskState()?.entities ?? {},
        this._rowCache,
      ),
    { equal: fastArrayCompare },
  );
  // Done rows get their own collapsed section, unless the column only shows
  // done tasks anyway.
  private readonly _isDoneSplit = computed(() => isPanelDoneSplit(this.panelCfg()));
  readonly mainRows = computed(
    () =>
      this._isDoneSplit() ? this._rows().filter((task) => !task.isDone) : this._rows(),
    { equal: fastArrayCompare },
  );
  readonly doneRows = computed(
    () => {
      if (!this._isDoneSplit()) return [];
      const rowIds = this._rowIdSet();
      return this._rows()
        .filter((task) => task.isDone)
        .map((task) => this._withoutOwnRowSubTasks(task, rowIds));
    },
    { equal: fastArrayCompare },
  );
  // Done rows whose open subtasks are rows of their own, without them (keyed by
  // the cached row, so an unchanged row keeps its object).
  private readonly _doneRowCache = new WeakMap<
    TaskWithSubTasks,
    { key: string; row: TaskWithSubTasks }
  >();

  /** An open subtask shown as its own row isn't repeated inside its done parent. */
  private _withoutOwnRowSubTasks(
    task: TaskWithSubTasks,
    rowIds: ReadonlySet<string>,
  ): TaskWithSubTasks {
    if (!task.subTasks.some((sub) => rowIds.has(sub.id))) return task;
    const subTasks = task.subTasks.filter((sub) => !rowIds.has(sub.id));
    const key = subTasks.map((sub) => sub.id).join();
    const cached = this._doneRowCache.get(task);
    if (cached?.key === key) return cached.row;
    const row = { ...task, subTasks };
    this._doneRowCache.set(task, { key, row });
    return row;
  }
  // Local only, never synced: built on first expand (a view across all
  // projects can hold many done tasks).
  readonly isDoneListExpanded = signal(false);
  // Local only, never synced, like the done section.
  readonly isSectionExpanded = signal(true);
  readonly tagsToHide = computed(() => this.panelCfg().includedTagIds ?? []);
  // Same helper as the view editor's live count.
  readonly headerCount = computed(() =>
    getPanelHeaderCount(this.tasks(), this.panelCfg(), this.isListLayout()),
  );

  isRow(taskId: string): boolean {
    return this._rowIdSet().has(taskId);
  }

  placeRow(taskId: string, afterTaskId: string | null): void {
    const isOwnRow = this.isRow(taskId);
    if (isOwnRow && !this.isManualOrder()) {
      return;
    }
    // The panel's order covers all its tasks (subtasks and done ones too):
    // place after the anchor in that order.
    const remaining = this.tasks()
      .map((task) => task.id)
      .filter((id) => id !== taskId);
    const index = afterTaskId ? remaining.indexOf(afterTaskId) + 1 : 0;
    if (isOwnRow) {
      this._placeInOrder([taskId], index);
    } else {
      // From another column of the view: through this column's rules.
      void this.moveTasks([taskId], index);
    }
  }

  moveRow(taskId: string, to: 'up' | 'down' | 'top' | 'bottom'): boolean {
    const task = this._rows().find((row) => row.id === taskId);
    const isDoneRow = !!task?.isDone && this._isDoneSplit();
    // Rows move within their part of the section (open or done).
    const rows = (isDoneRow ? this.doneRows() : this.mainRows()).map((row) => row.id);
    const i = rows.indexOf(taskId);
    if (i === -1) {
      return false;
    }
    const isEdge = (to === 'up' && i === 0) || (to === 'down' && i === rows.length - 1);
    if (isEdge) {
      return this._moveToAdjacentSection(taskId, to, isDoneRow);
    }
    if (!this.isManualOrder()) {
      return false;
    }
    const others = rows.filter((id) => id !== taskId);
    const targetIndex =
      to === 'top'
        ? 0
        : to === 'bottom'
          ? others.length
          : Math.max(0, Math.min(others.length, i + (to === 'up' ? -1 : 1)));
    if (targetIndex !== i) {
      this.placeRow(taskId, targetIndex > 0 ? others[targetIndex - 1] : null);
    }
    return false;
  }

  /**
   * Past a section's first or last open row, a row (or the selection it is
   * part of) moves into the previous or next section through that section's
   * rules, like a card moves between stacked panels. Done rows stay.
   */
  private _moveToAdjacentSection(
    taskId: string,
    direction: 'up' | 'down',
    isDoneRow: boolean,
  ): boolean {
    if (!this.isSection() || isDoneRow) {
      return false;
    }
    const taskIds = this._taskIdsToMove(taskId, this.mainRows());
    if (!taskIds.length) {
      return false;
    }
    this.adjacentPanel.emit({ direction, rowIndex: 0, taskIds, focusTaskId: taskId });
    return true;
  }

  // The regular add-task bar adds into the first column that has this
  // (ViewTaskListRegistry). The project is always explicit: without it the bar
  // would use the project that was open before the view.
  /** The empty view's "Add task": the bar adds into this view. */
  showAddTaskBar(): void {
    // Looked up on use: the panel itself never needs the layout state.
    this._injector.get(LayoutService).showAddTaskBar();
  }

  readonly newTaskTarget = computed<ViewNewTaskTarget | null>(() => {
    if (this.isAddTaskHidden()) {
      return null;
    }
    const fields = this.additionalTaskFields();
    return {
      additionalFields: {
        ...fields,
        projectId: fields.projectId ?? this._defaultProjectId(),
      },
      tagsToRemove: this.tagsToRemoveForInlineCreate(),
      taskIdsToExclude: this.panelCfg().taskIds,
    };
  });

  // Like the add-task bar outside a project: the configured default project,
  // else the Inbox.
  private readonly _defaultProjectId = computed(() => {
    const id = this._config.cfg()?.tasks?.defaultProjectId;
    return id && this._viewCtx.projectById().has(id) ? id : INBOX_PROJECT.id;
  });
}
