import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  HostBinding,
  inject,
  input,
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
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragMove,
  CdkDragStart,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { WorkContextType } from '../../work-context/work-context.model';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import {
  moveProjectTaskInBacklogList,
  moveProjectTaskToBacklogList,
  moveProjectTaskToRegularList,
} from '../../project/store/project.actions';
import { moveSubTask } from '../store/task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextService } from '../../work-context/work-context.service';
import { Store } from '@ngrx/store';
import { moveItemBeforeItem } from '../../../util/move-item-before-item';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { IssueService } from '../../issue/issue.service';
import { SearchResultItem } from '../../issue/issue.model';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TaskComponent } from '../task/task.component';
import { AsyncPipe } from '@angular/common';
import { TaskViewCustomizerService } from '../../task-view-customizer/task-view-customizer.service';
import { TaskLog } from '../../../core/log';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { DEFAULT_OPTIONS } from '../../task-view-customizer/types';
import { TaskDragDropService } from '../task-drag-drop.service';
import { throttle } from '../../../util/decorators';

export type TaskListId = 'PARENT' | 'SUB';
export type ListModelId = DropListModelSource | string;
const PARENT_ALLOWED_LISTS = ['DONE', 'UNDONE', 'OVERDUE', 'BACKLOG', 'ADD_TASK_PANEL'];

export interface DropModelDataForList {
  listModelId: ListModelId;
  allTasks: TaskWithSubTasks[];
  filteredTasks: TaskWithSubTasks[];
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
    forwardRef(() => TaskComponent),
  ],
})
export class TaskListComponent implements OnDestroy, AfterViewInit {
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _store = inject(Store);
  private _issueService = inject(IssueService);
  private _taskViewCustomizerService = inject(TaskViewCustomizerService);
  private _scheduleExternalDragService = inject(ScheduleExternalDragService);
  private _taskDragDropService = inject(TaskDragDropService);
  dropListService = inject(DropListService);

  tasks = input<TaskWithSubTasks[]>([]);
  isHideDone = input(false);
  isHideAll = input(false);
  isSortingDisabled = input(false);

  listId = input.required<TaskListId>();
  listModelId = input.required<ListModelId>();
  parentId = input<string | undefined>(undefined);

  noTasksMsg = input<string | undefined>(undefined);
  isBacklog = input(false);
  isSubTaskList = input(false);

