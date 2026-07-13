import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { DropListModelSource, Task, TaskCopy, TaskWithSubTasks } from '../task.model';
import { TaskService } from '../task.service';
import { expandFadeFastAnimation } from '../../../ui/animations/expand.ani';
import { filterDoneTasks } from '../filter-done-tasks.pipe';
import { T } from '../../../t.const';
import { taskListAnimation } from './task-list-ani';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkDrag, CdkDragDrop, CdkDragStart, CdkDropList } from '@angular/cdk/drag-drop';
import { WorkContextType } from '../../work-context/work-context.model';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { getAnchorFromDragDrop } from '../../work-context/store/work-context-meta.helper';
import {
  moveProjectTaskInBacklogList,
  moveProjectTaskToBacklogList,
  moveProjectTaskToRegularList,
} from '../../project/store/project.actions';
import { SectionService } from '../../section/section.service';
import { moveSubTask } from '../store/task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextService } from '../../work-context/work-context.service';
import { Store } from '@ngrx/store';
import { moveItemBeforeItem } from '../../../util/move-item-before-item';
import {
  DragPointer,
  DropListService,
} from '../../../core-ui/drop-list/drop-list.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { IssueService } from '../../issue/issue.service';
import { SearchResultItem } from '../../issue/issue.model';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TaskComponent } from '../task/task.component';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskViewCustomizerService } from '../../task-view-customizer/task-view-customizer.service';
import { TaskLog } from '../../../core/log';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { DEFAULT_OPTIONS, NO_TAG_GROUP_ID } from '../../task-view-customizer/types';
import { dragDelayForTouch } from '../../../util/input-intent';
import { DateService } from '../../../core/date/date.service';
import { canConvertTaskToSubTask } from '../util/can-convert-task-to-sub-task';
import { TODAY_TAG } from '../../tag/tag.const';

export type TaskListId = 'PARENT' | 'SUB';
export type ListModelId = DropListModelSource | string;

// Reserved list ids — anything else in a PARENT-level list is treated as a
// section id. Subtask drop-lists (listId === 'SUB') use parent task ids as
// their listModelId, so the section check must additionally key on listId.
//
// RESERVED_LIST_IDS includes LATER_TODAY because section detection runs in
// _move() AFTER the LATER_TODAY short-circuit; treating LATER_TODAY as a
// section would otherwise create one if the short-circuit ever moves.
// PARENT_ALLOWED_LISTS deliberately omits LATER_TODAY — enterPredicate must
// reject parent drops onto LATER_TODAY at the drag layer (see line ~190).
//
// `satisfies DropListModelSource[]` validates each entry against the union
// (catches typos / removed variants) without narrowing the Set's value
// type, which would force a cast at every `.has(target as string)` call.
const RESERVED_LIST_IDS = new Set<string>([
  'DONE',
  'UNDONE',
  'OVERDUE',
  'BACKLOG',
  'LATER_TODAY',
  'ADD_TASK_PANEL',
] satisfies DropListModelSource[]);
const PARENT_ALLOWED_LISTS = ['DONE', 'UNDONE', 'OVERDUE', 'BACKLOG', 'ADD_TASK_PANEL'];

export interface DropModelDataForList {
  listId: TaskListId;
  listModelId: ListModelId;
  filteredTasks: TaskWithSubTasks[];
  // Set only for lists rendered inside the grouped-by-tag work view: the tagId
  // of this group, `null` for a no-single-tag bucket, `undefined` everywhere
  // else. A drop across two defined-but-different values reassigns tags.
  groupTagId?: string | null;
}

