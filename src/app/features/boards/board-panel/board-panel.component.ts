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
  viewChild,
} from '@angular/core';
import { CdkDrag, CdkDragDrop } from '@angular/cdk/drag-drop';
import { BoardPanelCfg } from '../boards.model';
import {
  getPanelItems,
  getPanelSortKey,
  matchPanelTasks,
  panelToCriteria,
} from '../boards.util';
import {
  buildTaskComparator,
  isCriteriaUnreachableForNewTasks,
} from '../../tasks/task-criteria/task-criteria';
import { TaskMatchChanges } from '../../tasks/task-criteria/task-criteria.model';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { TODAY_TAG } from '../../tag/tag.const';
import {
  mapIdsToTasksWithSubTasks,
  selectAllTasksInActiveProjects,
  selectTaskById,
  selectTaskFeatureState,
  TaskWithSubTasksCache,
} from '../../tasks/store/task.selectors';
import {
  VIEW_TASK_LIST,
  ViewNewTaskTarget,
  ViewTaskListHost,
} from '../../tasks/view-task-list.token';
import { INBOX_PROJECT } from '../../project/project.const';
import { selectAllTags } from '../../tag/store/tag.reducer';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { T } from '../../../t.const';
import { TaskCopy, TaskWithSubTasks } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { BoardsActions } from '../store/boards.actions';
import { unique } from '../../../util/unique';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { TranslateService } from '@ngx-translate/core';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { MatDialog } from '@angular/material/dialog';
import { fastArrayCompare } from '../../../util/fast-array-compare';
import { TaskAddEvent } from '../../tasks/add-task-bar/add-task-bar.component';
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
import { SnackService } from '../../../core/snack/snack.service';
import { BOARD_PANEL } from './board-panel.token';
import { BoardPanelCardsComponent } from './board-panel-cards.component';
import { BoardPanelRowsComponent } from './board-panel-rows.component';
import {
  getDropIndex,
  getNewTaskFields,
  getNewTaskTagsToAdd,
  getNewTaskTagsToRemove,
  getPanelChangesToMatch,
  hasMissingTag,
  orderPanelTasks,
  PANEL_SHOWN_LIMIT,
  placeInOrder,
  withPartOrder,
} from './panel-rules';
import { PanelTaskChangesService } from './panel-task-changes.service';

export interface BoardPanelNavigation {
  direction: -1 | 1 | 'up' | 'down';
  rowIndex: number;
  taskIds?: string[];
  focusTaskId?: string;
}

/**
 * One column (board) or section (list) of a view: its tasks, its rules
 * applied to moves and new tasks (`panel-rules.ts`), keyboard navigation and
 * the add bar. Shown as cards (`board-panel-cards`) or task rows
 * (`board-panel-rows`); both render this state and call these actions.
 */