  currentTaskId = toSignal(this._taskService.currentTaskId$);
  dropModelDataForList = computed<DropModelDataForList>(() => {
    return {
      listModelId: this.listModelId(),
      allTasks: this.tasks(),
      filteredTasks: this.filteredTasks(),
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

  @HostBinding('class.isSubTaskList') get isSubTaskListClass(): boolean {
    return this.isSubTaskList();
  }

  T: typeof T = T;

  ngAfterViewInit(): void {
    this.dropListService.registerDropList(this.dropList()!, this.listId() === 'SUB');
  }

  ngOnDestroy(): void {
    this.dropListService.unregisterDropList(this.dropList()!);
    this._scheduleExternalDragService.setActiveTask(null);
  }

  trackByFn(i: number, task: Task): string {
    return task.id;
  }

  onDragStarted(task: TaskWithSubTasks, event: CdkDragStart): void {
    this._scheduleExternalDragService.setActiveTask(task, event.source._dragRef);
  }

  onDragEnded(): void {
    this._scheduleExternalDragService.setActiveTask(null);
    this.dropListService.setPromotionMode(false);
  }

  @throttle(100)
  onDragMoved(event: CdkDragMove<TaskWithSubTasks>, task: TaskWithSubTasks): void {
    if (task.parentId) {
      const subLists = this.dropListService.getSubLists();
      const { x, y } = event.pointerPosition;

      const isOverSubList = subLists.some((list) => {
        const rect = list.element.nativeElement.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      });

      if (isOverSubList) {
        this.dropListService.setPromotionMode(false);
      } else {
        this.dropListService.setPromotionMode(true);
      }
    }
  }

  enterPredicate = (drag: CdkDrag, drop: CdkDropList): boolean => {
    const isPromotionMode = this.dropListService.isPromotionMode$.getValue();
    if (isPromotionMode && this.listId() === 'SUB') {
      return false;
    }

    const task = drag.data;
    const sourceData = drag.dropContainer?.data;
    const targetData = drop.data;

    // Safety check
    if (!sourceData || !targetData) {
      return false;
    }

    const sourceModelId = sourceData.listModelId;
    const targetModelId = targetData.listModelId;
    const isSubtask = !!task.parentId;

    // Block OVERDUE and LATER_TODAY
    if (targetModelId === 'OVERDUE' || targetModelId === 'LATER_TODAY') {
      return false;
    }

    // KEY LOGIC: If dragging a subtask FROM its own subtask list
    if (isSubtask && sourceModelId === task.parentId) {
      // If Shift is pressed, allow promotion to parent lists
      if (isPromotionMode && PARENT_ALLOWED_LISTS.includes(targetModelId as string)) {
        return true;
      }

      // Otherwise, only allow dropping in same parent (reordering)
      const allowDrop = targetModelId === task.parentId;

      return allowDrop;
    }

    // For subtask lists: allow subtasks
    if (this.listId() === 'SUB') {
      return isSubtask;
    }

    // For parent lists: allow all tasks
    if (PARENT_ALLOWED_LISTS.includes(targetModelId as string)) {
      return true;
    }

    return false;
  };

  async drop(
    srcFilteredTasks: TaskWithSubTasks[],
    ev: CdkDragDrop<
      DropModelDataForList,
      DropModelDataForList | string,
      TaskWithSubTasks | SearchResultItem
    >,
  ): Promise<void> {
    const srcListData = ev.previousContainer.data;
    const targetListData = ev.container.data;
    const draggedTask = ev.item.data;

    // Safety check
    if (!srcListData || !targetListData) {
      return;
    }

    TaskLog.log({
      ev,
      srcListData,
      targetListData,
      draggedTask,
      listId: this.listId(),
      listModelId: this.listModelId(),
      filteredTasks: this.filteredTasks(),
    });

    if (this._scheduleExternalDragService.isCancelNextDrop()) {
      this._scheduleExternalDragService.setCancelNextDrop(false);
      return;
    }

    let targetTask = targetListData.filteredTasks[ev.currentIndex] as TaskCopy;
    const isDropAtEnd =
      ev.currentIndex > 0 && ev.currentIndex === targetListData.filteredTasks.length;

    if (!targetTask && isDropAtEnd) {
      // dropped at the end of the list. Let's use the last item as the target
      targetTask = targetListData.filteredTasks[ev.currentIndex - 1] as TaskCopy;
    }

    if ('issueData' in draggedTask) {
      return this._addFromIssuePanel(draggedTask, srcListData as string);
    } else if (typeof srcListData === 'string') {
      throw new Error('Should not happen 2');
    }

    // NOTE: draggedTask is now guaranteed to be a Task
    if (targetTask && targetTask.id === draggedTask.id) {
      targetTask = targetListData.filteredTasks[ev.currentIndex - 1] as TaskCopy;
    }

    if (!targetTask || (targetTask && targetTask.id === draggedTask.id)) {
      return;
    }

    // At this point draggedTask is a TaskWithSubTasks (not SearchResultItem)
    const task = draggedTask as TaskWithSubTasks;

    // Detect drop zone: top, bottom-left (reorder), or bottom-right (convert to subtask)
    const dropZoneType = this._getDropZoneType(ev);

    // If drop is bottom-right AND target is valid, convert to subtask
    if (
      dropZoneType === 'bottom-right' &&
      targetTask &&
      this.canDropOnTask(task, targetTask as TaskWithSubTasks) &&
      !this._isTaskAncestorOf(task.id, targetTask.id)
    ) {
      this.dropListService.blockAniTrigger$.next();
      this._taskDragDropService.makeSubtask(task.id, targetTask.id);
      this._taskViewCustomizerService.setSort(DEFAULT_OPTIONS.sort);

      return;
    }

    // Otherwise, proceed with normal reordering (top or bottom-left)
    const newIds =
      targetTask && targetTask.id !== task.id
        ? (() => {
            const currentDraggedIndex = targetListData.filteredTasks.findIndex(
              (t) => t.id === task.id,
            );

            if (currentDraggedIndex === -1) {
              const newTasks = [...targetListData.filteredTasks, task];
              newTasks.splice(ev.currentIndex, 0, task);
              return newTasks;
            }

            const currentTargetIndex = targetListData.filteredTasks.findIndex(
              (t) => t.id === targetTask.id,
            );

            // If dragging from a different list or new item, use target index
            const isDraggingDown =
              currentDraggedIndex !== -1 && currentDraggedIndex < currentTargetIndex;

            const isPlaceAfter = isDraggingDown || dropZoneType !== 'top' || isDropAtEnd;

            if (isPlaceAfter) {
              // When dragging down, or dropping on bottom half, place AFTER the target item
              const filtered = targetListData.filteredTasks.filter(
                (t) => t.id !== task.id,
              );
              const targetIndexInFiltered = filtered.findIndex(
                (t) => t.id === targetTask.id,
              );
              const result = [...filtered];
              result.splice(targetIndexInFiltered + 1, 0, task);
              return result;
            } else {
              // When dragging up or from another list, place BEFORE the target item
              return [
                ...moveItemBeforeItem(
                  targetListData.filteredTasks,
                  task,
                  targetTask as TaskWithSubTasks,
                ),
              ];
            }
          })()
        : [...targetListData.filteredTasks.filter((t) => t.id !== task.id), task];
    TaskLog.log(srcListData.listModelId, '=>', targetListData.listModelId, {
      targetTask,
      task,
      newIds,
    });

    // special handling for promotions
    const isSrcParentList = PARENT_ALLOWED_LISTS.includes(
      srcListData.listModelId as string,
    );
    const isTargetParentList = PARENT_ALLOWED_LISTS.includes(
      targetListData.listModelId as string,
    );
    if (!isSrcParentList && isTargetParentList) {
      const oldParentId = srcListData.listModelId as string;
      const newSubTaskIds = (srcListData as DropModelDataForList).allTasks
        .filter((t) => t.id !== task.id)
        .map((t) => t.id);
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: { id: oldParentId, changes: { subTaskIds: newSubTaskIds } },
        }),
      );
    }

    // handle promotion via gesture
    if (
      dropZoneType === 'bottom-left' &&
      task.parentId &&
      targetTask.id === task.parentId
    ) {
      const parentTask = targetTask as TaskWithSubTasks;
      const newSubTaskIds = parentTask.subTaskIds.filter((id) => id !== task.id);
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: { id: parentTask.id, changes: { subTaskIds: newSubTaskIds } },
        }),
      );
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: { id: task.id, changes: { parentId: undefined } },
        }),
      );
      this._store.dispatch(TaskSharedActions.planTasksForToday({ taskIds: [task.id] }));
      return;
    }

    this.dropListService.blockAniTrigger$.next();
    this._move(
      task.id,
      srcListData.listModelId,
      targetListData.listModelId,
      newIds.map((p) => p.id),
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

  private _getDropZoneType(
    event: CdkDragDrop<
      DropModelDataForList,
      DropModelDataForList | string,
      TaskWithSubTasks | SearchResultItem
    >,
  ): 'top' | 'bottom-left' | 'bottom-right' {
    const sortedItems = event.container.getSortedItems();
    const targetDragItem = sortedItems[event.currentIndex];

    if (!targetDragItem) {
      // Fallback for drops at the end of the list, though less precise
      const dropElement = event.container.element.nativeElement;
      const rect = dropElement.getBoundingClientRect();
      const dropPointY = event.dropPoint.y;
      const relativeY = dropPointY - rect.top;
      const topThreshold = rect.height * 0.5;
      return relativeY < topThreshold ? 'top' : 'bottom-left';
    }

    const dropElement = targetDragItem.element.nativeElement;
    const rect = dropElement.getBoundingClientRect();

    // Use dropPoint which is the actual drop position from CDK
    const dropPointX = event.dropPoint.x;
    const dropPointY = event.dropPoint.y;

    // Calculate relative position within the drop element
    const relativeY = dropPointY - rect.top;
    const relativeX = dropPointX - rect.left;

    const elementHeight = rect.height;
    const elementWidth = rect.width;

    // Threshold: 50% from top is "top", rest is "bottom"
    const topThreshold = elementHeight * 0.5;
    const rightThreshold = elementWidth * 0.66;

    const zone =
      relativeY < topThreshold
        ? 'top'
        : relativeX < rightThreshold
          ? 'bottom-left'
          : 'bottom-right';

    return zone;
  }

  private _move(
    taskId: string,
    src: DropListModelSource | string,
    target: DropListModelSource | string,
    newOrderedIds: string[],
  ): void {
    const isSrcRegularList = src === 'DONE' || src === 'UNDONE';
    const isTargetRegularList = target === 'DONE' || target === 'UNDONE';
    const workContextId = this._workContextService.activeWorkContextId as string;

    // Handle LATER_TODAY - prevent any moves to or from this list
    if (src === 'LATER_TODAY' || target === 'LATER_TODAY') {
      return;
    }

    if (isSrcRegularList && isTargetRegularList) {
      // move inside today
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;
      this._store.dispatch(
        moveTaskInTodayList({
          taskId,
          newOrderedIds,
          src,
          target,
          workContextId,
          workContextType,
        }),
      );
    } else if (target === 'OVERDUE') {
      return;
    } else if (src === 'OVERDUE' && (target === 'UNDONE' || target === 'DONE')) {
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;
      this._store.dispatch(TaskSharedActions.planTasksForToday({ taskIds: [taskId] }));
      this._store.dispatch(
        moveTaskInTodayList({
          taskId,
          newOrderedIds,
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
      this._store.dispatch(
        moveProjectTaskInBacklogList({ taskId, newOrderedIds, workContextId }),
      );
    } else if (src === 'BACKLOG' && isTargetRegularList) {
      // move from backlog to today
      this._store.dispatch(
        moveProjectTaskToRegularList({
          taskId,
          newOrderedIds,
          src,
          target,
          workContextId,
        }),
      );
    } else if (isSrcRegularList && target === 'BACKLOG') {
      // move from today to backlog
      this._store.dispatch(
        moveProjectTaskToBacklogList({ taskId, newOrderedIds, workContextId }),
      );
    } else if (!isSrcRegularList && isTargetRegularList) {
      // sub task to main list
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: { id: taskId, changes: { parentId: undefined } },
        }),
      );
      const workContextType = this._workContextService
        .activeWorkContextType as WorkContextType;
      this._store.dispatch(
        moveTaskInTodayList({
          taskId,
          newOrderedIds,
          src: src as any,
          target: target,
          workContextId,
          workContextType,
        }),
      );
    } else if (!isSrcRegularList && !isTargetRegularList) {
      // move sub task
      this._store.dispatch(
        moveSubTask({ taskId, srcTaskId: src, targetTaskId: target, newOrderedIds }),
      );
    }
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

  canDropOnTask(draggedTask: TaskWithSubTasks, targetTask: TaskWithSubTasks): boolean {
    if (draggedTask.id === targetTask.id) {
      return false;
    }

    if (this._isTaskAncestorOf(draggedTask.id, targetTask.id)) {
      return false;
    }

    if (draggedTask.parentId === targetTask.id) {
      return false;
    }

    return targetTask.projectId === draggedTask.projectId;
  }

  private _isTaskAncestorOf(potentialAncestorId: string, taskId: string): boolean {
    const allTasks = this.tasks();
    let currentTask = allTasks.find((t) => t.id === taskId);

    while (currentTask?.parentId) {
      if (currentTask.parentId === potentialAncestorId) {
        return true;
      }
      currentTask = allTasks.find((t) => t.id === currentTask?.parentId);
    }

    return false;
  }
}
