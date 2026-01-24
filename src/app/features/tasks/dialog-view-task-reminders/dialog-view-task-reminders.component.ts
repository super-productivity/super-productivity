import {
  ChangeDetectionStrategy,
  Component,
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
  MatDialogTitle,
} from '@angular/material/dialog';
import { Task, TaskWithReminderData } from '../task.model';
import { TaskService } from '../task.service';
import { BehaviorSubject, combineLatest, Observable, Subscription } from 'rxjs';
import { ReminderService } from '../../reminder/reminder.service';
import { first, map, switchMap, takeWhile } from 'rxjs/operators';
import { T } from '../../../t.const';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { getTomorrow } from '../../../util/get-tomorrow';
import { ProjectService } from '../../project/project.service';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { AsyncPipe } from '@angular/common';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';

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
    TranslatePipe,
    TagListComponent,
    LocaleDatePipe,
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
  data = inject<{
    reminders: TaskWithReminderData[];
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;
  isDisableControls: boolean = false;
  taskIds$: BehaviorSubject<string[]> = new BehaviorSubject(
    this.data.reminders.map((r) => r.id),
  );
  tasks$: Observable<TaskWithReminderData[]> = this.taskIds$.pipe(
    switchMap((taskIds) =>
      this._taskService.getByIdsLive$(taskIds).pipe(
        first(),
        map((tasks: Task[]) =>
          tasks
            .filter((task) => !!task && typeof task.remindAt === 'number')
            .map(
              (task): TaskWithReminderData => ({
                ...task,
                reminderData: { remindAt: task.remindAt as number },
              }),
            ),
        ),
      ),
    ),
  );
  isSingleOnToday$: Observable<boolean> = combineLatest([
    this.tasks$,
    this._store.select(selectTodayTaskIds),
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
  // eslint-disable-next-line no-mixed-operators
  overdueThreshold = Date.now() - 30 * 60 * 1000; // 30 minutes

  private _subs: Subscription = new Subscription();
  // Track dismissed reminder IDs to prevent stale data from worker re-triggering them
  private _dismissedReminderIds = new Set<string>();

  constructor() {
    this._subs.add(
      this._reminderService.onRemindersActive$.subscribe((reminders) => {
        // Filter out reminders that were already dismissed in this dialog session
        const filtered = reminders.filter((r) => !this._dismissedReminderIds.has(r.id));
        if (filtered.length > 0) {
          this.taskIds$.next(filtered.map((r) => r.id));
        } else {
          this._close();
        }
      }),
    );
    this._subs.add(
      this.isMultiple$.subscribe((isMultiple) => (this.isMultiple = isMultiple)),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  async addToToday(task: TaskWithReminderData): Promise<void> {
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds: [task.id],
        parentTaskMap: {
          [task.id]: task.parentId,
        },
        isClearScheduledTime: true,
      }),
    );
    this._removeTaskFromList(task.id);
  }

  dismiss(task: TaskWithReminderData): void {
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
    this._store.dispatch(
      TaskSharedActions.dismissReminderOnly({
        id: task.id,
      }),
    );
    this._removeTaskFromList(task.id);
  }

  snooze(task: TaskWithReminderData, snoozeInMinutes: number): void {
    const snoozeMs = snoozeInMinutes * MINUTES_TO_MILLISECONDS;
    const newRemindAt = Date.now() + snoozeMs;
    this._store.dispatch(
      TaskSharedActions.reScheduleTaskWithTime({
        task,
        dueWithTime: task.dueWithTime || newRemindAt,
        remindAt: newRemindAt,
        isMoveToBacklog: false,
      }),
    );
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
            this._close();
          }
        }),
    );
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
          this._taskService.setDone(tasks[0].id);
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
        parentTaskMap: selectedTasks.reduce((acc, next: Task) => {
          return { ...acc, [next.id as string]: next.parentId };
        }, {}),
        isShowSnack: true,
        isClearScheduledTime: true,
      }),
    );

    this._finalizeBulkAction();
  }

  async dismissAll(): Promise<void> {
    this._prepareForBulkAction();
    const tasks = await this._getTasksFromList();
    tasks.forEach((task) => {
      if (task.projectId || task.parentId || task.tagIds.length > 0) {
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
    this.dismiss(task);
  }

  markTaskAsDone(task: TaskWithReminderData): void {
    this._taskService.setDone(task.id);
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
    });
    this._finalizeBulkAction();
  }

  private _close(): void {
    this._menuTriggers().forEach((trigger) => {
      trigger.closeMenu();
    });
    this._matDialogRef.close();
  }

  private _removeTaskFromList(taskId: string): void {
    // Track dismissed ID to prevent stale data from worker re-adding it
    this._dismissedReminderIds.add(taskId);
    const newTaskIds = this.taskIds$.getValue().filter((id) => id !== taskId);
    if (newTaskIds.length <= 0) {
      this._close();
    } else {
      this.taskIds$.next(newTaskIds);
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
