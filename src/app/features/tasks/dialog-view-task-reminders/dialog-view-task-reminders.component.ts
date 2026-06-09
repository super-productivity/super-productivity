import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  viewChildren,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogState,
  MatDialogTitle,
} from '@angular/material/dialog';
import { Task, TaskWithReminderData } from '../task.model';
import { TaskService } from '../task.service';
import { BehaviorSubject, combineLatest, Observable, of, Subscription } from 'rxjs';
import { ReminderService } from '../../reminder/reminder.service';
import { distinctUntilChanged, first, map, switchMap, takeWhile } from 'rxjs/operators';
import { T } from '../../../t.const';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { getTomorrow } from '../../../util/get-tomorrow';
import { ProjectService } from '../../project/project.service';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { LocalDateStrPipe } from 'src/app/ui/pipes/local-date-str.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { DateService } from '../../../core/date/date.service';
import { MatTooltip } from '@angular/material/tooltip';

const MINUTES_TO_MILLISECONDS = 1000 * 60;

@Component({
  selector: 'dialog-view-task-reminder',
  templateUrl: './dialog-view-task-reminders.component.html',
  styleUrls: ['./dialog-view-task-reminders.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation],
  imports: [
    MatDialogTitle,
    MatIcon,
    MatDialogContent,
    MatIconButton,
    MatMenuTrigger,
    MatMenu,
    MatMenuItem,
    MatDialogActions,
    MatButton,
    AsyncPipe,
    NgTemplateOutlet,
    TranslatePipe,
    TagListComponent,
    LocaleDatePipe,
    LocalDateStrPipe,
    MatTooltip,
  ],
})
export class DialogViewTaskRemindersComponent implements OnDestroy {
  private _menuTriggers = viewChildren(MatMenuTrigger);
  private _matDialogRef =
    inject<MatDialogRef<DialogViewTaskRemindersComponent>>(MatDialogRef);
  private _taskService = inject(TaskService);
  private _projectService = inject(ProjectService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _reminderService = inject(ReminderService);
  private _dateService = inject(DateService);
  private _elementRef = inject(ElementRef);
  data = inject<{
    reminders: TaskWithReminderData[];
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;
  isDisableControls: boolean = false;
  private _deadlineReminderTaskIds = new Set<string>(
    this.data.reminders.filter((r) => r.isDeadlineReminder).map((r) => r.id),
  );
  taskIds$: BehaviorSubject<string[]> = new BehaviorSubject(
    this.data.reminders.map((r) => r.id),
  );
  tasks$: Observable<TaskWithReminderData[]> = this.taskIds$.pipe(
    switchMap((taskIds) =>
      this._taskService.getByIdsLive$(taskIds).pipe(
        first(),
        map((tasks: Task[]) =>
          tasks
            .filter((task) => !!task)
            .map((task): TaskWithReminderData => {
              const isDeadline = this._deadlineReminderTaskIds.has(task.id);
              const remindAt = isDeadline
                ? (task.deadlineRemindAt as number)
                : (task.remindAt as number);
              return {
                ...task,
                reminderData: { remindAt },
                isDeadlineReminder: isDeadline,
              };
            }),
        ),
      ),
    ),
  );
  todayTaskIds$: Observable<string[]> = this._store.select(selectTodayTaskIds);
  isSingleOnToday$: Observable<boolean> = combineLatest([
    this.tasks$,
    this.todayTaskIds$,
  ]).pipe(
    map(
      ([tasks, todayTaskIds]) =>
        tasks.length === 1 && tasks[0] && todayTaskIds.includes(tasks[0].id),
    ),
  );
  isMultiple$: Observable<boolean> = this.tasks$.pipe(
    map((tasks) => tasks.length > 1),
    takeWhile((isMultiple) => !isMultiple, true),
  );
  isMultiple: boolean = false;
  isAllDeadline: boolean = this.data.reminders.every((r) => r.isDeadlineReminder);
  // eslint-disable-next-line no-mixed-operators
  overdueThreshold = Date.now() - 30 * 60 * 1000; // 30 minutes

  private _subs: Subscription = new Subscription();
  // Track dismissed reminder IDs to prevent stale data from worker re-triggering them
  private _dismissedReminderIds = new Set<string>();
  // Reminders we have observed as still-valid in the store at least once. We only
  // auto-dismiss a reminder that was confirmed present and then disappeared (e.g.
  // cleared/completed/deleted on another device and synced in). A reminder that is
  // already absent at open time is never confirmed, so it is never dropped — this
  // preserves the open-time relaxation that fixed the worker/store snapshot race.
  private _confirmedPresentIds = new Set<string>();
  // Stored separately so it can be cancelled eagerly when the dialog begins closing,
  // preventing race conditions where a worker tick updates a mid-animation dialog.
  private _onRemindersActiveSub: Subscription = Subscription.EMPTY;
  // Cancelled eagerly on close for the same reason as _onRemindersActiveSub: a store
  // emission mid-animation must not reconcile a dialog that is being torn down.
  private _storeReconcileSub: Subscription = Subscription.EMPTY;

  constructor() {
    this._onRemindersActiveSub = this._reminderService.onRemindersActive$.subscribe(
      (reminders) => {
        // Filter out reminders that were already dismissed in this dialog session
        const filtered = reminders.filter((r) => !this._dismissedReminderIds.has(r.id));
        if (filtered.length > 0) {
          // Update deadline tracking for newly arriving reminders (W2)
          filtered
            .filter((r) => r.isDeadlineReminder)
            .forEach((r) => this._deadlineReminderTaskIds.add(r.id));
          // Update isAllDeadline dynamically (W7)
          this.isAllDeadline = filtered.every((r) => r.isDeadlineReminder);
          this.taskIds$.next(filtered.map((r) => r.id));
        } else {
          this._close();
        }
      },
    );
    this._subs.add(this._onRemindersActiveSub);

    // Watch the live store so reminders that disappear while the dialog is open —
    // e.g. dismissed, completed or deleted on another device and then synced in —
    // are removed from the list and the dialog is closed once nothing is left.
    // The worker only ever signals reminders that ARE active, never that one is
    // gone, so without this a synced-away reminder would keep the dialog open.
    this._storeReconcileSub = this.taskIds$
      .pipe(
        switchMap((taskIds) =>
          taskIds.length ? this._taskService.getByIdsLive$(taskIds) : of([] as Task[]),
        ),
        // getByIdsLive$ emits a fresh array on every task mutation app-wide; only
        // reconcile when something we care about on the watched tasks changes.
        distinctUntilChanged((prev, curr) => {
          if (prev.length !== curr.length) {
            return false;
          }
          return prev.every((p, i) => {
            const c = curr[i];
            if (!p || !c) {
              return p === c;
            }
            return (
              p.id === c.id &&
              p.isDone === c.isDone &&
              p.remindAt === c.remindAt &&
              p.deadlineRemindAt === c.deadlineRemindAt
            );
          });
        }),
      )
      .subscribe((tasks) => this._reconcileWithStore(tasks));
    this._subs.add(this._storeReconcileSub);

    this._subs.add(
      this.isMultiple$.subscribe((isMultiple) => (this.isMultiple = isMultiple)),
    );
  }

  ngOnDestroy(): void {
    // Clear any deadline reminders that were shown but not explicitly handled
    // (e.g. user closed via ESC/backdrop). Without this, the reminder worker
    // re-detects the past-due deadlineRemindAt every 10s and the dialog reopens
    // indefinitely. Explicit user actions add the task to _dismissedReminderIds,
    // so this only fires for genuinely unhandled reminders. The deadline date
    // itself is preserved — only the reminder timestamp is cleared.
    this._deadlineReminderTaskIds.forEach((taskId) => {
      if (!this._dismissedReminderIds.has(taskId)) {
        this._store.dispatch(TaskSharedActions.clearDeadlineReminder({ taskId }));
      }
    });
    this._subs.unsubscribe();
  }

  async addToToday(task: TaskWithReminderData): Promise<void> {
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds: [task.id],
        today: this._dateService.todayStr(),
        startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
        parentTaskMap: {
          [task.id]: task.parentId,
        },
        isClearScheduledTime: true,
      }),
    );
    if (task.isDeadlineReminder) {
      this._clearDeadlineReminder(task);
    }
    this._removeTaskFromList(task.id);
  }

  dismiss(task: TaskWithReminderData): void {
    if (task.isDeadlineReminder) {
      this._clearDeadlineReminder(task);
      this._removeTaskFromList(task.id);
      return;
    }
    if (task.projectId || task.parentId || task.tagIds.length > 0) {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: task.id,
        }),
      );
      this._removeTaskFromList(task.id);
    }
  }

  dismissReminderOnly(task: TaskWithReminderData): void {
    if (task.isDeadlineReminder) {
      this._clearDeadlineReminder(task);
    } else {
      this._store.dispatch(
        TaskSharedActions.dismissReminderOnly({
          id: task.id,
        }),
      );
    }
    this._removeTaskFromList(task.id);
  }

  snooze(task: TaskWithReminderData, snoozeInMinutes: number): void {
    const snoozeMs = snoozeInMinutes * MINUTES_TO_MILLISECONDS;
    const newRemindAt = Date.now() + snoozeMs;
    if (task.isDeadlineReminder) {
      this._store.dispatch(
        TaskSharedActions.setDeadline({
          taskId: task.id,
          ...(task.deadlineDay ? { deadlineDay: task.deadlineDay } : {}),
          ...(task.deadlineWithTime ? { deadlineWithTime: task.deadlineWithTime } : {}),
          deadlineRemindAt: newRemindAt,
        }),
      );
    } else {
      this._store.dispatch(
        TaskSharedActions.reScheduleTaskWithTime({
          task,
          dueWithTime: task.dueWithTime || newRemindAt,
          remindAt: newRemindAt,
          isMoveToBacklog: false,
        }),
      );
    }
    this._removeTaskFromList(task.id);
  }

  planForTomorrow(task: TaskWithReminderData): void {
    this._store.dispatch(
      PlannerActions.planTaskForDay({
        task,
        day: getDbDateStr(getTomorrow()),
        isShowSnack: true,
      }),
    );
    if (task.isDeadlineReminder) {
      this._clearDeadlineReminder(task);
    }
    this._removeTaskFromList(task.id);
  }

  editReminder(task: TaskWithReminderData, isCloseAfter: boolean = false): void {
    this._subs.add(
      this._matDialog
        .open(DialogScheduleTaskComponent, {
          restoreFocus: true,
          data: { task },
        })
        .afterClosed()
        .subscribe((wasEdited) => {
          if (wasEdited) {
            this._removeTaskFromList(task.id);
          }
          if (isCloseAfter) {
            // If edit was cancelled (wasEdited false), the task stays out of
            // _dismissedReminderIds, so ngOnDestroy clears deadlineRemindAt —
            // same treatment as ESC. Intentional: prevents the worker from
            // re-firing the past-due reminder every 10s.
            this._close();
          }
        }),
    );
  }

  hasDeadlineTasks(tasks: TaskWithReminderData[]): boolean {
    return tasks.some((t) => t.isDeadlineReminder);
  }

  hasScheduleTasks(tasks: TaskWithReminderData[]): boolean {
    return tasks.some((t) => !t.isDeadlineReminder);
  }

  trackById(i: number, task: Task): string {
    return task.id;
  }

  // ALL ACTIONS
  // ------------
  snoozeAll(snoozeInMinutes: number): void {
    this._prepareForBulkAction();
    this._subs.add(
      this.tasks$.pipe(first()).subscribe((tasks) => {
        tasks.forEach((task) => this.snooze(task, snoozeInMinutes));
        this._finalizeBulkAction();
      }),
    );
  }

  rescheduleAllUntilTomorrow(): void {
    this._prepareForBulkAction();
    this._subs.add(
      this.tasks$.pipe(first()).subscribe((tasks) => {
        tasks.forEach((t) => this.planForTomorrow(t));
        this._finalizeBulkAction();
      }),
    );
  }

  markSingleAsDone(): void {
    this._subs.add(
      this.tasks$.pipe(first()).subscribe((tasks) => {
        if (tasks.length === 1) {
          const task = tasks[0];
          this._taskService.setDone(task.id);
          if (task.isDeadlineReminder) {
            this._clearDeadlineReminder(task);
          }
          this._dismissedReminderIds.add(task.id);
          this._finalizeBulkAction();
        }
      }),
    );
  }

  async addAllToToday(): Promise<void> {
    this._prepareForBulkAction();
    const selectedTasks = await this._getTasksFromList();

    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds: selectedTasks.map((t) => t.id),
        today: this._dateService.todayStr(),
        startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
        parentTaskMap: selectedTasks.reduce((acc, next: Task) => {
          return { ...acc, [next.id as string]: next.parentId };
        }, {}),
        isShowSnack: true,
        isClearScheduledTime: true,
      }),
    );

    selectedTasks
      .filter((t) => t.isDeadlineReminder)
      .forEach((t) => this._clearDeadlineReminder(t));

    selectedTasks.forEach((t) => this._dismissedReminderIds.add(t.id));
    this._finalizeBulkAction();
  }

  async dismissAll(): Promise<void> {
    this._prepareForBulkAction();
    const tasks = await this._getTasksFromList();
    tasks.forEach((task) => {
      if (
        task.isDeadlineReminder ||
        task.projectId ||
        task.parentId ||
        task.tagIds.length > 0
      ) {
        this.dismiss(task);
      }
    });
    this._finalizeBulkAction();
  }

  async dismissAllRemindersOnly(): Promise<void> {
    this._prepareForBulkAction();
    const tasks = await this._getTasksFromList();
    tasks.forEach((task) => {
      this.dismissReminderOnly(task);
    });
    this._finalizeBulkAction();
  }

  async play(): Promise<void> {
    const tasks = await this.tasks$.pipe(first()).toPromise();
    if (tasks.length !== 1) {
      throw new Error('More or less than one task');
    }
    this.isDisableControls = true;

    const task = tasks[0];
    if (task.projectId) {
      if (task.parentId) {
        this._projectService.moveTaskToTodayList(task.parentId, task.projectId, true);
      } else {
        this._projectService.moveTaskToTodayList(task.id, task.projectId, true);
      }
    }
    this._taskService.setCurrentId(task.id);
    this.dismissReminderOnly(task);
  }

  markTaskAsDone(task: TaskWithReminderData): void {
    this._taskService.setDone(task.id);
    if (task.isDeadlineReminder) {
      this._clearDeadlineReminder(task);
    }
    this._removeTaskFromList(task.id);
  }

  async markAllAsDone(): Promise<void> {
    await this.markAllTasksAsDone();
  }

  async markAllTasksAsDone(): Promise<void> {
    this._prepareForBulkAction();
    const tasks = await this._getTasksFromList();
    tasks.forEach((task) => {
      this._taskService.setDone(task.id);
      if (task.isDeadlineReminder) {
        this._clearDeadlineReminder(task);
      }
      this._dismissedReminderIds.add(task.id);
    });
    this._finalizeBulkAction();
  }

  private _reconcileWithStore(tasks: Task[]): void {
    const taskById = new Map(
      tasks.filter((task): task is Task => !!task).map((task) => [task.id, task]),
    );
    const currentIds = this.taskIds$.getValue();

    const isReminderStillValid = (id: string): boolean => {
      const task = taskById.get(id);
      if (!task || task.isDone) {
        return false;
      }
      // A reminder is still "present" as long as its timestamp exists; clearing it
      // (unschedule / dismiss / remove deadline) is what marks it as gone. We do not
      // treat a future-rescheduled timestamp as gone — that reminder still exists and
      // the worker will fire it again later.
      const remindAt = this._deadlineReminderTaskIds.has(id)
        ? task.deadlineRemindAt
        : task.remindAt;
      return typeof remindAt === 'number';
    };

    // Confirm presence first so a later disappearance can be detected. A reminder
    // that is absent on the very first pass (worker snapshot briefly ahead of the
    // store) is never confirmed here and therefore never auto-dismissed.
    currentIds.forEach((id) => {
      if (isReminderStillValid(id)) {
        this._confirmedPresentIds.add(id);
      }
    });

    const goneIds = currentIds.filter(
      (id) => this._confirmedPresentIds.has(id) && !isReminderStillValid(id),
    );
    if (goneIds.length === 0) {
      return;
    }

    // Mark as dismissed so a worker tick cannot re-add them and ngOnDestroy does not
    // re-clear an already-cleared deadline reminder.
    goneIds.forEach((id) => this._dismissedReminderIds.add(id));
    const remainingIds = currentIds.filter((id) => !goneIds.includes(id));
    if (remainingIds.length === 0) {
      this._close();
    } else {
      this.isAllDeadline = remainingIds.every((id) =>
        this._deadlineReminderTaskIds.has(id),
      );
      this.taskIds$.next(remainingIds);
    }
  }

  private _clearDeadlineReminder(task: TaskWithReminderData): void {
    this._store.dispatch(
      TaskSharedActions.clearDeadlineReminder({
        taskId: task.id,
      }),
    );
  }

  private _close(): void {
    if (this._matDialogRef.getState() !== MatDialogState.OPEN) {
      return;
    }
    // Stop listening for new reminders and store changes immediately so a worker
    // tick or store emission during the close animation cannot update the view
    // while it is being torn down.
    this._onRemindersActiveSub.unsubscribe();
    this._storeReconcileSub.unsubscribe();
    this._menuTriggers().forEach((trigger) => {
      trigger.closeMenu();
    });
    this._matDialogRef.close();
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(ev: KeyboardEvent): void {
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) {
      const activeEl = document.activeElement as HTMLElement;
      if (!activeEl) return;

      const taskRow = activeEl.closest('.task') as HTMLElement;
      const wrapButtons = activeEl.closest('.wrap-buttons') as HTMLElement;

      if (!taskRow && !wrapButtons) return;

      const allRows = this._getTaskRows();
      const footerButtons = this._getFooterButtons();

      if (taskRow) {
        const rowIndex = allRows.indexOf(taskRow);
        const buttonsInRow = this._getFocusableButtons(taskRow);
        const btnIndex = buttonsInRow.indexOf(activeEl as HTMLButtonElement);

        if (ev.key === 'ArrowDown') {
          const nextRow = allRows[rowIndex + 1];
          if (nextRow) {
            ev.preventDefault();
            const nextButtons = this._getFocusableButtons(nextRow);
            (nextButtons[btnIndex] || nextButtons[0])?.focus();
          } else if (footerButtons.length > 0) {
            ev.preventDefault();
            footerButtons[0].focus();
          }
        } else if (ev.key === 'ArrowUp') {
          const prevRow = allRows[rowIndex - 1];
          if (prevRow) {
            ev.preventDefault();
            const prevButtons = this._getFocusableButtons(prevRow);
            (prevButtons[btnIndex] || prevButtons[0])?.focus();
          }
        } else if (ev.key === 'ArrowRight') {
          if (btnIndex < buttonsInRow.length - 1) {
            ev.preventDefault();
            buttonsInRow[btnIndex + 1]?.focus();
          }
        } else if (ev.key === 'ArrowLeft') {
          if (btnIndex > 0) {
            ev.preventDefault();
            buttonsInRow[btnIndex - 1]?.focus();
          }
        }
      } else if (wrapButtons) {
        const btnIndex = footerButtons.indexOf(activeEl as HTMLButtonElement);

        if (ev.key === 'ArrowUp') {
          if (allRows.length > 0) {
            ev.preventDefault();
            const lastRow = allRows[allRows.length - 1];
            const lastRowButtons = this._getFocusableButtons(lastRow);
            // Try to match horizontal position if possible, otherwise last button
            (
              lastRowButtons[btnIndex] || lastRowButtons[lastRowButtons.length - 1]
            )?.focus();
          }
        } else if (ev.key === 'ArrowRight') {
          if (btnIndex < footerButtons.length - 1) {
            ev.preventDefault();
            footerButtons[btnIndex + 1].focus();
          }
        } else if (ev.key === 'ArrowLeft') {
          if (btnIndex > 0) {
            ev.preventDefault();
            footerButtons[btnIndex - 1].focus();
          }
        }
      }
    }
  }

  private _getFocusableButtons(container: HTMLElement): HTMLButtonElement[] {
    if (!container) return [];
    return (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).filter((btn) => !btn.disabled && btn.offsetWidth > 0);
  }

  // Scope DOM lookups to this dialog's host. `.task` / `.wrap-buttons` are not
  // unique across the app (many dialogs use `.wrap-buttons`) and a reminder can
  // open on top of another dialog, so a global query could target the wrong one.
  private _getTaskRows(): HTMLElement[] {
    return Array.from(
      (this._elementRef.nativeElement as HTMLElement).querySelectorAll('.task'),
    );
  }

  private _getFooterButtons(): HTMLButtonElement[] {
    return this._getFocusableButtons(
      (this._elementRef.nativeElement as HTMLElement).querySelector(
        '.wrap-buttons',
      ) as HTMLElement,
    );
  }

  private _removeTaskFromList(taskId: string): void {
    const activeEl = document.activeElement as HTMLElement;
    let rowIndex = -1;
    let btnIndex = -1;

    if (activeEl?.closest('.task')) {
      const taskRow = activeEl.closest('.task') as HTMLElement;
      rowIndex = this._getTaskRows().indexOf(taskRow);
      btnIndex = this._getFocusableButtons(taskRow).indexOf(
        activeEl as HTMLButtonElement,
      );
    } else {
      // Menu action: focus is in the menu overlay, not the row. Fall back to the
      // row's snooze button (the menu trigger) so the next-row focus lands on the
      // equivalent control, regardless of which actions are hidden/disabled.
      const taskRow = (this._elementRef.nativeElement as HTMLElement).querySelector(
        `.task[data-id="${taskId}"]`,
      ) as HTMLElement | null;
      if (taskRow) {
        rowIndex = this._getTaskRows().indexOf(taskRow);
        const rowButtons = this._getFocusableButtons(taskRow);
        const snoozeBtn = taskRow.querySelector(
          'button[aria-haspopup="menu"]',
        ) as HTMLButtonElement | null;
        btnIndex = snoozeBtn ? rowButtons.indexOf(snoozeBtn) : 0;
      }
    }

    // Track dismissed ID to prevent stale data from worker re-adding it
    this._dismissedReminderIds.add(taskId);
    const newTaskIds = this.taskIds$.getValue().filter((id) => id !== taskId);
    if (newTaskIds.length <= 0) {
      this._close();
    } else {
      this.taskIds$.next(newTaskIds);

      if (rowIndex !== -1) {
        // Wait for DOM update
        setTimeout(() => {
          const remainingRows = this._getTaskRows();
          const nextRow = remainingRows[rowIndex] || remainingRows[rowIndex - 1];
          if (nextRow) {
            const buttons = this._getFocusableButtons(nextRow);
            (buttons[btnIndex] || buttons[0])?.focus();
          } else {
            // Focus first footer button if no rows left
            this._getFooterButtons()[0]?.focus();
          }
        });
      }
    }
  }

  private async _getTasksFromList(): Promise<TaskWithReminderData[]> {
    return (await this.tasks$.pipe(first()).toPromise()) as TaskWithReminderData[];
  }

  private _prepareForBulkAction(): void {
    this.isDisableControls = true;
  }

  private _finalizeBulkAction(): void {
    this._close();
  }
}
