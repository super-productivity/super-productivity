import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { PlannerTaskComponent } from '../../planner/planner-task/planner-task.component';
import {
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import { buildComparator } from '../boards.util';
import { select, Store } from '@ngrx/store';
import {
  selectAllTasksWithoutHiddenProjects,
  selectTaskById,
  selectTaskByIdWithSubTaskData,
} from '../../tasks/store/task.selectors';
import { toSignal } from '@angular/core/rxjs-interop';
import { AddTaskInlineComponent } from '../../planner/add-task-inline/add-task-inline.component';
import { T } from '../../../t.const';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { BoardsActions } from '../store/boards.actions';
import { moveItemInArray } from '../../../util/move-item-in-array';
import { unique } from '../../../util/unique';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { LocalDateStrPipe } from '../../../ui/pipes/local-date-str.pipe';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
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
})
export class BoardPanelComponent {
  T = T;
  dragDelayForTouch = dragDelayForTouch;

  panelCfg = input.required<BoardPanelCfg>();
  editBoard = output<void>();

  store = inject(Store);
  taskService = inject(TaskService);
  _matDialog = inject(MatDialog);

  allTasks$ = this.store.select(selectAllTasksWithoutHiddenProjects);
  allTasks = toSignal(this.allTasks$, {
    initialValue: [],
  });

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