@Component({
  selector: 'board-panel',
  standalone: true,
  imports: [BoardPanelCardsComponent, BoardPanelRowsComponent],
  template: `
    @if (isListLayout()) {
      <board-panel-rows></board-panel-rows>
    } @else {
      <board-panel-cards></board-panel-cards>
    }
  `,
  styleUrl: './board-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: BOARD_PANEL, useExisting: forwardRef(() => BoardPanelComponent) },
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
  private _element = inject<ElementRef<HTMLElement>>(ElementRef);
  private _injector = inject(Injector);
  private _destroyRef = inject(DestroyRef);
  private _config = inject(GlobalConfigService);
  private _changes = inject(PanelTaskChangesService);
  private _cardsView = viewChild(BoardPanelCardsComponent);
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
      hasMissingTag(this.tagsToAddForInlineCreate(), this._viewCtx.tagIdSet()),
  );

  /** Whether a change of the task can make it match (refused moves stay put). */
  canEnter(task: TaskCopy): boolean {
    return this._changesToMatch(task) !== null;
  }

  /** The panel's rules for this task, guarded against missing tags. */
  private _changesToMatch(
    task: TaskCopy,
    criteria = this.criteria(),
    ctx = this.criteriaCtx(),
  ): TaskMatchChanges | null {
    return getPanelChangesToMatch(task, criteria, ctx, this._viewCtx.tagIdSet());
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
    return this._cardsView()?.cards() ?? [];
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
      ':scope > board-panel-cards > header > .title',
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
    const isRevealed = !!taskId && this._reveal([taskId]);
    if (this.isListLayout() || isRevealed) {
      // A section a row was moved into may be collapsed; rows render later.
      if (this.isListLayout()) this.isSectionExpanded.set(true);
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

  /** The arrow keys on a card: the rendered cards, then the panel beside, above or below. */
  navigate(taskId: string, key: TaskCardArrow): void {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.dataset.taskId === taskId);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      this.adjacentPanel.emit({
        direction: key === 'ArrowLeft' ? -1 : 1,
        rowIndex: index,
      });
      return;
    }
    const isUp = key === 'ArrowUp';
    const next = index + (isUp ? -1 : 1);
    if (next >= 0 && next < rows.length) {
      this.focusRow(next);
    } else {
      // Past the first or last card: the stacked panel's last or first one.
      this.adjacentPanel.emit({
        direction: isUp ? 'up' : 'down',
        rowIndex: isUp ? Number.MAX_SAFE_INTEGER : 0,
      });
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
    const taskIds = this._taskIdsToMove(taskId, this.mainItems());
    if (!taskIds.length) return;
    this.adjacentPanel.emit({
      direction,
      rowIndex: 0,
      taskIds,
      focusTaskId: taskId,
    });
  }

  // Done cards don't move, like the done rows: their order and column follow
  // from being done.
  reorder(taskId: string, direction: TaskCardMove): void {
    const ids = this.mainItems().map((task) => task.id);
    const selected = new Set(this._taskIdsToMove(taskId, this.mainItems()));
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
    const partOrder = reorderBoardTasks(ids, selected, direction);
    if (!fastArrayCompare(ids, partOrder)) {
      this.store.dispatch(
        BoardsActions.updatePanelCfgTaskIds({
          panelId: this.panelCfg().id,
          taskIds: withPartOrder(
            this.tasks().map((task) => task.id),
            partOrder,
          ),
        }),
      );
      afterNextRender(() => this.focusRow(0, taskId), { injector: this._injector });
    }
  }

  /**
   * The task, or the selection it is part of when all of it is among
   * `sourceTasks` (the panel's open items, all of them: a selection reaching
   * past the rendered ones moves whole); none when the selection reaches
   * further, or the task isn't among them (a done card).
   */
  private _taskIdsToMove(taskId: string, sourceTasks: readonly TaskCopy[]): string[] {
    if (!sourceTasks.some((task) => task.id === taskId)) return [];
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

  // The items the header counts: in the list layout a parent's estimate
  // already covers its nested subtasks.
  totalEstimate = computed(() =>
    this.mainItems().reduce((acc, task) => acc + (task.timeEstimate || 0), 0),
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

  // What a new task created from the panel (its "+" or the add-task bar)
  // gets and loses (see `panel-rules.ts`).
  tagsToAddForInlineCreate = computed(() => getNewTaskTagsToAdd(this.panelCfg()));
  tagsToRemoveForInlineCreate = computed(() => getNewTaskTagsToRemove(this.panelCfg()));
  additionalTaskFields = computed(() =>
    getNewTaskFields(this.panelCfg(), this.criteria()),
  );

  tasks = computed(() => {
    const panelCfg = this.panelCfg();
    const sortKey = this.sortKey();
    return orderPanelTasks(
      matchPanelTasks(this.allTasks(), this.criteria(), this.criteriaCtx()),
      panelCfg.taskIds,
      sortKey
        ? {
            cmp: buildTaskComparator(sortKey, {
              collator: this._collator,
              tagRankById: sortKey === 'tag' ? this._tagRankById() : undefined,
            }),
            dir: panelCfg.sortDir === 'desc' ? -1 : 1,
          }
        : undefined,
    );
  });

  /**
   * A card dropped here. The lists' data are the panels' open cards, all of
   * them (`mainItems`), so a selection reaching past the rendered ones moves
   * whole; the marker is placed among the rendered cards.
   */
  async drop(ev: CdkDragDrop<TaskCopy[], TaskCopy[], TaskCopy>): Promise<void> {
    if (ev.previousContainer.id === ev.container.id && !this.isManualOrder()) {
      return;
    }
    const ids = this._taskIdsToMove(ev.item.data.id, ev.previousContainer.data);
    if (!ids.length) return;
    const isSamePanel = ev.previousContainer.id === ev.container.id;
    // CDK removes only the dragged card when calculating its insertion index;
    // placement removes every moving one, including destination duplicates.
    const moving = new Set(ids);
    // Past the cards shown, a card stays the last one shown.
    const index = Math.min(
      getDropIndex(
        this.tasks().map((task) => task.id),
        this.shownMain().map((task) => task.id),
        moving,
        ev.currentIndex,
        isSamePanel ? ev.item.data.id : undefined,
      ),
      this._endOfShownIndex(moving),
    );
    if (isSamePanel) {
      this._placeInOrder(ids, index);
      return;
    }
    await this.moveTasks(ids, index);
  }

  /**
   * Shared by dragging and keyboard placement; normal task actions retain their
   * effects. Without an index, tasks go after the last open item shown, so a
   * move into a long column neither hides the task nor renders the whole column.
   */
  async moveTasks(ids: string[], index = this._endOfShownIndex()): Promise<boolean> {
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
      const changesFor = (task: TaskCopy): TaskMatchChanges | null =>
        this._changesToMatch(task, criteria, ctx);
      const changesById = new Map(tasks.map((task) => [task.id, changesFor(task)]));
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
          const changes = task && changesFor(task);
          if (task && changes) await this._changes.applyTaskChanges(task, changes);
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
    this.store.dispatch(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: this.panelCfg().id,
        taskIds: placeInOrder(
          this.tasks().map((task) => task.id),
          ids,
          index,
        ),
      }),
    );
    this._revealAfterRender(ids);
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
    await this._changes.applyTaskChanges(task, changes);
    if (changes.isAskForSchedule) {
      this.scheduleTask(task);
    }
    await this._applyDateChanges([taskId]);
    // Added to the bottom of a long column: it shows.
    this._revealAfterRender([taskId]);
  }

  /** Planned day and deadline, by the panel's rules as they are now. */
  private _applyDateChanges(taskIds: string[]): Promise<void> {
    const criteria = this.criteria();
    const ctx = this.criteriaCtx();
    return this._changes.applyDateChanges(
      taskIds,
      (task) => this._changesToMatch(task, criteria, ctx),
      ctx.startOfNextDayDiffMs,
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

  // === WHAT THE PANEL SHOWS (both renderers) ===

  /** Cards, or the list layout's top-level rows; done ones in their own group. */
  private readonly _items = computed(() =>
    getPanelItems(this.tasks(), this.panelCfg(), this.isListLayout()),
  );
  readonly mainItems = computed(() => this._items().main, { equal: fastArrayCompare });
  readonly doneItems = computed(() => this._items().done, { equal: fastArrayCompare });
  // Same helper as the view editor's live count (`getPanelHeaderCount`).
  readonly headerCount = computed(() => this.mainItems().length);

  // Local only, never synced: the parts past PANEL_SHOWN_LIMIT, shown on
  // "Show all" or when a task there is moved, added or focused.
  readonly isShowAll = signal(false);
  // Local only, never synced: built on first expand (a view across all
  // projects can hold many done tasks).
  readonly isDoneListExpanded = signal(false);
  // Local only, never synced, like the done section.
  readonly isSectionExpanded = signal(true);

  /** The main items rendered (capped before anything is built for them). */
  readonly shownMain = computed(() => this._capped(this.mainItems(), this.isShowAll()), {
    equal: fastArrayCompare,
  });
  /** The done items rendered: none while their group is collapsed. */
  readonly shownDone = computed(
    () =>
      this.isDoneListExpanded() ? this._capped(this.doneItems(), this.isShowAll()) : [],
    { equal: fastArrayCompare },
  );

  /**
   * Where moved tasks go at the end of what is shown, counted without them
   * (like `placeInOrder`): the end of the panel, or, while it is cut off at
   * the limit, the place of the last open item shown, so they stay in view.
   */
  private _endOfShownIndex(moving: ReadonlySet<string> = new Set()): number {
    const order = this.tasks()
      .map((task) => task.id)
      .filter((id) => !moving.has(id));
    const shown = this.shownMain();
    if (shown.length === this.mainItems().length) return order.length;
    const kept = shown.filter((task) => !moving.has(task.id));
    const last = kept[kept.length - 1];
    if (!last) return 0;
    // Moved from among the shown ones, they free their places: after the
    // last kept one they still show.
    const isRoomAfterLast = shown.length - kept.length >= moving.size;
    return order.indexOf(last.id) + (isRoomAfterLast ? 1 : 0);
  }

  private _capped(items: TaskCopy[], isShowAll: boolean): TaskCopy[] {
    return isShowAll || items.length <= PANEL_SHOWN_LIMIT
      ? items
      : items.slice(0, PANEL_SHOWN_LIMIT);
  }

  /**
   * `_reveal` once the new order has reached this panel (the board passes
   * the stored panel down on its next render).
   */
  private _revealAfterRender(taskIds: readonly string[]): void {
    afterNextRender(() => this._reveal(taskIds), { injector: this._injector });
  }

  /** Shows the whole panel when one of the tasks is past the limit. */
  private _reveal(taskIds: readonly string[]): boolean {
    if (this.isShowAll()) return false;
    const isHidden = (items: TaskCopy[]): boolean =>
      items.slice(PANEL_SHOWN_LIMIT).some((task) => taskIds.includes(task.id));
    if (
      isHidden(this.mainItems()) ||
      (this.isDoneListExpanded() && isHidden(this.doneItems()))
    ) {
      this.isShowAll.set(true);
      return true;
    }
    return false;
  }

  // === LIST LAYOUT (ViewTaskListHost) ===

  // Built through long-lived caches (one per part: a cache keeps only the ids
  // of its last call): the task list re-emits every second while time is
  // tracked, and untouched rows must keep their object so they don't
  // re-render (the task row is the hot path). A row's parent carries all its
  // subtasks, like a project list.
  private readonly _taskState = this.store.selectSignal(selectTaskFeatureState);
  private readonly _rowCache: TaskWithSubTasksCache = new Map();
  private readonly _doneRowCache: TaskWithSubTasksCache = new Map();

  // By id: a tracking tick replaces a task object, not the rows.
  private readonly _rowIds = computed(
    () => [...this.mainItems(), ...this.doneItems()].map((task) => task.id),
    { equal: fastArrayCompare },
  );
  private readonly _rowIdSet = computed(() => new Set(this._rowIds()));
  readonly mainRows = computed(
    () =>
      mapIdsToTasksWithSubTasks(
        this.shownMain().map((task) => task.id),
        this._taskState()?.entities ?? {},
        this._rowCache,
      ),
    { equal: fastArrayCompare },
  );
  readonly doneRows = computed(
    () => {
      const rowIds = this._rowIdSet();
      return mapIdsToTasksWithSubTasks(
        this.shownDone().map((task) => task.id),
        this._taskState()?.entities ?? {},
        this._doneRowCache,
      ).map((task) => this._withoutOwnRowSubTasks(task, rowIds));
    },
    { equal: fastArrayCompare },
  );
  // Done rows whose open subtasks are rows of their own, without them (keyed by
  // the cached row, so an unchanged row keeps its object).
  private readonly _doneRowSubTaskCache = new WeakMap<
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
    const cached = this._doneRowSubTaskCache.get(task);
    if (cached?.key === key) return cached.row;
    const row = { ...task, subTasks };
    this._doneRowSubTaskCache.set(task, { key, row });
    return row;
  }
  readonly tagsToHide = computed(() => this.panelCfg().includedTagIds ?? []);

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
    const isDoneRow = this.doneItems().some((row) => row.id === taskId);
    // Rows move within their part of the section (open or done), all of it.
    const rows = (isDoneRow ? this.doneItems() : this.mainItems()).map((row) => row.id);
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
    const taskIds = this._taskIdsToMove(taskId, this.mainItems());
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
