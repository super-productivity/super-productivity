import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
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
import { CdkDrag, CdkDragDrop, CdkDragStart, CdkDropList } from '@angular/cdk/drag-drop';
import { WorkContextType } from '../../work-context/work-context.model';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { getAnchorFromDragDrop } from '../../work-context/store/work-context-meta.helper';
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
  }

  enterPredicate = (drag: CdkDrag, drop: CdkDropList): boolean => {
    // TODO this gets called very often for nested lists. Maybe there are possibilities to optimize
    const task = drag.data;
    const targetModelId = drop.data.listModelId;
    const isSubtask = !!task.parentId;

    if (targetModelId === 'OVERDUE' || targetModelId === 'LATER_TODAY') {
      return false;
    }

    if (isSubtask) {
      const isToTopLevelList = targetModelId === 'DONE' || targetModelId === 'UNDONE';

      if (isToTopLevelList) {
        // Check if subtask is appearing as a top-level item in the target list
        // by checking if its parent is NOT in the target list's tasks
        const targetTasks: TaskWithSubTasks[] = drop.data.allTasks || [];
        const parentInTargetList = targetTasks.some((t) => t.id === task.parentId);

        // If parent is NOT in the target list, subtask appears as top-level, allow move
        if (!parentInTargetList) {
          return true;
        }
        // Parent is in the list, so this subtask should stay nested under parent
        return false;
      }

      // Subtasks can move within subtask lists (where listModelId is a task ID)
      if (!PARENT_ALLOWED_LISTS.includes(targetModelId)) {
        return true;
      }
      return false;
    }

    // Parent tasks: allow drops to PARENT_ALLOWED_LISTS
    if (PARENT_ALLOWED_LISTS.includes(targetModelId)) {
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

    const targetTask = targetListData.filteredTasks[ev.currentIndex] as TaskCopy;

    if ('issueData' in draggedTask) {
      return this._addFromIssuePanel(draggedTask, srcListData as string);
    } else if (typeof srcListData === 'string') {
      throw new Error('Should not happen 2');
    }

    if (targetTask && targetTask.id === draggedTask.id) {
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
    TaskLog.log(srcListData.listModelId, '=>', targetListData.listModelId, {
      targetTask,
      draggedTask,
      newIds,
    });

    this.dropListService.blockAniTrigger$.next();
    this._move(
      draggedTask.id,
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
      this._store.dispatch(TaskSharedActions.planTasksForToday({ taskIds: [taskId] }));
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
