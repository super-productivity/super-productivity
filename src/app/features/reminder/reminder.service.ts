import { nanoid } from 'nanoid';
import { inject, Injectable } from '@angular/core';
import { RecurringConfig, Reminder, ReminderCopy, ReminderType } from './reminder.model';
import { SnackService } from '../../core/snack/snack.service';
import { BehaviorSubject, Observable, ReplaySubject, Subject } from 'rxjs';
import { dirtyDeepCopy } from '../../util/dirtyDeepCopy';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { TaskService } from '../tasks/task.service';
import { Task } from '../tasks/task.model';
import { NoteService } from '../note/note.service';
import { T } from '../../t.const';
import { filter, first, skipUntil } from 'rxjs/operators';
import { devError } from '../../util/dev-error';
import { Note } from '../note/note.model';
import { environment } from '../../../environments/environment';
import { PfapiService } from '../../pfapi/pfapi.service';
import { Log } from '../../core/log';
import { GlobalConfigService } from '../config/global-config.service';

@Injectable({
  providedIn: 'root',
})
export class ReminderService {
  private readonly _pfapiService = inject(PfapiService);
  private readonly _snackService = inject(SnackService);
  private readonly _taskService = inject(TaskService);
  private readonly _noteService = inject(NoteService);
  private readonly _imexMetaService = inject(ImexViewService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  private _onRemindersActive$: Subject<Reminder[]> = new Subject<Reminder[]>();
  onRemindersActive$: Observable<Reminder[]> = this._onRemindersActive$.pipe(
    skipUntil(
      this._imexMetaService.isDataImportInProgress$.pipe(
        filter((isInProgress) => !isInProgress),
      ),
    ),
  );

  private _reminders$: ReplaySubject<Reminder[]> = new ReplaySubject(1);
  reminders$: Observable<Reminder[]> = this._reminders$.asObservable();

  private _onReloadModel$: Subject<Reminder[]> = new Subject();
  onReloadModel$: Observable<Reminder[]> = this._onReloadModel$.asObservable();

  private _isRemindersLoaded$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false,
  );

  private _w: Worker;
  private _reminders: Reminder[] = [];
  // Track recently processed reminder IDs to prevent duplicate emissions from worker race condition
  private _recentlyProcessedReminderIds = new Set<string>();
  private _cleanupTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    // this._triggerPauseAfterUpdate$.subscribe((v) => Log.log('_triggerPauseAfterUpdate$', v));
    // this._pauseAfterUpdate$.subscribe((v) => Log.log('_pauseAfterUpdate$', v));
    // this._onRemindersActive$.subscribe((v) => Log.log('_onRemindersActive$', v));
    // this.onRemindersActive$.subscribe((v) => Log.log('onRemindersActive$', v));

    if (typeof (Worker as any) === 'undefined') {
      throw new Error('No service workers supported :(');
    }

