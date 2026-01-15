import { inject, Injectable } from '@angular/core';
import { SnackService } from '../../core/snack/snack.service';
import { Observable, Subject } from 'rxjs';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { T } from '../../t.const';
import { distinctUntilChanged, filter, map, skipUntil } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Log } from '../../core/log';
import { GlobalConfigService } from '../config/global-config.service';
import { Store } from '@ngrx/store';
import { selectAllTasksWithReminder } from '../tasks/store/task.selectors';
import { TaskWithReminder, TaskWithReminderData } from '../tasks/task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';

interface WorkerReminder {
  id: string;
  remindAt: number;
  title: string;
  type: 'TASK';
}

interface LegacyReminder {
  id: string;
  remindAt: number;
  title: string;
  type: 'NOTE' | 'TASK';
  relatedId: string;
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
  onRemindersActive$: Observable<TaskWithReminderData[]> = this._onRemindersActive$.pipe(
    skipUntil(
      this._imexMetaService.isDataImportInProgress$.pipe(
        filter((isInProgress) => !isInProgress),
      ),
    ),
  );

  private _w: Worker;

  constructor() {
    if (typeof (Worker as unknown) === 'undefined') {
      throw new Error('No service workers supported :(');
    }

    // @ts-ignore - import.meta.url works in browser ES modules; ignore for electron CommonJS build
    this._w = new Worker(new URL('./reminder.worker', import.meta.url), {
      name: 'reminder',
      type: 'module',
    });
  }

  init(): void {
    this._w.addEventListener('message', this._onReminderActivated.bind(this));
    this._w.addEventListener('error', this._handleError.bind(this));

    // Migrate legacy reminders to task.remindAt (one-time migration)
    this._migrateLegacyReminders();

    // Subscribe to tasks with reminders and update worker only when reminders actually change
    this._store
      .select(selectAllTasksWithReminder)
      .pipe(
        map((tasks) => this._mapTasksToWorkerReminders(tasks)),
        distinctUntilChanged((prev, curr) => {
          if (prev.length !== curr.length) return false;
          return prev.every(
            (r, i) =>
              r.id === curr[i].id &&
              r.remindAt === curr[i].remindAt &&
              r.title === curr[i].title,
          );
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

      let migratedCount = 0;
      let skippedNotes = 0;

      for (const reminder of legacyReminders) {
        if (reminder.type === 'NOTE') {
          // Note reminders are discontinued
          skippedNotes++;
          Log.log(`ReminderService: Skipping NOTE reminder: ${reminder.id}`);
          continue;
        }

        if (reminder.type === 'TASK') {
          // Dispatch action to reschedule with remindAt
          // This will update the task's remindAt field through the reducer
          this._store.dispatch(
            TaskSharedActions.reScheduleTaskWithTime({
              task: { id: reminder.relatedId, title: reminder.title } as TaskWithReminder,
              dueWithTime: reminder.remindAt,
              remindAt: reminder.remindAt,
              isMoveToBacklog: false,
            }),
          );
          migratedCount++;
          Log.log(`ReminderService: Migrated reminder for task: ${reminder.relatedId}`);
        }
      }

      // Clear legacy reminders after migration
      await this._legacyPfDb.save('reminders', []);

      Log.log(
        `ReminderService: Migration complete - ${migratedCount} migrated, ${skippedNotes} NOTE reminders skipped`,
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

  private _onReminderActivated(msg: MessageEvent): void {
    const reminders = msg.data as WorkerReminder[];
    Log.log(`ReminderService: Worker activated ${reminders.length} reminder(s)`);

    if (this._globalConfigService.cfg()?.reminder?.disableReminders) {
      Log.log('ReminderService: reminders are disabled, not sending to UI');
      return;
    }

    // Map worker reminders back to TaskWithReminderData format
    const taskReminders: TaskWithReminderData[] = reminders.map((r) => ({
      id: r.id,
      title: r.title,
      reminderData: { remindAt: r.remindAt },
      // These fields will be populated by the component that consumes this
      // by looking up the full task from the store
    })) as TaskWithReminderData[];

    Log.log(`ReminderService: ${taskReminders.length} valid reminder(s) to show`);
    if (taskReminders.length > 0) {
      this._onRemindersActive$.next(taskReminders);
    }
  }

  private _updateRemindersInWorker(reminders: WorkerReminder[]): void {
    this._w.postMessage(reminders);
  }

  private _handleError(err: unknown): void {
    Log.err(err);
    this._snackService.open({ type: 'ERROR', msg: T.F.REMINDER.S_REMINDER_ERR });
  }
}
