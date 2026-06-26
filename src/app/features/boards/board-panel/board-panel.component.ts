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
  BoardDateTimeframeCfg,
  BoardPanelCfg,
  BoardPanelCfgDeadlineState,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import {
  buildComparator,
  firstSpecificProjectId,
  isAllProjects,
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
import { moveItemInArray } from '../../../util/move-item-in-array';
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
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import {
  adjustDateToBoardTimeframe,
  matchesBoardDateTimeframe,
} from '../board-date-filter.util';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DialogDeadlineComponent } from '../../tasks/dialog-deadline/dialog-deadline.component';
import { SnackService } from '../../../core/snack/snack.service';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { truncate } from '../../../util/truncate';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getDeadlineAutoPlanFields } from '../../tasks/util/get-deadline-auto-plan-fields';

const ALL_TIMEFRAME: BoardDateTimeframeCfg = { type: 'all' };

const getTaskScheduledDateStr = (
  task: TaskCopy,
  startOfNextDayDiffMs: number,
): string | null => {
  if (task.dueWithTime) {
    return getDbDateStr(new Date(task.dueWithTime - startOfNextDayDiffMs));
  }
  return task.dueDay || null;
};

const getTaskDeadlineDateStr = (
  task: TaskCopy,
  startOfNextDayDiffMs: number,
): string | null => {
  if (task.deadlineWithTime) {
    return getDbDateStr(new Date(task.deadlineWithTime - startOfNextDayDiffMs));
  }
  return task.deadlineDay || null;
};

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
  providers: [LocaleDatePipe],
})
export class BoardPanelComponent {
  T = T;
  dragDelayForTouch = dragDelayForTouch;

  panelCfg = input.required<BoardPanelCfg>();
  editBoard = output<void>();

  store = inject(Store);
  taskService = inject(TaskService);
  _matDialog = inject(MatDialog);
  private _snackService = inject(SnackService);
  private _localeDatePipe = inject(LocaleDatePipe);
  private _translateService = inject(TranslateService);

  allTasks$ = this.store.select(selectAllTasksInActiveProjects);
  allTasks = toSignal(this.allTasks$, {
    initialValue: [],
  });

  // Use selectUnarchivedProjects (not selectUnarchivedVisibleProjects) to include
  // hidden projects and INBOX, ensuring backlog filtering works for all tasks
  allProjects$ = this.store.select(selectUnarchivedProjects);
  allProjects = toSignal(this.allProjects$, {
    initialValue: [],
  });

  todayStr = toSignal(this.store.select(selectTodayStr), {
    initialValue: '',
  });