    this._w = new Worker(new URL('./reminder.worker', import.meta.url), {
      name: 'reminder',
      type: 'module',
    });
  }

  async init(): Promise<void> {
    this._w.addEventListener('message', this._onReminderActivated.bind(this));
    this._w.addEventListener('error', this._handleError.bind(this));
    await this.reloadFromDatabase();
    this._isRemindersLoaded$.next(true);
  }

  async reloadFromDatabase(): Promise<void> {
    const fromDb = await this._loadFromDatabase();
    if (!fromDb || !Array.isArray(fromDb)) {
      this._saveModel([]);
    }
    this._reminders = await this._loadFromDatabase();
    if (!Array.isArray(this._reminders)) {
      Log.log(this._reminders);
      devError('Something went wrong with the reminders');
      this._reminders = [];
    }

    this._updateRemindersInWorker(this._reminders);
    this._onReloadModel$.next(this._reminders);
    this._reminders$.next(this._reminders);
    if (environment.production) {
      Log.log('loaded reminders from database', this._reminders);
    }
  }

  // TODO maybe refactor to observable, because models can differ to sync value for yet unknown reasons
  getById(reminderId: string): ReminderCopy | null {
    const _foundReminder =
      this._reminders && this._reminders.find((reminder) => reminder.id === reminderId);
    return !!_foundReminder ? dirtyDeepCopy<ReminderCopy>(_foundReminder) : null;
  }

  getByRelatedId(relatedId: string): ReminderCopy | null {
    const _foundReminder =
      this._reminders &&
      this._reminders.find((reminder) => reminder.relatedId === relatedId);
    return !!_foundReminder ? dirtyDeepCopy<ReminderCopy>(_foundReminder) : null;
  }

  addReminder(
    type: ReminderType,
    relatedId: string,
    title: string,
    remindAt: number,
    recurringConfig?: RecurringConfig,
    isWaitForReady: boolean = false,
  ): string {
    // make sure that there is always only a single reminder with a particular relatedId as there might be race conditions
    this.removeReminderByRelatedIdIfSet(relatedId);

    const id = nanoid();
    const existingInstanceForEntry = this.getByRelatedId(relatedId);
    if (existingInstanceForEntry) {
      devError('A reminder for this ' + type + ' already exists');
      this.updateReminder(existingInstanceForEntry.id, {
        relatedId,
        title,
        remindAt,
        type,
        recurringConfig,
      });
      return existingInstanceForEntry.id;
    } else {
      // TODO find out why we need to do this
      this._reminders = dirtyDeepCopy(this._reminders);
      this._reminders.push({
        id,
        relatedId,
        title,
        remindAt,
        type,
        recurringConfig,
      });
      // Update worker immediately to prevent race condition with 10s check interval
      this._updateRemindersInWorker(this._reminders);
      this._saveModel(this._reminders, isWaitForReady);
      return id;
    }
  }

  snooze(reminderId: string, snoozeTime: number): void {
    const remindAt = new Date().getTime() + snoozeTime;
    this.updateReminder(reminderId, { remindAt });
  }

  updateReminder(reminderId: string, reminderChanges: Partial<Reminder>): void {
    const i = this._reminders.findIndex((reminder) => reminder.id === reminderId);
    if (i > -1) {
      // TODO find out why we need to do this
      this._reminders = dirtyDeepCopy(this._reminders);
      this._reminders[i] = Object.assign({}, this._reminders[i], reminderChanges);
      // Update worker immediately to prevent race condition with 10s check interval
      this._updateRemindersInWorker(this._reminders);
      // Clear from processed set so snooze can trigger notification at new time
      this._clearProcessedReminder(reminderId);
    }
    this._saveModel(this._reminders);
  }

  removeReminder(reminderIdToRemove: string): void {
    const i = this._reminders.findIndex((reminder) => reminder.id === reminderIdToRemove);

    if (i > -1) {
      // TODO find out why we need to do this
      this._reminders = dirtyDeepCopy(this._reminders);
      this._reminders.splice(i, 1);
      // Update worker immediately to prevent race condition with 10s check interval
      this._updateRemindersInWorker(this._reminders);
      // Clean up tracking state
      this._clearProcessedReminder(reminderIdToRemove);
      this._saveModel(this._reminders);
    } else {
      // throw new Error('Unable to find reminder with id ' + reminderIdToRemove);
    }
  }

  removeReminderByRelatedIdIfSet(relatedId: string): void {
    const reminder = this._reminders.find(
      (reminderIN) => reminderIN.relatedId === relatedId,
    );
    if (reminder) {
      this.removeReminder(reminder.id);
    }
  }

  removeRemindersByRelatedIds(relatedIds: string[]): void {
    const reminders = this._reminders.filter((reminderIN) =>
      relatedIds.includes(reminderIN.relatedId),
    );
    if (reminders && reminders.length) {
      reminders.forEach((reminder) => {
        this.removeReminder(reminder.id);
      });
    }
  }

  private async _onReminderActivated(msg: MessageEvent): Promise<void> {
    const reminders = msg.data as Reminder[];
    Log.log(`ReminderService: Worker activated  ${reminders.length} reminder(s)`);

    if (this._globalConfigService.cfg()?.reminder?.disableReminders) {
      Log.log('ReminderService: reminders are disabled, not sending to UI');
      return;
    }

    const remindersWithData = await Promise.all(
      reminders.map(async (reminder) => {
        const relatedModel = await this._getRelatedDataForReminder(reminder);
        // Log.log('RelatedModel for Reminder', relatedModel);
        // only show when not currently syncing and related model still exists
        if (!relatedModel) {
          Log.warn(
            `ReminderService: No related data found for reminder ${reminder.id} (${reminder.type}: ${reminder.relatedId}), removing...`,
          );
          this.removeReminder(reminder.id);
          return null;
        } else {
          // Check if task is already done (defensive check)
          if (reminder.type === 'TASK' && (relatedModel as Task).isDone) {
            Log.warn(
              `ReminderService: Task ${relatedModel.id} is already done but reminder ${reminder.id} still exists, removing...`,
            );
            this.removeReminder(reminder.id);
            return null;
          }
          return reminder;
        }
      }),
    );
    const validReminders = remindersWithData.filter(
      (reminder): reminder is Reminder => !!reminder,
    );

    // Filter out reminders that were recently processed to prevent duplicate notifications
    // from worker race conditions (worker may emit same reminder before state update reaches it)
    const finalReminders = validReminders.filter(
      (reminder) => !this._recentlyProcessedReminderIds.has(reminder.id),
    );

    Log.log(`ReminderService: ${finalReminders.length} valid reminder(s) to show`);
    if (finalReminders.length > 0) {
      // Mark these reminders as processed
      finalReminders.forEach((reminder) => {
        this._markReminderAsProcessed(reminder.id);
      });
      this._onRemindersActive$.next(finalReminders);
    }
  }

  private async _loadFromDatabase(): Promise<Reminder[]> {
    return (await this._pfapiService.m.reminders.load()) || [];
  }

  private async _saveModel(
    reminders: Reminder[],
    isWaitForReady: boolean = false,
  ): Promise<void> {
    if (isWaitForReady) {
      await this._isRemindersLoaded$
        .pipe(
          filter((v) => !!v),
          first(),
        )
        .toPromise();
    } else if (!this._isRemindersLoaded$.getValue()) {
      throw new Error('Reminders not loaded initially when trying to save model');
    }
    Log.log('saveReminders', reminders);
    await this._pfapiService.m.reminders.save(reminders, {
      isUpdateRevAndLastUpdate: true,
    });
    this._updateRemindersInWorker(this._reminders);
    this._reminders$.next(this._reminders);
  }

  private _updateRemindersInWorker(reminders: Reminder[]): void {
    this._w.postMessage(reminders);
  }

  private _handleError(err: unknown): void {
    Log.err(err);
    this._snackService.open({ type: 'ERROR', msg: T.F.REMINDER.S_REMINDER_ERR });
  }

  private async _getRelatedDataForReminder(reminder: Reminder): Promise<Task | Note> {
    switch (reminder.type) {
      case 'NOTE':
        return await this._noteService.getByIdOnce$(reminder.relatedId).toPromise();
      case 'TASK':
        // NOTE: remember we don't want archive tasks to pop up here
        return await this._taskService.getByIdOnce$(reminder.relatedId).toPromise();
    }

    throw new Error('Cannot get related model for reminder');
  }

  private _markReminderAsProcessed(reminderId: string): void {
    this._recentlyProcessedReminderIds.add(reminderId);

    // Clear any existing cleanup timeout for this ID
    const existingTimeout = this._cleanupTimeouts.get(reminderId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Auto-cleanup after 60 seconds to prevent memory leaks
    const timeoutId = setTimeout(() => {
      this._recentlyProcessedReminderIds.delete(reminderId);
      this._cleanupTimeouts.delete(reminderId);
    }, 60000);
    this._cleanupTimeouts.set(reminderId, timeoutId);
  }

  private _clearProcessedReminder(reminderId: string): void {
    this._recentlyProcessedReminderIds.delete(reminderId);
    const existingTimeout = this._cleanupTimeouts.get(reminderId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this._cleanupTimeouts.delete(reminderId);
    }
  }
}
