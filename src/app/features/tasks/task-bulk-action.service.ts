import { computed, inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';
import { TaskService } from './task.service';
import { TaskMultiSelectService } from './task-multi-select.service';
import { TaskMoveToProjectService } from './task-move-to-project.service';
import { ProjectService } from '../project/project.service';
import { SnackService } from '../../core/snack/snack.service';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../config/global-config.service';
import { WorkContextService } from '../work-context/work-context.service';
import { Task, TaskReminderOptionId, TaskWithSubTasks } from './task.model';
import {
  selectTaskEntities,
  selectTaskByIdWithSubTaskData,
} from './store/task.selectors';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { DialogScheduleTaskComponent } from '../planner/dialog-schedule-task/dialog-schedule-task.component';
import { DialogDeadlineComponent } from './dialog-deadline/dialog-deadline.component';
import { T } from '../../t.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { getDateTimeFromClockString } from '../../util/get-date-time-from-clock-string';
import { isValidSplitTime } from '../../util/is-valid-split-time';
import { combineDateAndTime } from '../../util/combine-date-and-time';
import { truncate } from '../../util/truncate';
import { remindOptionToMilliseconds } from './util/remind-option-to-milliseconds';
import { getDeadlineAutoPlanFields } from './util/get-deadline-auto-plan-fields';
import { playDoneSound } from './util/play-done-sound';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { getPluralKey } from '../../util/get-plural-key';
import {
  dedupeByRepeatCfg,
  dedupeSubtasksOfSelectedParents,
  orderForMarkDone,
  resolveDoneIntent,
  resolveTagIntent,
  splitParentOnly,
} from './task-bulk-action.util';
import { isTouchActive } from '../../util/input-intent';

interface DateTimePick {
  date: Date | null;
  time: string | null;
  remindOption: TaskReminderOptionId | null;
}

/**
 * Applies one action to every task in the multi-selection.
 *
 * Every bulk action is a loop of the normal per-task actions followed by the
 * Rule #6 macrotask flush (ARCHITECTURE-DECISIONS #5): N independent ops, N
 * independent conflict units, all existing effects and meta-reducers fire.
 * The only things this layer adds are ordering, dedupe, eligibility, focus
 * restoration and *one* summary snack instead of N (see isFeedbackSuppressed).
 */
@Injectable({
  providedIn: 'root',
})
export class TaskBulkActionService {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _multiSelect = inject(TaskMultiSelectService);
  private readonly _moveToProjectService = inject(TaskMoveToProjectService);
  private readonly _projectService = inject(ProjectService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _dateService = inject(DateService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _translateService = inject(TranslateService);
  private readonly _translateStore = inject(TranslateStore);

  private readonly _taskEntities = this._store.selectSignal(selectTaskEntities);

  /** See TaskMultiSelectService.isBulkFeedbackSuppressed. */
  readonly isFeedbackSuppressed = this._multiSelect.isBulkFeedbackSuppressed;

  /** The selected tasks resolved against the store, in visual order. */
  readonly selectedTasks = computed<Task[]>(() => {
    const entities = this._taskEntities();
    const ids = this._multiSelect.selectedIds();
    const tasks: Task[] = [];
    ids.forEach((id) => {
      const task = entities[id];
      if (task) {
        tasks.push(task);
      }
    });
    return tasks;
  });

  readonly hasUndone = computed(() => this.selectedTasks().some((t) => !t.isDone));
  readonly hasParentTasks = computed(() => this.selectedTasks().some((t) => !t.parentId));
  readonly hasScheduled = computed(() =>
    this.selectedTasks().some((t) => !!t.dueDay || !!t.dueWithTime),
  );
  readonly hasDeadline = computed(() =>
    this.selectedTasks().some((t) => !!t.deadlineDay || !!t.deadlineWithTime),
  );
  readonly hasEstimatable = computed(() =>
    this.selectedTasks().some((t) => !t.subTaskIds.length),
  );

  // ---- DONE -------------------------------------------------------------

  toggleDone(): Promise<void> {
    return resolveDoneIntent(this.selectedTasks()) === 'done'
      ? this.markDone()
      : this.markUndone();
  }

  async markDone(): Promise<void> {
    const tasks = orderForMarkDone(
      this._resolveInVisualOrder().filter((t) => !t.isDone),
      this._taskService.currentTaskId(),
    );
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    await this._runSuppressed(() =>
      tasks.forEach((t) => this._taskService.setDone(t.id)),
    );
    await this._playDoneSoundOnce();
    this._snackService.open({
      type: 'SUCCESS',
      ico: 'check',
      msg: this._plural('F.TASK.MULTI_SELECT.S.DONE', tasks.length),
      translateParams: { count: tasks.length },
    });
    this._restoreFocus(focusEl);
  }

  async markUndone(): Promise<void> {
    const tasks = this._resolveInVisualOrder().filter((t) => t.isDone);
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    await this._runSuppressed(() =>
      tasks.forEach((t) => this._taskService.setUnDone(t.id)),
    );
    this._snackService.open({
      type: 'SUCCESS',
      msg: this._plural('F.TASK.MULTI_SELECT.S.UNDONE', tasks.length),
      translateParams: { count: tasks.length },
    });
    this._restoreFocus(focusEl);
  }

  // ---- DELETE -----------------------------------------------------------

  /**
   * More than one task always confirms, regardless of `isConfirmBeforeDelete`:
   * there is no undo for a bulk delete yet. A single selected task takes the
   * normal single-task path (setting + undo snack).
   *
   * Top-level tasks go through `deleteTasks` in one op. A subtask whose parent
   * survives goes through the singular `deleteTask` instead: older clients'
   * `deleteTasks` reducer would keep the dangling id in the parent's
   * subTaskIds and fail post-sync validation (rule 10 — degrade gracefully).
   */
  async deleteSelected(): Promise<void> {
    const tasks = dedupeSubtasksOfSelectedParents(this._resolveInVisualOrder());
    if (!tasks.length) {
      return;
    }
    if (tasks.length === 1) {
      await this._deleteSingle(tasks[0]);
      return;
    }
    const isConfirm = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.MULTI_SELECT.D_CONFIRM_DELETE.OK,
            message: this._plural(
              'F.TASK.MULTI_SELECT.D_CONFIRM_DELETE.MSG',
              tasks.length,
            ),
            translateParams: { count: tasks.length },
          },
        })
        .afterClosed(),
    );
    if (!isConfirm) {
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    const { eligible: topLevel, skippedSubtasks: loneSubtasks } = splitParentOnly(tasks);
    const loneSubtasksWithData = await Promise.all(
      loneSubtasks.map((t) => this._withSubTasks(t)),
    );
    await this._runSuppressed(() => {
      loneSubtasksWithData.forEach((t) => this._taskService.remove(t));
      if (topLevel.length) {
        this._taskService.removeMultipleTasks(topLevel.map((t) => t.id));
      }
    });
    this._multiSelect.clear();
    this._restoreFocus(focusEl);
  }

  private async _deleteSingle(task: Task): Promise<void> {
    const isConfirmBeforeDelete =
      this._globalConfigService.cfg()?.tasks?.isConfirmBeforeDelete ?? true;
    if (isConfirmBeforeDelete) {
      const isConfirm = await firstValueFrom(
        this._matDialog
          .open(DialogConfirmComponent, {
            data: {
              okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
              message: T.F.TASK.D_CONFIRM_DELETE.MSG,
              translateParams: { title: truncate(task.title) },
            },
          })
          .afterClosed(),
      );
      if (!isConfirm) {
        return;
      }
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    this._taskService.remove(await this._withSubTasks(task));
    this._multiSelect.clear();
    await this._flush();
    this._restoreFocus(focusEl);
  }

  // ---- PROJECT ----------------------------------------------------------

  async moveToProject(projectId: string): Promise<void> {
    const { eligible, skippedSubtasks } = splitParentOnly(
      dedupeSubtasksOfSelectedParents(this._resolveInVisualOrder()),
    );
    const tasks = dedupeByRepeatCfg(eligible.filter((t) => t.projectId !== projectId));
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    let movedCount = 0;
    this._multiSelect.setBulkFeedbackSuppressed(true);
    try {
      // Plain moves first, then one awaited (possibly confirmed) step per config.
      for (const task of tasks.filter((t) => !t.repeatCfgId)) {
        if (
          await this._moveToProjectService.moveToProject(
            await this._withSubTasks(task),
            projectId,
          )
        ) {
          movedCount++;
        }
      }
      for (const task of tasks.filter((t) => !!t.repeatCfgId)) {
        if (
          await this._moveToProjectService.moveToProject(
            await this._withSubTasks(task),
            projectId,
          )
        ) {
          movedCount++;
        }
      }
      await this._flush();
    } finally {
      this._multiSelect.setBulkFeedbackSuppressed(false);
    }
    if (skippedSubtasks.length) {
      this._snackPartial(movedCount, tasks.length + skippedSubtasks.length);
    } else if (movedCount) {
      const project = await firstValueFrom(this._projectService.getByIdOnce$(projectId));
      this._snackService.open({
        type: 'SUCCESS',
        ico: 'forward',
        msg: this._plural('F.TASK.MULTI_SELECT.S.MOVED_TO_PROJECT', movedCount),
        translateParams: { count: movedCount, projectTitle: project?.title ?? '' },
      });
    }
    this._restoreFocus(focusEl);
  }

  // ---- TAGS -------------------------------------------------------------

  /** Every selected task has the tag → remove it from all; otherwise add to all. */
  async toggleTag(tagId: string): Promise<void> {
    const tasks = this._resolveInVisualOrder();
    const intent = resolveTagIntent(tasks, tagId);
    const affected = tasks.filter((t) =>
      intent === 'add' ? !t.tagIds.includes(tagId) : t.tagIds.includes(tagId),
    );
    if (!affected.length) {
      return;
    }
    await this._runSuppressed(() =>
      affected.forEach((t) =>
        this._taskService.updateTags(
          t,
          intent === 'add' ? [...t.tagIds, tagId] : t.tagIds.filter((id) => id !== tagId),
        ),
      ),
    );
  }

  isTagOnAllSelected(tagId: string): boolean {
    return resolveTagIntent(this.selectedTasks(), tagId) === 'remove';
  }

  // ---- SCHEDULE ---------------------------------------------------------

  async openScheduleDialog(): Promise<void> {
    const tasks = this._resolveInVisualOrder().filter((t) => !t.isDone);
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    const result = await firstValueFrom(
      this._matDialog
        .open(DialogScheduleTaskComponent, {
          autoFocus: false,
          data: { isSelectDueOnly: true },
        })
        .afterClosed(),
    );
    if (!result || typeof result !== 'object' || !(result as DateTimePick).date) {
      return;
    }
    await this.scheduleFor(result as DateTimePick, tasks);
  }

  async scheduleFor(pick: DateTimePick, tasksArg?: Task[]): Promise<void> {
    const tasks = tasksArg ?? this._resolveInVisualOrder().filter((t) => !t.isDone);
    if (!pick.date || !tasks.length) {
      return;
    }
    const day = getDbDateStr(pick.date);
    const todayStr = this._dateService.todayStr();
    const hasTime = !!pick.time && isValidSplitTime(pick.time);
    const defaultRemindOption =
      this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!;
    const focusEl = this._getFocusTargetAfterRemoval();
    const todayIds: string[] = [];
    let applied = 0;
    await this._runSuppressed(() => {
      tasks.forEach((task) => {
        if (hasTime) {
          const due = getDateTimeFromClockString(pick.time as string, pick.date as Date);
          this._taskService.scheduleTask(
            task,
            due,
            pick.remindOption ?? TaskReminderOptionId.DoNotRemind,
            false,
          );
          applied++;
        } else if (
          task.dueWithTime &&
          !(day === todayStr && this._dateService.isToday(task.dueWithTime))
        ) {
          // Day-only pick for a timed task: keep its time on the new day, as
          // the context menu's quick-access buttons do.
          const due = combineDateAndTime(pick.date as Date, new Date(task.dueWithTime));
          this._taskService.scheduleTask(task, due.getTime(), defaultRemindOption, false);
          applied++;
        } else if (day === todayStr) {
          // Already due today with a time → plain "add to today" (clears the
          // reminder), matching the single-task flow.
          todayIds.push(task.id);
        } else if (task.dueDay !== day) {
          this._store.dispatch(
            PlannerActions.planTaskForDay({ task, day, isShowSnack: false }),
          );
          applied++;
        }
      });
      if (todayIds.length) {
        this._store.dispatch(
          TaskSharedActions.planTasksForToday({
            taskIds: todayIds,
            today: todayStr,
            startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
            parentTaskMap: Object.fromEntries(
              tasks.filter((t) => todayIds.includes(t.id)).map((t) => [t.id, t.parentId]),
            ),
          }),
        );
        applied += todayIds.length;
      }
    });
    if (applied) {
      this._snackApplied(applied);
    } else {
      this._snackNothingToDo();
    }
    this._restoreFocus(focusEl);
  }

  async unschedule(): Promise<void> {
    const tasks = this._resolveInVisualOrder().filter(
      (t) => !!t.dueDay || !!t.dueWithTime,
    );
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    await this._runSuppressed(() =>
      tasks.forEach((t) =>
        this._store.dispatch(
          TaskSharedActions.unscheduleTask({ id: t.id, isSkipToast: true }),
        ),
      ),
    );
    this._snackService.open({
      type: 'SUCCESS',
      ico: 'event_busy',
      msg: this._plural('F.TASK.MULTI_SELECT.S.UNSCHEDULED', tasks.length),
      translateParams: { count: tasks.length },
    });
    this._restoreFocus(focusEl);
  }

  async addToToday(): Promise<void> {
    const todayStr = this._dateService.todayStr();
    const tasks = this._resolveInVisualOrder().filter(
      (t) =>
        !t.isDone &&
        t.dueDay !== todayStr &&
        !(t.dueWithTime && this._dateService.isToday(t.dueWithTime)),
    );
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds: tasks.map((t) => t.id),
        today: todayStr,
        startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
        parentTaskMap: Object.fromEntries(tasks.map((t) => [t.id, t.parentId])),
        isShowSnack: true,
      }),
    );
    await this._flush();
    this._restoreFocus(focusEl);
  }

  async removeFromToday(): Promise<void> {
    const tasks = this._resolveInVisualOrder();
    if (!tasks.length) {
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    this._store.dispatch(
      TaskSharedActions.removeTasksFromTodayTag({ taskIds: tasks.map((t) => t.id) }),
    );
    await this._flush();
    this._restoreFocus(focusEl);
  }

  // ---- DEADLINE ---------------------------------------------------------

  async openDeadlineDialog(): Promise<void> {
    const tasks = this._resolveInVisualOrder();
    if (!tasks.length) {
      return;
    }
    const result = await firstValueFrom(
      this._matDialog
        .open(DialogDeadlineComponent, {
          autoFocus: false,
          data: { isSelectDeadlineOnly: true },
        })
        .afterClosed(),
    );
    if (!result || typeof result !== 'object') {
      return;
    }
    const pick = result as DateTimePick;
    await this._runSuppressed(() => {
      tasks.forEach((task) => {
        if (pick.date === null) {
          if (task.deadlineDay || task.deadlineWithTime) {
            this._store.dispatch(TaskSharedActions.removeDeadline({ taskId: task.id }));
          }
          return;
        }
        if (pick.time && isValidSplitTime(pick.time)) {
          const deadlineWithTime = getDateTimeFromClockString(
            pick.time,
            pick.date as Date,
          );
          const deadlineRemindAt =
            pick.remindOption && pick.remindOption !== TaskReminderOptionId.DoNotRemind
              ? remindOptionToMilliseconds(deadlineWithTime, pick.remindOption)
              : undefined;
          this._store.dispatch(
            TaskSharedActions.setDeadline({
              taskId: task.id,
              deadlineWithTime,
              deadlineRemindAt,
              ...getDeadlineAutoPlanFields(
                this._dateService,
                undefined,
                deadlineWithTime,
              ),
            }),
          );
        } else {
          const deadlineDay = getDbDateStr(pick.date as Date);
          this._store.dispatch(
            TaskSharedActions.setDeadline({
              taskId: task.id,
              deadlineDay,
              ...getDeadlineAutoPlanFields(this._dateService, deadlineDay),
            }),
          );
        }
      });
    });
    this._snackApplied(tasks.length);
  }

  async removeDeadline(): Promise<void> {
    const tasks = this._resolveInVisualOrder().filter(
      (t) => !!t.deadlineDay || !!t.deadlineWithTime,
    );
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    await this._runSuppressed(() =>
      tasks.forEach((t) =>
        this._store.dispatch(TaskSharedActions.removeDeadline({ taskId: t.id })),
      ),
    );
    this._snackApplied(tasks.length);
  }

  // ---- ESTIMATE ---------------------------------------------------------

  async setEstimate(ms: number): Promise<void> {
    const tasks = this._resolveInVisualOrder().filter(
      (t) => !t.subTaskIds.length && t.timeEstimate !== ms,
    );
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    await this._runSuppressed(() =>
      tasks.forEach((t) => this._taskService.update(t.id, { timeEstimate: ms })),
    );
    this._snackApplied(tasks.length);
  }

  // ---- BACKLOG ----------------------------------------------------------

  async moveToBacklog(): Promise<void> {
    await this._moveBetweenProjectLists('backlog');
  }

  async moveToRegularList(): Promise<void> {
    await this._moveBetweenProjectLists('regular');
  }

  private async _moveBetweenProjectLists(target: 'backlog' | 'regular'): Promise<void> {
    const { eligible, skippedSubtasks } = splitParentOnly(this._resolveInVisualOrder());
    const tasks = eligible.filter((t) => !!t.projectId);
    if (!tasks.length) {
      this._snackNothingToDo();
      return;
    }
    const focusEl = this._getFocusTargetAfterRemoval();
    await this._runSuppressed(() =>
      tasks.forEach((t) =>
        target === 'backlog'
          ? this._projectService.moveTaskToBacklog(t.id, t.projectId as string)
          : this._projectService.moveTaskToTodayList(t.id, t.projectId as string),
      ),
    );
    if (skippedSubtasks.length) {
      this._snackPartial(tasks.length, tasks.length + skippedSubtasks.length);
    }
    this._restoreFocus(focusEl);
  }

  // ---- helpers ----------------------------------------------------------

  private _resolveInVisualOrder(): Task[] {
    const entities = this._taskEntities();
    return this._multiSelect
      .selectedIdsInDomOrder()
      .map((id) => entities[id])
      .filter((t): t is Task => !!t);
  }

  private async _withSubTasks(task: Task): Promise<TaskWithSubTasks> {
    return firstValueFrom(
      this._store.select(selectTaskByIdWithSubTaskData, { id: task.id }).pipe(first()),
    );
  }

  /** Runs the dispatch loop with per-action feedback suppressed, then flushes. */
  private async _runSuppressed(loop: () => void): Promise<void> {
    this._multiSelect.setBulkFeedbackSuppressed(true);
    try {
      loop();
      await this._flush();
    } finally {
      this._multiSelect.setBulkFeedbackSuppressed(false);
    }
  }

  /** Rule #6: yield a macrotask after a bulk dispatch loop. */
  private _flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private async _playDoneSoundOnce(): Promise<void> {
    const soundCfg = this._globalConfigService.sound();
    if (!soundCfg?.doneSound) {
      return;
    }
    const doneToday = await firstValueFrom(this._workContextService.flatDoneTodayNr$);
    void playDoneSound(soundCfg, doneToday);
  }

  private _plural(keyPrefix: string, count: number): string {
    return getPluralKey(this._translateService, this._translateStore, count, keyPrefix);
  }

  private _snackApplied(count: number): void {
    this._snackService.open({
      type: 'SUCCESS',
      msg: this._plural('F.TASK.MULTI_SELECT.S.APPLIED', count),
      translateParams: { count },
    });
  }

  private _snackPartial(count: number, total: number): void {
    this._snackService.open({
      type: 'CUSTOM',
      ico: 'info',
      msg: T.F.TASK.MULTI_SELECT.S.APPLIED_PARTIAL,
      translateParams: { count, total },
    });
  }

  private _snackNothingToDo(): void {
    this._snackService.open({
      type: 'CUSTOM',
      ico: 'info',
      msg: T.F.TASK.MULTI_SELECT.S.NOTHING_TO_DO,
    });
  }

  /**
   * The first unselected `<task>` after the last selected one in DOM order,
   * else the last unselected one before it — captured *before* the action so
   * keyboard focus has somewhere to land once the selected rows leave the view.
   */
  private _getFocusTargetAfterRemoval(): HTMLElement | null {
    if (isTouchActive()) {
      return null;
    }
    const selected = this._multiSelect.selectedIds();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('task')).filter(
      (el) => !el.closest('task-detail-panel'),
    );
    let lastSelectedIndex = -1;
    rows.forEach((el, i) => {
      if (selected.has(el.getAttribute('data-task-id') ?? '')) {
        lastSelectedIndex = i;
      }
    });
    if (lastSelectedIndex === -1) {
      return null;
    }
    const isUnselected = (el: HTMLElement): boolean =>
      !selected.has(el.getAttribute('data-task-id') ?? '');
    return (
      rows.slice(lastSelectedIndex + 1).find(isUnselected) ??
      rows.slice(0, lastSelectedIndex).reverse().find(isUnselected) ??
      null
    );
  }

  private _restoreFocus(el: HTMLElement | null): void {
    if (!el || !el.isConnected) {
      return;
    }
    const active = document.activeElement;
    // Only move focus when it was lost (a removed row) or sits on a removed row.
    if (active && active !== document.body && active.isConnected) {
      return;
    }
    el.focus({ preventScroll: true });
  }
}
