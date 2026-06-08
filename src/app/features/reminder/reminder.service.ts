import { inject, Injectable } from '@angular/core';
import { SnackService } from '../../core/snack/snack.service';
import { combineLatest, firstValueFrom, Observable, Subject } from 'rxjs';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { T } from '../../t.const';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Log } from '../../core/log';
import { GlobalConfigService } from '../config/global-config.service';
import { Store } from '@ngrx/store';
import {
  selectAllTasksWithReminder,
  selectAllTasksWithDeadlineReminder,
  selectTaskFeatureState,
} from '../tasks/store/task.selectors';
import {
  Task,
  TaskCopy,
  TaskState,
  TaskWithReminder,
  TaskWithReminderData,
} from '../tasks/task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { Update } from '@ngrx/entity';
import {
  LegacyTaskReminder,
  migrateLegacyTaskRemindersIntoTasks,
} from './migrate-legacy-task-reminders.util';
import { getRemindersToActivate } from './due-reminders.util';

interface WorkerReminder {
  id: string;
  remindAt: number;
  title: string;
  type: 'TASK';
}

interface LegacyReminder extends LegacyTaskReminder {
  title: string;
}

@Injectable({
  providedIn: 'root',
})
export class ReminderService {
  private readonly _snackService = inject(SnackService);
  private readonly _imexMetaService = inject(ImexViewService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _store = inject(Store);
  private readonly _legacyPfDb = inject(LegacyPfDbService);

  private _onRemindersActive$: Subject<TaskWithReminderData[]> = new Subject<
    TaskWithReminderData[]
  >();
  onRemindersActive$: Observable<TaskWithReminderData[]> =
    this._onRemindersActive$.asObservable();

  private _w: Worker;
  private _isDataImportInProgress: boolean = false;
  private _latestWorkerReminders: WorkerReminder[] = [];

  constructor() {
    if (typeof (Worker as unknown) === 'undefined') {
      throw new Error('No service workers supported :(');
    }

    // @ts-ignore - import.meta.url works in browser ES modules; ignore for electron CommonJS build
    this._w = new Worker(new URL('./reminder.worker', import.meta.url), {
      name: 'reminder',
      type: 'module',
    });

    this._imexMetaService.isDataImportInProgress$
      .pipe(distinctUntilChanged())
      .subscribe((isInProgress) => {
        const wasInProgress = this._isDataImportInProgress;
        this._isDataImportInProgress = isInProgress;

        if (wasInProgress && !isInProgress) {
          this._requestImmediateReminderCheck();
        }
      });
  }

  init(): void {
    this._w.addEventListener('message', this._onReminderActivated.bind(this));
    this._w.addEventListener('error', this._handleError.bind(this));

    // Migrate legacy reminders to task.remindAt (one-time migration)
    this._migrateLegacyReminders();

    // Subscribe to tasks with reminders (schedule + deadline) and update worker
    combineLatest([
      this._store.select(selectAllTasksWithReminder),
      this._store.select(selectAllTasksWithDeadlineReminder),
    ])
      .pipe(
        map(([scheduleTasks, deadlineTasks]) => [
          ...this._mapTasksToWorkerReminders(scheduleTasks),
          ...this._mapDeadlineTasksToWorkerReminders(deadlineTasks),
        ]),
        distinctUntilChanged((prev, curr) => {
          if (prev.length !== curr.length) return false;
          const prevMap = new Map(prev.map((r) => [r.id, r]));
          return curr.every((r) => {
            const p = prevMap.get(r.id);
            return p !== undefined && p.remindAt === r.remindAt && p.title === r.title;
          });
        }),
      )
      .subscribe((reminders) => {
        this._updateRemindersInWorker(reminders);
        if (!environment.production) {
          Log.log('Updated reminders in worker', reminders);
        }
      });
  }

  private async _migrateLegacyReminders(): Promise<void> {
    try {
      const legacyReminders = await this._legacyPfDb.load<LegacyReminder[]>('reminders');

      if (!legacyReminders || legacyReminders.length === 0) {
        Log.log('ReminderService: No legacy reminders to migrate');
        return;
      }

      Log.log(
        `ReminderService: Migrating ${legacyReminders.length} legacy reminders to task.remindAt`,
      );

      const currentTaskState = await firstValueFrom(
        this._store.select(selectTaskFeatureState),
      );
      if (!currentTaskState?.entities) {
        Log.log('ReminderService: Cannot migrate legacy reminders without task state');
        return;
      }

      const taskState = _cloneTaskStateForMigration(currentTaskState);
      const migrationResult = migrateLegacyTaskRemindersIntoTasks(
        taskState,
        legacyReminders,
      );
      const updates = _getLegacyReminderMigrationUpdates(
        taskState,
        migrationResult.migratedTaskIds,
      );

      if (updates.length > 0) {
        this._store.dispatch(TaskSharedActions.updateTasks({ tasks: updates }));
      }
      // Clear legacy reminders after migration
      await this._legacyPfDb.save('reminders', []);

      Log.log(
        `ReminderService: Migration complete - ${updates.length} migrated, ${migrationResult.skippedNoteCount} NOTE reminders skipped`,
      );
    } catch (err) {
      Log.err('ReminderService: Failed to migrate legacy reminders', err);
    }
  }

  private _mapTasksToWorkerReminders(tasks: TaskWithReminder[]): WorkerReminder[] {
    return tasks.map((task) => ({
      id: task.id,
      remindAt: task.remindAt,
      title: task.title,
      type: 'TASK' as const,
    }));
  }

  private _mapDeadlineTasksToWorkerReminders(tasks: Task[] | null): WorkerReminder[] {
    if (!tasks) return [];
    return tasks
      .filter((task) => typeof task.deadlineRemindAt === 'number')
      .map((task) => ({
        // Use a distinct ID to avoid conflicts with schedule reminders
        id: task.id + '_deadline',
        remindAt: task.deadlineRemindAt!,
        title: task.title,
        type: 'TASK' as const,
      }));
  }

  private _onReminderActivated(msg: MessageEvent): void {
    const reminders = msg.data as WorkerReminder[];
    this._emitActiveReminders(reminders);
  }

  private _emitActiveReminders(reminders: WorkerReminder[]): void {
    Log.log(`ReminderService: Worker activated ${reminders.length} reminder(s)`);

    if (this._isDataImportInProgress) {
      Log.log('ReminderService: data import active, delaying reminder dialog check');
      return;
    }

    if (this._globalConfigService.cfg()?.reminder?.disableReminders) {
      Log.log('ReminderService: reminders are disabled, not sending to UI');
      return;
    }

    // Map worker reminders back to TaskWithReminderData format
    // If both a schedule and deadline reminder fire for the same task,
    // keep only the schedule reminder (it takes precedence in the dialog)
    const DEADLINE_SUFFIX = '_deadline';
    const seenTaskIds = new Set<string>();
    const taskReminders: TaskWithReminderData[] = [];
    // Process non-deadline reminders first so they take precedence
    for (const r of reminders) {
      if (!r.id.endsWith(DEADLINE_SUFFIX)) {
        seenTaskIds.add(r.id);
        taskReminders.push({
          id: r.id,
          title: r.title,
          reminderData: { remindAt: r.remindAt },
          isDeadlineReminder: false,
        } as TaskWithReminderData);
      }
    }
    for (const r of reminders) {
      if (r.id.endsWith(DEADLINE_SUFFIX)) {
        const taskId = r.id.slice(0, -DEADLINE_SUFFIX.length);
        if (!seenTaskIds.has(taskId)) {
          seenTaskIds.add(taskId);
          taskReminders.push({
            id: taskId,
            title: r.title,
            reminderData: { remindAt: r.remindAt },
            isDeadlineReminder: true,
          } as TaskWithReminderData);
        }
      }
    }

    Log.log(`ReminderService: ${taskReminders.length} valid reminder(s) to show`);
    if (taskReminders.length > 0) {
      this._onRemindersActive$.next(taskReminders);
    }
  }

  private _requestImmediateReminderCheck(): void {
    if (this._latestWorkerReminders.length === 0) {
      return;
    }

    Log.log('ReminderService: data import finished, rechecking reminders', {
      count: this._latestWorkerReminders.length,
    });
    const remindersToActivate = getRemindersToActivate(this._latestWorkerReminders);
    if (remindersToActivate.length > 0) {
      this._emitActiveReminders(remindersToActivate);
    }
  }

  private _updateRemindersInWorker(reminders: WorkerReminder[]): void {
    this._latestWorkerReminders = reminders;
    this._w.postMessage(reminders);
  }

  private _handleError(err: unknown): void {
    Log.err(err);
    this._snackService.open({ type: 'ERROR', msg: T.F.REMINDER.S_REMINDER_ERR });
  }
}

const _cloneTaskStateForMigration = (
  taskState: TaskState,
): {
  ids: string[];
  entities: Record<string, TaskCopy | undefined>;
} => ({
  ids: [...taskState.ids],
  entities: Object.fromEntries(
    Object.entries(taskState.entities).map(([taskId, task]) => [
      taskId,
      task ? ({ ...task } as TaskCopy) : undefined,
    ]),
  ),
});

const _getLegacyReminderMigrationUpdates = (
  taskState: { entities: Record<string, TaskCopy | undefined> },
  migratedTaskIds: string[],
): Update<Task>[] =>
  migratedTaskIds
    .map((taskId) => taskState.entities[taskId])
    .filter((task): task is TaskCopy => !!task)
    .map((task) => ({
      id: task.id,
      changes: {
        remindAt: task.remindAt,
        dueWithTime: task.dueWithTime,
        reminderId: undefined,
      } as Partial<Task>,
    }));
