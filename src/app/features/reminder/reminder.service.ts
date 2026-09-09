import { inject, Injectable } from '@angular/core';
import { SnackService } from '../../core/snack/snack.service';
import { combineLatest, Observable, Subject } from 'rxjs';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { T } from '../../t.const';
import { distinctUntilChanged, filter, map, skipUntil } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Log } from '../../core/log';
import { GlobalConfigService } from '../config/global-config.service';
import { Store } from '@ngrx/store';
import {
  selectAllTasksWithReminder,
  selectAllTasksWithDeadlineReminder,
} from '../tasks/store/task.selectors';
import { Task, TaskWithReminder, TaskWithReminderData } from '../tasks/task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';

// How long the reminder modal stays closed for a reminder the user dismissed
// without acting on it (backdrop / Escape / Android back). The reminder itself
// stays active and re-nudges once this elapses (or on the next cold start) —
// this only throttles the modal so an overdue reminder cannot re-grab the
// screen on every worker tick (~10s) and freeze the app. Long enough to use the
// app, short enough that the reminder does not feel forgotten.
export const REMINDER_DISMISS_UI_COOLDOWN_MS = 5 * 60 * 1000;

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

  // Session-only UI cooldown (see REMINDER_DISMISS_UI_COOLDOWN_MS), keyed per
  // reminder OCCURRENCE (taskId + remindAt). Occurrence-keying means a
  // reschedule produces a fresh remindAt that is not suppressed, and a task's
  // schedule vs deadline reminders never share a cooldown. Never persisted or
  // synced — a pure presentation throttle; cleared on cold start.
  private _uiSuppressedUntil = new Map<string, number>();

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
          Log.log('Updated reminders in worker', { reminderCount: reminders.length });
        }
      });
  }

  /**
   * Throttle re-opening the reminder modal for a reminder occurrence the user
   * dismissed without acting on it (backdrop / Escape / Android back).
   */
  suppressReminderUiAfterDismiss(taskId: string, remindAt: number): void {
    this._uiSuppressedUntil.set(
      this._uiCooldownKey(taskId, remindAt),
      Date.now() + REMINDER_DISMISS_UI_COOLDOWN_MS,
    );
  }

  /** Whether the reminder modal should currently stay closed for this occurrence. */
  isReminderUiSuppressed(
    taskId: string,
    remindAt: number,
    now: number = Date.now(),
  ): boolean {
    const key = this._uiCooldownKey(taskId, remindAt);
    const until = this._uiSuppressedUntil.get(key);
    if (until === undefined) {
      return false;
    }
    if (until <= now) {
      this._uiSuppressedUntil.delete(key);
      return false;
    }
    return true;
  }

  private _uiCooldownKey(taskId: string, remindAt: number): string {
    return `${taskId}_${remindAt}`;
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
    Log.log(`ReminderService: Worker activated ${reminders.length} reminder(s)`);

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

  private _updateRemindersInWorker(reminders: WorkerReminder[]): void {
    this._w.postMessage(reminders);
  }

  private _handleError(err: unknown): void {
    Log.err(err);
    this._snackService.open({ type: 'ERROR', msg: T.F.REMINDER.S_REMINDER_ERR });
  }
}