@Component({
  selector: 'task-list',
  templateUrl: './task-list.component.html',
  styleUrls: ['./task-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [taskListAnimation, expandFadeFastAnimation],
  imports: [
    MatButton,
    MatIcon,
    CdkDropList,
    CdkDrag,
    AsyncPipe,
    TranslatePipe,
    forwardRef(() => TaskComponent),
  ],
})
export class TaskListComponent implements OnDestroy, AfterViewInit {
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _store = inject(Store);
  private _sectionService = inject(SectionService);
  private _issueService = inject(IssueService);
  private _taskViewCustomizerService = inject(TaskViewCustomizerService);
  private _scheduleExternalDragService = inject(ScheduleExternalDragService);
  private _dateService = inject(DateService);
  private _ngZone = inject(NgZone);
  dropListService = inject(DropListService);
  private _layoutService = inject(LayoutService);
  protected readonly dragDelayForTouch = dragDelayForTouch;
  // Lock Y-axis on small screens only — on wider screens the task list may sit
  // beside a side-nav or other drop targets that require horizontal dragging.
  protected readonly isXs = this._layoutService.isXs;

  tasks = input<TaskWithSubTasks[]>([]);
  isHideDone = input(false);
  isHideAll = input(false);
  isSortingDisabled = input(false);

  listId = input.required<TaskListId>();
  listModelId = input.required<ListModelId>();
  parentId = input<string | undefined>(undefined);
  // Tag id of the group this list renders in the grouped-by-tag work view.
  // `undefined` (default) = not a tag group; `null` = a no-single-tag bucket
  // ('No tag' / 'Unknown tag' / a title shared by multiple tags). A real id
  // enables drag-to-retag across groups.
  groupTagId = input<string | null | undefined>(undefined);

  noTasksMsg = input<string | undefined>(undefined);
  isBacklog = input(false);
  isSubTaskList = input(false);

  currentTaskId = toSignal(this._taskService.currentTaskId$);
  dropModelDataForList = computed<DropModelDataForList>(() => {
    return {
      listId: this.listId(),
      listModelId: this.listModelId(),
      filteredTasks: this.filteredTasks(),
      groupTagId: this.groupTagId(),
    };
  });

  filteredTasks = computed<TaskWithSubTasks[]>(() => {
    const tasks = this.tasks();
    if (this.listId() === 'PARENT') {
      return tasks;
    }
    const isHideDone = this.isHideDone();
    const isHideAll = this.isHideAll();
    const currentId = this.currentTaskId() || null;
    return filterDoneTasks(tasks, currentId, isHideDone, isHideAll);
  });

  doneTasksLength = computed(() => {
    return this.tasks()?.filter((task) => task.isDone).length ?? 0;
  });
  allTasksLength = computed(() => this.tasks()?.length ?? 0);

  readonly dropList = viewChild(CdkDropList);
  private _clearDragPointerTracking: (() => void) | undefined;

  T: typeof T = T;

  ngAfterViewInit(): void {
    this.dropListService.registerDropList(this.dropList()!, this.listId() === 'SUB');
  }

  ngOnDestroy(): void {
    this._clearDragPointerTracking?.();
    this.dropListService.unregisterDropList(this.dropList()!);
    this._scheduleExternalDragService.setActiveTask(null);
    this.dropListService.setActiveDragPointer(null);
  }

  trackByFn(i: number, task: Task): string {
    return task.id;
  }

  onDragPointerDown(task: TaskWithSubTasks, event: PointerEvent): void {
    // Seed the pointer position so subtask -> parent-list drags can hit-test
    // the source subtask list before the first pointermove (see
    // _pointerSubTaskList). A plain tap that never becomes a drag leaves this
    // value stale, but it's inert: it's only read inside the subtask branch of
    // enterPredicate during an active drag, and the next real subtask drag
    // reseeds it here on its own pointerdown.
    if (task.parentId) {
      this.dropListService.setActiveDragPointer({ x: event.clientX, y: event.clientY });
    }
  }

  onDragStarted(task: TaskWithSubTasks, event: CdkDragStart): void {
    this._scheduleExternalDragService.setActiveTask(task, event.source._dragRef);
    if (task.parentId) {
      // Runs synchronously before CDK's `_startReceiving` pass, so the
      // top-level lists get their geometry cached even though the pointer is
      // still over the source subtask list (see markSubTaskDragStarting).
      this.dropListService.markSubTaskDragStarting();
      this._startDragPointerTracking();
    }
  }

  onDragEnded(): void {
    this._clearDragPointerTracking?.();
    this._scheduleExternalDragService.setActiveTask(null);
    this.dropListService.setActiveDragPointer(null);
  }

  private _startDragPointerTracking(): void {
    this._clearDragPointerTracking?.();
    this._ngZone.runOutsideAngular(() => {
      const updatePointer = (event: PointerEvent): void => {
        this.dropListService.setActiveDragPointer({
          x: event.clientX,
          y: event.clientY,
        });
      };
      window.addEventListener('pointermove', updatePointer, { passive: true });
      this._clearDragPointerTracking = (): void => {
        window.removeEventListener('pointermove', updatePointer);
        this.dropListService.setActiveDragPointer(null);
        this._clearDragPointerTracking = undefined;
      };
    });
  }

  enterPredicate = (drag: CdkDrag, drop: CdkDropList): boolean => {
    // TODO this gets called very often for nested lists. Maybe there are possibilities to optimize
    const task = drag.data;
    const targetModelId = drop.data.listModelId;
    const targetListId = drop.data.listId;
    const isSubtask = !!task.parentId;

    if (targetModelId === 'OVERDUE' || targetModelId === 'LATER_TODAY') {
      return false;
    }

    if (isSubtask) {
      const isToTopLevelList = targetModelId === 'DONE' || targetModelId === 'UNDONE';

      if (isToTopLevelList) {
        // Accept during the drag-start window so CDK caches this list's
        // geometry (see markSubTaskDragStarting).
        if (
          drag.dropContainer?.data?.listId === 'SUB' &&
          !this.dropListService.isSubTaskDragStarting()
        ) {
          const overList = this._pointerSubTaskList();
          const sourceModelId = drag.dropContainer?.data?.listModelId;
          // Keep the drag inside a subtask list (reject this top-level list)
          // while the pointer is over the SOURCE list — anywhere, so in-list
          // sorting keeps routing to the subtask list — or over an actual row
          // of a foreign list (the user is re-parenting). Over a foreign list's
          // trailing padding (the dead-band just above the next parent task),
          // fall through so the subtask converts to a main task there.
          if (
            overList &&
            (overList.listModelId === sourceModelId || overList.isOverRow)
          ) {
            return false;
          }
        }
        return true;
      }

      // Subtasks may drop into another subtask list (listId === 'SUB' with a
      // task id as listModelId). Reject section drop-lists (listId === 'PARENT'
      // with a non-reserved id) — section.taskIds is parent-only.
      if (targetListId === 'SUB' && !PARENT_ALLOWED_LISTS.includes(targetModelId)) {
        // Only claim the drop while the pointer is over an actual row of THIS
        // list. Over its trailing padding, fall through so the enclosing
        // top-level list can convert the subtask to a main task instead of this
        // list greedily re-parenting it (see _pointerSubTaskList).
        const overList = this._pointerSubTaskList();
        if (overList && overList.listModelId === targetModelId && !overList.isOverRow) {
          return false;
        }
        return true;
      }
      return false;
    }

    // Parent tasks: allow drops to PARENT_ALLOWED_LISTS, to sections (parent-level
    // lists with a non-reserved id), or to a task's subtask list if the dragged
    // task is not itself already a parent.
    const srcModelId = drag.dropContainer?.data?.listModelId;
    const srcListIdRaw = drag.dropContainer?.data?.listId;
    const isSrcSection = srcListIdRaw === 'PARENT' && !RESERVED_LIST_IDS.has(srcModelId);

    if (targetListId === 'SUB') {
      return targetModelId !== task.id && canConvertTaskToSubTask(task);
    }

    if (PARENT_ALLOWED_LISTS.includes(targetModelId)) {
      // Reject section → BACKLOG: _move() dispatches `removeTaskFromSection`
      // and returns without dispatching `moveProjectTaskToBacklogList`, so
      // the task disappears from the section but is never added to backlog.
      // Force users to first move section → today, then today → backlog.
      if (targetModelId === 'BACKLOG' && isSrcSection) return false;
      return true;
    }
    if (targetListId !== 'PARENT') return false;

    // Target is a section. Reject drops from BACKLOG: _move() treats this as
    // a pure section-add and never removes the task from project.backlogTaskIds,
    // leaving it in both lists. Force users to first move backlog → today.
    if (srcModelId === 'BACKLOG') return false;

    return true;
  };

  /**
   * Resolves which subtask list (if any) the drag pointer is currently over,
   * and whether it sits over an actual subtask *row* rather than the list's
   * empty leading/trailing padding.
   *
   * CDK excludes the source list from normal sibling enter-resolution, so we
   * hit-test the live pointer ourselves to keep the enclosing top-level list
   * from stealing in-list sorting. The row distinction matters for the
   * dead-band just above a parent task: an expanded neighbour's subtask-list
   * box (and its padding) overshoots below its last row, and because subtask
   * lists are resolved before the top-level list (sibling order), a pointer
   * aimed at "the slot above the next parent" would be greedily claimed by
   * that neighbour and re-parent the subtask. Treating only a real row (or the
   * leading pad, below) as "inside" lets that TRAILING padding convert to a
   * main task instead.
   *
   * The strip BETWEEN a parent's header and its first subtask row is split in
   * two by the drag-drop padding (see task-list.component.scss): the inner
   * part lives *inside* `.task-list-inner` (the SUB list's own top padding) and
   * the outer part is the `.sub-tasks` wrapper margin *outside* it. Both should
   * claim the drop as a first-child re-parent rather than fall through to the
   * top-level list — so the first branch reports the leading pad as
   * `isOverRow: true` (pointer above the first row), and the `.sub-tasks`
   * wrapper fallback covers the outer margin. The source SUB then blocks the
   * top-level list, keeping in-list sort intact.
   */
  private _pointerSubTaskList(): { listModelId: string; isOverRow: boolean } | null {
    const pointer = this.dropListService.activeDragPointer();
    if (!pointer) {
      return null;
    }
    // Memoised per pointer position: CDK consults several connected lists'
    // enterPredicates per pointer move, each hit-testing the same coords (see
    // DropListService.hitTestPointerSubTaskList).
    return this.dropListService.hitTestPointerSubTaskList(pointer.x, pointer.y, () =>
      this._computePointerSubTaskList(pointer),
    );
  }

  private _computePointerSubTaskList(
    pointer: DragPointer,
  ): { listModelId: string; isOverRow: boolean } | null {
    const element = document.elementFromPoint(pointer.x, pointer.y);
    if (!element) {
      return null;
    }
    const listEl = element.closest<HTMLElement>('.task-list-inner');
    if (listEl?.dataset['listId'] === 'SUB') {
      const listModelId = listEl.dataset['id'] ?? '';
      // A `task` ancestor only counts as a row of *this* list — the enclosing
      // parent task is also a `task`, but its nearest list is the top-level one.
      const rowEl = element.closest('task');
      if (!!rowEl && rowEl.closest('.task-list-inner') === listEl) {
        return { listModelId, isOverRow: true };
      }
      // Not over a row → the pointer is in this SUB list's own drag-drop
      // padding (inside the cdkDropList rect). The LEADING pad (above the first
      // row) is the same first-child re-parent strip the `.sub-tasks` fallback
      // claims, so report it as a row; the TRAILING pad stays a convert-to-main
      // dead-band (see method doc).
      const firstRow = listEl.querySelector<HTMLElement>(':scope > task');
      const isLeadingPad = !!firstRow && pointer.y < firstRow.getBoundingClientRect().top;
      return { listModelId, isOverRow: isLeadingPad };
    }
    // Leading-strip fallback: the `.sub-tasks` wrapper extends visually above
    // the cdkDropList element. Each wrapper holds exactly one SUB list (the
    // two-level nesting cap is enforced by `canApplyConvertToSubTask`), so
    // the descendant query is unambiguous.
    const wrapper = element.closest<HTMLElement>('.sub-tasks');
    if (wrapper) {
      const subListEl = wrapper.querySelector<HTMLElement>(
        '.task-list-inner[data-list-id="SUB"]',
      );
      if (subListEl) {
        return { listModelId: subListEl.dataset['id'] ?? '', isOverRow: true };
      }
    }
    return null;
  }

  async drop(
    ev: CdkDragDrop<
      DropModelDataForList,
      DropModelDataForList | string,
      TaskWithSubTasks | SearchResultItem
    >,
  ): Promise<void> {
    const srcListData = ev.previousContainer.data;
    const targetListData = ev.container.data;
    const draggedTask = ev.item.data;
    TaskLog.log('drop', {
      listId: this.listId(),
      listModelId: this.listModelId(),
      taskCount: this.filteredTasks()?.length,
    });

    if (this._scheduleExternalDragService.isCancelNextDrop()) {
      this._scheduleExternalDragService.setCancelNextDrop(false);
      return;
    }

    const targetTask = targetListData.filteredTasks[ev.currentIndex] as TaskCopy;

    if ('issueData' in draggedTask) {
      return this._addFromIssuePanel(draggedTask, srcListData as string);
    } else if (typeof srcListData === 'string') {
      throw new Error('Should not happen 2');
    }

    if (targetTask && targetTask.id === draggedTask.id) {
      return;
    }

    // Grouped-by-tag view: dropping a task into a *different* tag group
    // reassigns its tags instead of reordering. `groupTagId` is defined only for
    // lists inside that view; a string is a retag target (a real tagId → move:
    // drop the source tag, add the target; the NO_TAG_GROUP_ID sentinel → clear
    // all tags), `null` an un-retaggable bucket ('Unknown tag'/ambiguous). A
    // `null` target or reordering within one group falls through to the move below.
    //
    // NOTE: handled here, before _move() (which owns every other list-type
    // dispatch). v1 limitations: drop position within the target group isn't
    // preserved (the task takes the group's natural order), and a subtask
    // dragged from a SUB list has groupTagId === undefined, so it falls through
    // to convertToMainTask without acquiring the target tag.
    const srcTagGroup = srcListData.groupTagId;
    const targetTagGroup = targetListData.groupTagId;
    if (
      typeof targetTagGroup === 'string' &&
      srcTagGroup !== undefined &&
      targetTagGroup !== srcTagGroup
    ) {
      this.dropListService.blockAniTrigger$.next();
      this._retagAcrossGroups(
        srcTagGroup,
        targetTagGroup,
        draggedTask as TaskWithSubTasks,
      );
      return;
    }

    const newIds =
      targetTask && targetTask.id !== draggedTask.id
        ? (() => {
            const currentDraggedIndex = targetListData.filteredTasks.findIndex(
              (t) => t.id === draggedTask.id,
            );
            const currentTargetIndex = targetListData.filteredTasks.findIndex(
              (t) => t.id === targetTask.id,
            );

            // If dragging from a different list or new item, use target index
            const isDraggingDown =
              currentDraggedIndex !== -1 && currentDraggedIndex < currentTargetIndex;

            if (isDraggingDown) {
              // When dragging down, place AFTER the target item
              const filtered = targetListData.filteredTasks.filter(
                (t) => t.id !== draggedTask.id,
              );
              const targetIndexInFiltered = filtered.findIndex(
                (t) => t.id === targetTask.id,
              );
              const result = [...filtered];
              result.splice(targetIndexInFiltered + 1, 0, draggedTask);
              return result;
            } else {
              // When dragging up or from another list, place BEFORE the target item
              return [
                ...moveItemBeforeItem(
                  targetListData.filteredTasks,
                  draggedTask,
                  targetTask as TaskWithSubTasks,
                ),
              ];
            }
          })()
        : [
            ...targetListData.filteredTasks.filter((t) => t.id !== draggedTask.id),
            draggedTask,
          ];
    // Log ids only — task objects carry user titles/notes and the log history
    // is exportable (see core/log rule: never log user content).
    TaskLog.log(srcListData.listModelId, '=>', targetListData.listModelId, {
      targetTaskId: targetTask?.id,
      draggedTaskId: draggedTask.id,
      newIds: newIds.map((t) => t.id),
    });

    this.dropListService.blockAniTrigger$.next();
    this._move(
      draggedTask.id,
      srcListData.listModelId,
      targetListData.listModelId,
      srcListData.listId,
      targetListData.listId,
      newIds.map((p) => p.id),
      draggedTask as TaskWithSubTasks,
    );

    this._taskViewCustomizerService.setSort(DEFAULT_OPTIONS.sort);
  }

  async _addFromIssuePanel(
    item: SearchResultItem,
    issueProviderId: string,
  ): Promise<void> {
    if (!item.issueType || !item.issueData || !issueProviderId) {
      throw new Error('No issueData');
    }

    await this._issueService.addTaskFromIssue({
      issueDataReduced: item.issueData,
      issueProviderId: issueProviderId,
      issueProviderKey: item.issueType,
    });
  }

  // Dispatches a drag-drop to the right list-type action (regular/backlog/
  // section/subtask/overdue). NOTE: grouped-by-tag cross-group drops are
  // handled earlier, in drop(), and never reach here (see the groupTagId branch).
  private _move(
    taskId: string,
    src: DropListModelSource | string,
    target: DropListModelSource | string,
    srcListId: TaskListId,
    targetListId: TaskListId,
    newOrderedIds: string[],
    draggedTask?: TaskWithSubTasks,
  ): void {
    const isSrcRegularList = src === 'DONE' || src === 'UNDONE';
    const isTargetRegularList = target === 'DONE' || target === 'UNDONE';
    const workContextId = this._workContextService.activeWorkContextId as string;

    // Handle LATER_TODAY - prevent any moves to or from this list
    if (src === 'LATER_TODAY' || target === 'LATER_TODAY') {
      return;
    }

    // The Done list is always ordered by completion date, so reordering within
    // it can't take effect (the view re-sorts on the next emission). Skip the
    // move to avoid emitting a spurious taskIds-reorder op that would sync to
    // other devices. Dragging a task OUT of Done (DONE -> UNDONE) still falls
    // through below.
    if (src === 'DONE' && target === 'DONE') {
      return;
    }

    if (
      srcListId === 'SUB' &&
      targetListId === 'PARENT' &&
      (target === 'DONE' || target === 'UNDONE')
    ) {
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      const now = Date.now();
      const isDone = target === 'DONE';
      this._store.dispatch(
        TaskSharedActions.convertToMainTask({
          task: draggedTask ?? ({ id: taskId, parentId: src } as TaskWithSubTasks),
          isPlanForToday: this._workContextService.activeWorkContextId === TODAY_TAG.id,
          afterTaskId,
          isDone,
          today: this._dateService.todayStr(),
          modified: now,
          ...(isDone ? { doneOn: now } : {}),
        }),
      );
      return;
    }

    if (srcListId === 'PARENT' && targetListId === 'SUB') {
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        TaskSharedActions.convertToSubTask({
          taskId,
          targetParentId: target as string,
          afterTaskId,
        }),
      );
      return;
    }

    if (workContextId) {
      // Section drop-lists are PARENT-level lists whose listModelId is a
      // section id (anything that isn't one of the reserved keywords).
      // Subtask drop-lists (listId === 'SUB') also use non-reserved
      // listModelIds (parent task ids) — those must NOT be treated as
      // sections, otherwise a subtask drag would dispatch addTaskToSection
      // instead of moveSubTask.
      const targetIsSection = targetListId === 'PARENT' && !RESERVED_LIST_IDS.has(target);
      const srcIsSection = srcListId === 'PARENT' && !RESERVED_LIST_IDS.has(src);

      if (targetIsSection) {
        const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
        // Pass the source section explicitly so replay is deterministic.
        // `null` means the task wasn't in a section before the drag.
        const sourceSectionId = srcIsSection ? (src as string) : null;
        this._sectionService.addTaskToSection(
          target as string,
          taskId,
          afterTaskId,
          sourceSectionId,
        );
        return;
      }
      if (srcIsSection) {
        // Dragged out of a section into the no-section area. Single op:
        // section-shared meta-reducer strips section membership AND
        // repositions in workContext.taskIds so the task lands at the
        // dropped slot atomically (no partial-replay window).
        //
        // `afterTaskId` is computed from `newOrderedIds` (the visible
        // no-section bucket) but is then applied against the FULL
        // workContext.taskIds list — `moveItemAfterAnchor` preserves the
        // relative order of all unmoved items, so any sectioned tasks
        // interleaved before the anchor stay where they are and the
        // displayed no-section order is correct.
        const workContextType = this._workContextService
          .activeWorkContextType as WorkContextType;
        const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
        this._sectionService.removeTaskFromSection(
          src as string,
          taskId,
          workContextId,
          workContextType,
          afterTaskId,
        );
        return;
      }
    }

    if (isSrcRegularList && isTargetRegularList) {
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
    } else if (target === 'OVERDUE') {
      // Cannot drop into OVERDUE list
      return;
    } else if (src === 'OVERDUE' && !isTargetRegularList) {
      // OVERDUE tasks can only be moved to UNDONE or DONE, not BACKLOG or subtask lists
      return;
    } else if (src === 'OVERDUE' && isTargetRegularList) {
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        TaskSharedActions.planTasksForToday({
          taskIds: [taskId],
          today: this._dateService.todayStr(),
          startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
        }),
      );
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
      if (target === 'DONE') {
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: { id: taskId, changes: { isDone: true } },
          }),
        );
      }
    } else if (src === 'BACKLOG' && target === 'BACKLOG') {
      // move inside backlog
      const afterTaskId = getAnchorFromDragDrop(taskId, newOrderedIds);
      this._store.dispatch(
        moveProjectTaskInBacklogList({ taskId, afterTaskId, workContextId }),
      );
    } else if (src === 'BACKLOG' && isTargetRegularList) {
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
    } else if (isSrcRegularList && target === 'BACKLOG') {
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

  /**
   * Reassign tags when a task is dragged across tag-group boundaries in the
   * grouped-by-tag work view:
   * - target is the {@link NO_TAG_GROUP_ID} bucket → clear all tags;
   * - otherwise move semantics: drop the source group's tag (when the drag
   *   started from a real tag group) and add the target group's tag.
   * `updateTags` de-dupes, so a task that already carries the target tag is fine.
   *
   * NOTE: deliberately a plain filter + append rather than reusing boards'
   * `rewriteTagIdsForPanel` — that helper lives in the boards feature, and
   * importing it here would invert the dependency direction (boards depends on
   * tasks). For a single tag the rewrite is trivial; promote a shared tag util
   * if a group ever needs to represent multiple tags.
   */
  private _retagAcrossGroups(
    srcTagId: string | null,
    targetTagId: string,
    task: TaskWithSubTasks,
  ): void {
    if (targetTagId === NO_TAG_GROUP_ID) {
      this._taskService.updateTags(task, []);
      return;
    }
    const nextTagIds = [
      ...(task.tagIds ?? []).filter((id) => id !== srcTagId),
      targetTagId,
    ];
    this._taskService.updateTags(task, nextTagIds);
  }

  expandDoneTasks(): void {
    const pid = this.parentId();
    if (!pid) {
      throw new Error('Parent ID is undefined');
    }

    this._taskService.showSubTasks(pid);
    // note this might be executed from the task detail panel, where this is not possible
    this._taskService.focusTaskIfPossible(pid);
  }
}