  startOfNextDayDiffMs = toSignal(this.store.select(selectStartOfNextDayDiffMs), {
    initialValue: 0,
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
    const todayStr = this.todayStr();
    const startOfNextDayDiffMs = this.startOfNextDayDiffMs();
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

      if (
        panelCfg.projectIds &&
        panelCfg.projectIds.length > 0 &&
        !isAllProjects(panelCfg.projectIds)
      ) {
        // TODO check parentId case thoroughly
        isTaskIncluded = isTaskIncluded && panelCfg.projectIds.includes(task.projectId);
      }

      if (panelCfg.scheduledState === BoardPanelCfgScheduledState.Scheduled) {
        isTaskIncluded = isTaskIncluded && !!(task.dueWithTime || task.dueDay);
        if (isTaskIncluded && panelCfg.scheduledTimeframe) {
          isTaskIncluded = matchesBoardDateTimeframe({
            timeframe: panelCfg.scheduledTimeframe,
            dateOnly: task.dueDay,
            timestamp: task.dueWithTime,
            todayStr,
            startOfNextDayDiffMs,
          });
        }
      }

      if (panelCfg.scheduledState === BoardPanelCfgScheduledState.NotScheduled) {
        isTaskIncluded = isTaskIncluded && !task.dueWithTime && !task.dueDay;
      }

      if (panelCfg.deadlineState === BoardPanelCfgDeadlineState.HasDeadline) {
        isTaskIncluded = isTaskIncluded && !!(task.deadlineWithTime || task.deadlineDay);
        if (isTaskIncluded && panelCfg.deadlineTimeframe) {
          isTaskIncluded = matchesBoardDateTimeframe({
            timeframe: panelCfg.deadlineTimeframe,
            dateOnly: task.deadlineDay,
            timestamp: task.deadlineWithTime,
            todayStr,
            startOfNextDayDiffMs,
          });
        }
      }

      if (panelCfg.deadlineState === BoardPanelCfgDeadlineState.NoDeadline) {
        isTaskIncluded = isTaskIncluded && !task.deadlineWithTime && !task.deadlineDay;
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

      this.store.dispatch(
        TaskSharedActions.moveToOtherProject({
          task: taskWithSubTasks,
          targetProjectId: firstProjectId,
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

    await this._checkToScheduledTask(panelCfg, task.id);
    await this._checkDeadlineState(panelCfg, task.id);
    await this._checkBacklogState(panelCfg, task.id);
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

    await this._checkToScheduledTask(panelCfg, taskId);
    await this._checkDeadlineState(panelCfg, taskId);
    await this._checkBacklogState(panelCfg, taskId);
  }

  scheduleTask(task: TaskCopy, ev?: MouseEvent): void {
    ev?.preventDefault();
    ev?.stopPropagation();
    this._matDialog.open(DialogScheduleTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  editDeadline(task: TaskCopy, ev?: MouseEvent): void {
    ev?.preventDefault();
    ev?.stopPropagation();
    this._matDialog.open(DialogDeadlineComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  private async _checkToScheduledTask(
    panelCfg: BoardPanelCfg,
    taskId: string,
  ): Promise<void> {
    if (panelCfg.scheduledState === BoardPanelCfgScheduledState.All) {
      return;
    }
    const task = await this.store
      .select(selectTaskById, { id: taskId })
      .pipe(first())
      .toPromise();
    if (!task) {
      return;
    }

    if (panelCfg.scheduledState === BoardPanelCfgScheduledState.Scheduled) {
      const currentVal = getTaskScheduledDateStr(task, this.startOfNextDayDiffMs());
      const timeframe = panelCfg.scheduledTimeframe || ALL_TIMEFRAME;
      if (timeframe.type === 'all') {
        if (!currentVal) {
          this.scheduleTask(task);
        }
        return;
      }

      const closestDate = adjustDateToBoardTimeframe({
        timeframe,
        currentDate: currentVal,
        todayStr: this.todayStr(),
      });
      if (closestDate && closestDate !== currentVal) {
        this._showDateChangeSnack(task, closestDate);
        this.store.dispatch(
          PlannerActions.planTaskForDay({
            task,
            day: closestDate,
          }),
        );
      }
    }
    if (panelCfg.scheduledState === BoardPanelCfgScheduledState.NotScheduled) {
      if (task.dueDay || task.dueWithTime) {
        this.store.dispatch(
          TaskSharedActions.unscheduleTask({
            id: taskId,
            isSkipToast: false,
          }),
        );
      }
    }
  }

  private async _checkDeadlineState(
    panelCfg: BoardPanelCfg,
    taskId: string,
  ): Promise<void> {
    if (
      !panelCfg.deadlineState ||
      panelCfg.deadlineState === BoardPanelCfgDeadlineState.All
    ) {
      return;
    }

    const task = await this.store
      .select(selectTaskById, { id: taskId })
      .pipe(first())
      .toPromise();
    if (!task) {
      return;
    }

    const todayStr = this.todayStr();
    const startOfNextDayDiffMs = this.startOfNextDayDiffMs();
    const currentVal = getTaskDeadlineDateStr(task, startOfNextDayDiffMs);

    if (panelCfg.deadlineState === BoardPanelCfgDeadlineState.HasDeadline) {
      const timeframe = panelCfg.deadlineTimeframe || ALL_TIMEFRAME;
      if (timeframe.type === 'all') {
        if (!currentVal) {
          this.editDeadline(task);
        }
        return;
      }

      const closestDate = adjustDateToBoardTimeframe({
        timeframe,
        currentDate: currentVal,
        todayStr,
      });
      if (closestDate && closestDate !== currentVal) {
        this._showDateChangeSnack(task, closestDate, true);
        this.store.dispatch(
          TaskSharedActions.setDeadline({
            taskId: task.id,
            deadlineDay: closestDate,
            ...getDeadlineAutoPlanFields(
              {
                todayStr: () => todayStr,
                getStartOfNextDayDiffMs: () => startOfNextDayDiffMs,
              },
              closestDate,
            ),
            isSkipToast: true,
          }),
        );
      }
    } else if (panelCfg.deadlineState === BoardPanelCfgDeadlineState.NoDeadline) {
      if (currentVal) {
        this.store.dispatch(TaskSharedActions.removeDeadline({ taskId }));
      }
    }
  }

  private _showDateChangeSnack(
    task: TaskCopy,
    newDate: string,
    isDeadline: boolean = false,
  ): void {
    const formattedDate =
      newDate === this.todayStr()
        ? this._translateService.instant(T.G.TODAY_TAG_TITLE)
        : (this._localeDatePipe.transform(newDate, 'shortDate') as string);

    this._snackService.open({
      type: 'SUCCESS',
      msg: isDeadline ? T.F.TASK.S.DEADLINE_ADJUSTED : T.F.TASK.S.SCHEDULED_DATE_ADJUSTED,
      translateParams: {
        title: truncate(task.title, 20),
        date: formattedDate,
      },
    });
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