    return {
      ...(tagsToAdd.length ? { tagIds: tagsToAdd } : {}),
      ...(panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.Done
        ? { isDone: true }
        : {}),
      ...(panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.UnDone
        ? { isDone: false }
        : {}),
      ...(panelCfg.projectId && panelCfg.projectId.length
        ? { projectId: panelCfg.projectId }
        : {}),
      // TODO scheduledState
    };
  });

  tasks = computed(() => {
    const panelCfg = this.panelCfg();
    const orderedTasks: TaskCopy[] = [];
    const nonOrderedTasks: TaskCopy[] = [];

    const allFilteredTasks = this.allTasks().filter((task) => {
      let isTaskIncluded = true;
      const taskTagIds = task.tagIds ?? [];
      if (panelCfg.includedTagIds?.length) {
        isTaskIncluded =
          panelCfg.includedTagsMatch === 'any'
            ? panelCfg.includedTagIds.some((tagId) => taskTagIds.includes(tagId))
            : panelCfg.includedTagIds.every((tagId) => taskTagIds.includes(tagId));
      }
      if (panelCfg.excludedTagIds?.length) {
        const hit =
          panelCfg.excludedTagsMatch === 'all'
            ? panelCfg.excludedTagIds.every((tagId) => taskTagIds.includes(tagId))
            : panelCfg.excludedTagIds.some((tagId) => taskTagIds.includes(tagId));
        isTaskIncluded = isTaskIncluded && !hit;
      }

      if (panelCfg.isParentTasksOnly) {
        isTaskIncluded = isTaskIncluded && !task.parentId;
      }

      if (panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.Done) {
        isTaskIncluded = isTaskIncluded && task.isDone;
      }

      if (panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.UnDone) {
        isTaskIncluded = isTaskIncluded && !task.isDone;
      }

      if (panelCfg.projectId) {
        // TODO check parentId case thoroughly
        isTaskIncluded = isTaskIncluded && task.projectId === panelCfg.projectId;
      }

      if (panelCfg.scheduledState === BoardPanelCfgScheduledState.Scheduled) {
        isTaskIncluded = isTaskIncluded && !!(task.dueWithTime || task.dueDay);
      }

      if (panelCfg.scheduledState === BoardPanelCfgScheduledState.NotScheduled) {
        isTaskIncluded = isTaskIncluded && !task.dueWithTime && !task.dueDay;
      }

      if (panelCfg.backlogState === BoardPanelCfgTaskTypeFilter.OnlyBacklog) {
        isTaskIncluded = isTaskIncluded && this._isTaskInBacklog(task);
      }

      if (panelCfg.backlogState === BoardPanelCfgTaskTypeFilter.NoBacklog) {
        isTaskIncluded = isTaskIncluded && !this._isTaskInBacklog(task);
      }

      return isTaskIncluded;
    });

    allFilteredTasks.forEach((task) => {
      const index = panelCfg.taskIds.indexOf(task.id);
      if (index > -1) {
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

  async drop(ev: CdkDragDrop<BoardPanelCfg, string, TaskCopy>): Promise<void> {
    const panelCfg = ev.container.data;
    const task = ev.item.data;

    // In sorted mode, intra-panel drops are no-ops: the task already matches the
    // panel filter and the visible order is derived from the comparator, not taskIds.
    if (ev.previousContainer.id === ev.container.id && !this.isManualOrder()) {
      return;
    }

    const prevTaskIds = this.tasks().map((t) => t.id);

    const taskIds = prevTaskIds.includes(task.id)
      ? // move in array
        moveItemInArray(prevTaskIds, ev.previousIndex, ev.currentIndex)
      : // NOTE: original array is mutated and splice does not return a new array
        prevTaskIds.splice(ev.currentIndex, 0, task.id) && prevTaskIds;

    let newTagIds: string[] = task.tagIds || [];
    if (panelCfg.includedTagIds?.length) {
      if (panelCfg.includedTagsMatch === 'any') {
        // OR: task only needs one required tag to belong. Add the first if none match.
        const hasAny = panelCfg.includedTagIds.some((id) => newTagIds.includes(id));
        if (!hasAny) {
          newTagIds = newTagIds.concat(panelCfg.includedTagIds[0]);
        }
      } else {
        newTagIds = newTagIds.concat(panelCfg.includedTagIds);
      }
    }
    if (panelCfg.excludedTagIds?.length) {
      if (panelCfg.excludedTagsMatch === 'all') {
        // AND-excluded: "exclude only if task has ALL excluded tags". Strip one to
        // break the condition; don't over-remove tags the user may legitimately want.
        const hasAll = panelCfg.excludedTagIds.every((id) => newTagIds.includes(id));
        if (hasAll) {
          newTagIds = newTagIds.filter((id) => id !== panelCfg.excludedTagIds![0]);
        }
      } else {
        newTagIds = newTagIds.filter(
          (tagId) => !panelCfg.excludedTagIds!.includes(tagId),
        );
      }
    }

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

    if (panelCfg.projectId?.length && task.projectId !== panelCfg.projectId) {
      const taskWithSubTasks = await this.store
        .pipe(
          select(selectTaskByIdWithSubTaskData, { id: task.parentId || task.id }),
          take(1),
        )
        .toPromise();

      this.store.dispatch(
        TaskSharedActions.moveToOtherProject({
          task: taskWithSubTasks,
          targetProjectId: panelCfg.projectId,
        }),
      );
    }

    if (Object.keys(updates).length > 0) {
      this.store.dispatch(
        TaskSharedActions.updateTask({ task: { id: task.id, changes: updates } }),
      );
    }

    this.store.dispatch(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: panelCfg.id,
        taskIds,
      }),
    );

    this._checkToScheduledTask(panelCfg, task.id);
    this._checkBacklogState(panelCfg, task.id);
  }

  async afterTaskAdd({
    taskId,
    isAddToBottom,
  }: {
    taskId: string;
    isAddToBottom: boolean;
  }): Promise<void> {
    const panelCfg = this.panelCfg();
    this.store.dispatch(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: panelCfg.id,
        taskIds: isAddToBottom
          ? [...panelCfg.taskIds, taskId]
          : [taskId, ...panelCfg.taskIds],
      }),
    );

    this._checkToScheduledTask(panelCfg, taskId);
    this._checkBacklogState(panelCfg, taskId);
  }

  scheduleTask(task: TaskCopy, ev?: MouseEvent): void {
    ev?.preventDefault();
    ev?.stopPropagation();
    this._matDialog.open(DialogScheduleTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  private async _checkToScheduledTask(
    panelCfg: BoardPanelCfg,
    taskId: string,
  ): Promise<void> {
    if (panelCfg.scheduledState === BoardPanelCfgScheduledState.Scheduled) {
      const task = await this.store
        .select(selectTaskById, { id: taskId })
        .pipe(first())
        .toPromise();
      if (!task.dueDay && !task.dueWithTime) {
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
