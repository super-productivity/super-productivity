import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';
import { combineLatest, Observable, timer } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { Log } from '../../../core/log';
import { T } from '../../../t.const';
import { generateNotificationId } from '../../android/android-notification-id.util';
import { Store } from '@ngrx/store';
import {
  selectAllTasksWithReminder,
  selectAllTasksWithDeadlineReminder,
  selectUndoneTasksWithDueDayNoReminder,
} from '../../tasks/store/task.selectors';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { ReminderConfig } from '../../config/global-config.model';
import {
  selectActiveTaskRepeatCfgs,
  selectTaskRepeatCfgsForExactDay,
} from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getRepeatableTaskId } from '../../task-repeat-cfg/get-repeatable-task-id.util';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { remindOptionToMilliseconds } from '../../tasks/util/remind-option-to-milliseconds';
import { getDbDateStr } from '../../../util/get-db-date-str';

const DELAY_PERMISSIONS = 2000;
const DELAY_SCHEDULE = 5000;

// How many days ahead we pre-schedule recurring reminders for. Covers the
// acute case (daily/weekly configs whose next occurrence is days away) while
// keeping the number of native alarms bounded (one per config). Longer-period
// configs (e.g. monthly) are picked up the next time the app is opened within
// this window. See #7850.
const REPEAT_LOOKAHEAD_DAYS = 14;

// Upper bound on how many recurring reminders we pre-schedule in one pass.
// iOS caps pending local notifications at 64 GLOBALLY (across every reminder
// effect), silently dropping the rest, and it keeps the soonest-firing ones.
// We pre-schedule at most one occurrence per config, so this only bites a user
// with an unusually large number of timed recurring tasks — but when it does we
// want to deterministically keep the most imminent ones (matching iOS's own
// keep-soonest behaviour) and leave headroom for the live/due-date effects,
// rather than letting the OS choose for us. Truncation is logged, never silent.
const REPEAT_MAX_SCHEDULED = 32;

// Settle window for the recurring-reminder scheduler. Instance creation
// dispatches addTask → updateTaskRepeatCfg → scheduleTaskWithTime back-to-back,
// which the store surfaces as several intermediate emissions. Debouncing
// collapses that burst so the effect only ever evaluates the SETTLED state —
// otherwise it can observe the transient "config advanced but remindAt not yet
// set" state and cancel an alarm that is about to graduate into a real instance.
const REPEAT_RESCHEDULE_DEBOUNCE = 1000;

@Injectable()
export class MobileNotificationEffects {
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _reminderService = inject(CapacitorReminderService);
  private _platformService = inject(CapacitorPlatformService);
  private _globalConfigService = inject(GlobalConfigService);
  // Single-shot guard so we don't spam the user with duplicate warnings.
  private _hasShownNotificationWarning = false;
  // Track scheduled reminder IDs to cancel removed ones
  private _scheduledReminderIds = new Set<string>();
  // Track scheduled due-date notification IDs separately
  private _scheduledDueDateIds = new Set<string>();
  // Track scheduled deadline reminder IDs separately
  private _scheduledDeadlineIds = new Set<string>();
  // Track pre-scheduled recurring reminder IDs (the predicted task instance IDs)
  private _scheduledRepeatReminderIds = new Set<string>();
  // One-shot guard: the Android exact-alarm check runs at most once per session.
  // See _warnIfExactAlarmPermissionDeniedOnce().
  private _exactAlarmPermissionCheckPromise?: Promise<void>;

  // Narrowed cfg slice so the scheduling effects only re-run on reminder-config
  // changes, not on every unrelated global-config edit (theme, sync, etc.).
  // Reference equality is sufficient: NgRx reducers preserve slice references
  // when that slice is untouched.
  private _reminderCfg$: Observable<ReminderConfig | undefined> =
    this._globalConfigService.cfg$.pipe(
      map((c) => c?.reminder),
      distinctUntilChanged(),
    );

  /**
   * Check notification permissions on startup for mobile platforms.
   * Shows a warning if permissions are not granted.
   */
  askPermissionsIfNotGiven$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_PERMISSIONS).pipe(
          tap(async () => {
            try {
              // Read the permission STATE without prompting. The OS dialog is
              // requested lazily on the first real schedule (see
              // CapacitorReminderService.initialize()), which yields better grant
              // rates than an unprompted launch-time prompt. Only nag here when
              // the user has *explicitly* denied — 'prompt' means we simply
              // haven't asked yet, so stay silent and let the lazy prompt run
              // when a reminder actually needs scheduling. (#8120)
              const permissionState = await this._reminderService.getPermissionState();
              Log.log('MobileEffects: initial permission check', { permissionState });
              if (permissionState === 'denied') {
                this._notifyPermissionIssue();
                return;
              }
              if (permissionState !== 'granted') {
                // Not asked yet — defer the prompt and the exact-alarm check
                // until a notification actually needs scheduling.
                return;
              }
              await this._warnIfExactAlarmPermissionDeniedOnce();
            } catch (error) {
              Log.err(error);
              this._notifyPermissionIssue(error?.toString());
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  /**
   * Schedule reminders for tasks with remindAt set.
   * Works on both iOS and Android.
   *
   * SYNC-SAFE: This effect is intentionally safe during sync/hydration because:
   * - dispatch: false - no store mutations, only native API calls
   * - We WANT notifications scheduled for synced tasks (user-facing functionality)
   * - Native scheduling calls are idempotent - rescheduling the same reminder is harmless
   * - Cancellation of removed reminders correctly handles tasks deleted via sync
   * - Reacts to reminder-config changes (disableReminders) so the master toggle
   *   takes effect immediately; unrelated cfg changes are filtered via _reminderCfg$
   */
  scheduleNotifications$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() =>
            combineLatest([
              this._store.select(selectAllTasksWithReminder),
              this._reminderCfg$,
            ]),
          ),
          tap(async ([tasksWithReminders, reminderCfg]) => {
            try {
              // Without this, alarms scheduled on prior ticks keep firing on Android
              // via AlarmManager even after the user disables reminders.
              if (reminderCfg?.disableReminders) {
                for (const previousId of this._scheduledReminderIds) {
                  const notificationId = generateNotificationId(previousId);
                  await this._reminderService.cancelReminder(notificationId);
                }
                this._scheduledReminderIds.clear();
                return;
              }

              const currentReminderIds = new Set(
                (tasksWithReminders || []).map((t) => t.id),
              );

              // Cancel reminders that are no longer in the list
              for (const previousId of this._scheduledReminderIds) {
                if (!currentReminderIds.has(previousId)) {
                  const notificationId = generateNotificationId(previousId);
                  Log.log('MobileEffects: cancelling removed reminder', {
                    relatedId: previousId,
                    notificationId,
                  });
                  await this._reminderService.cancelReminder(notificationId);
                }
              }

              if (!tasksWithReminders || tasksWithReminders.length === 0) {
                this._scheduledReminderIds.clear();
                return;
              }

              Log.log('MobileEffects: scheduling reminders', {
                reminderCount: tasksWithReminders.length,
                platform: this._platformService.platform,
              });

              // Ensure permissions are granted
              const hasPermission = await this._reminderService.ensurePermissions();
              if (!hasPermission) {
                this._notifyPermissionIssue();
                return;
              }
              await this._warnIfExactAlarmPermissionDeniedOnce();

              // Schedule each reminder using the platform-appropriate method
              for (const task of tasksWithReminders) {
                // Skip reminders that are already in the past (already fired)
                // These will be handled by the dialog when the user opens the app
                if (task.remindAt! < Date.now()) {
                  continue;
                }

                const id = generateNotificationId(task.id);
                await this._reminderService.scheduleReminder({
                  notificationId: id,
                  reminderId: task.id,
                  relatedId: task.id,
                  title: task.title,
                  reminderType: 'TASK',
                  triggerAtMs: task.remindAt!,
                });
              }

              // Update tracked IDs
              this._scheduledReminderIds = currentReminderIds;

              Log.log('MobileEffects: scheduled reminders', {
                reminderCount: tasksWithReminders.length,
                platform: this._platformService.platform,
              });
            } catch (error) {
              Log.err(error);
              this._notifyPermissionIssue(error?.toString());
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  /**
   * Pre-schedule native reminders for UPCOMING timed recurring task occurrences,
   * before their task instances exist (#7850).
   *
   * Why this is needed: recurring task instances are created by foreground NgRx
   * logic on logical-day changes (TaskDueEffects). While the mobile app is
   * closed the JS runtime is frozen, so that logic never runs and the next
   * occurrence's `remindAt` task — the entity scheduleNotifications$ keys off —
   * is never created. The OS alarm therefore never gets registered and the
   * notification is missed.
   *
   * We schedule directly from the repeat configs using the SAME deterministic
   * task id (`rpt_<cfgId>_<dayStr>`), and therefore the SAME notification id,
   * that scheduleNotifications$ will use once the real instance materialises.
   * The two paths are thus idempotent: when the instance is created the alarm
   * is simply overwritten — never doubled.
   *
   * SYNC-SAFE: same rationale as scheduleNotifications$ — dispatch:false (no
   * store mutations), native calls only, idempotent scheduling.
   *
   * The debounce is load-bearing for correctness, not just throttling: it lets
   * the effect skip the transient mid-creation states so the live-reminder guard
   * below never cancels an about-to-graduate alarm (see REPEAT_RESCHEDULE_DEBOUNCE).
   */
  scheduleRepeatReminders$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() =>
            combineLatest([
              this._store.select(selectActiveTaskRepeatCfgs),
              this._store.select(selectAllTasksWithReminder),
              this._reminderCfg$,
            ]),
          ),
          debounceTime(REPEAT_RESCHEDULE_DEBOUNCE),
          tap(async ([cfgs, tasksWithReminders, reminderCfg]) => {
            try {
              if (reminderCfg?.disableReminders) {
                for (const previousId of this._scheduledRepeatReminderIds) {
                  await this._reminderService.cancelReminder(
                    generateNotificationId(previousId),
                  );
                }
                this._scheduledRepeatReminderIds.clear();
                return;
              }

              const upcoming = this._getUpcomingRepeatReminders(cfgs, Date.now());
              const currentIds = new Set(upcoming.map((u) => u.taskId));

              // IDs whose real instance already exists with a live reminder.
              // scheduleNotifications$ owns those alarms under the SAME
              // notification id, so we must NOT cancel them when they leave our
              // upcoming set (which happens the moment an occurrence's instance
              // is created) — doing so would kill a live reminder.
              const liveReminderIds = new Set(
                (tasksWithReminders || []).map((t) => t.id),
              );

              for (const previousId of this._scheduledRepeatReminderIds) {
                if (!currentIds.has(previousId) && !liveReminderIds.has(previousId)) {
                  await this._reminderService.cancelReminder(
                    generateNotificationId(previousId),
                  );
                }
              }

              if (upcoming.length === 0) {
                this._scheduledRepeatReminderIds.clear();
                return;
              }

              const hasPermission = await this._reminderService.ensurePermissions();
              if (!hasPermission) {
                this._notifyPermissionIssue();
                return;
              }
              await this._warnIfExactAlarmPermissionDeniedOnce();

              for (const occ of upcoming) {
                await this._reminderService.scheduleReminder({
                  notificationId: generateNotificationId(occ.taskId),
                  reminderId: occ.taskId,
                  relatedId: occ.taskId,
                  title: occ.title,
                  reminderType: 'TASK',
                  triggerAtMs: occ.triggerAtMs,
                });
              }

              this._scheduledRepeatReminderIds = currentIds;

              Log.log('MobileEffects: scheduled repeat reminders', {
                count: upcoming.length,
              });
            } catch (error) {
              Log.err(error);
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  /**
   * Schedule due-date notifications for tasks with dueDay but no remindAt.
   * Fires at the configured hour (default 9 AM).
   */
  scheduleDueDateNotifications$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() =>
            combineLatest([
              this._store.select(selectUndoneTasksWithDueDayNoReminder),
              this._reminderCfg$,
            ]),
          ),
          tap(async ([tasks, reminderCfg]) => {
            try {
              const notifyOnDueDate = reminderCfg?.notifyOnDueDate ?? true;
              const disableReminders = reminderCfg?.disableReminders ?? false;
              const dueDateHour = Math.floor(
                Math.max(0, Math.min(23, reminderCfg?.dueDateNotificationHour ?? 9)),
              );

              // If disabled (by master switch or per-category), cancel previously
              // scheduled due-date notifications and short-circuit.
              if (disableReminders || !notifyOnDueDate) {
                for (const previousId of this._scheduledDueDateIds) {
                  const notificationId = generateNotificationId(previousId + '_dueday');
                  await this._reminderService.cancelReminder(notificationId);
                }
                this._scheduledDueDateIds.clear();
                return;
              }

              const currentDueDateIds = new Set((tasks || []).map((t) => t.id));

              // Cancel due-date notifications for tasks no longer in the list
              for (const previousId of this._scheduledDueDateIds) {
                if (!currentDueDateIds.has(previousId)) {
                  const notificationId = generateNotificationId(previousId + '_dueday');
                  await this._reminderService.cancelReminder(notificationId);
                }
              }

              if (!tasks || tasks.length === 0) {
                this._scheduledDueDateIds.clear();
                return;
              }

              const hasPermission = await this._reminderService.ensurePermissions();
              if (!hasPermission) {
                return;
              }
              await this._warnIfExactAlarmPermissionDeniedOnce();

              const now = Date.now();
              for (const task of tasks) {
                // Build trigger time: dueDay at configured hour, local timezone
                const triggerDate = new Date(
                  task.dueDay + 'T' + String(dueDateHour).padStart(2, '0') + ':00:00',
                );
                const triggerAtMs = triggerDate.getTime();

                // Skip if in the past
                if (triggerAtMs <= now) {
                  continue;
                }

                const id = generateNotificationId(task.id + '_dueday');
                await this._reminderService.scheduleReminder({
                  notificationId: id,
                  reminderId: task.id,
                  relatedId: task.id,
                  title: task.title,
                  reminderType: 'DUE_DATE',
                  triggerAtMs,
                });
              }

              this._scheduledDueDateIds = currentDueDateIds;

              Log.log('MobileEffects: scheduled due-date notifications', {
                count: tasks.length,
              });
            } catch (error) {
              Log.err(error);
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  /**
   * Schedule explicit deadline reminders on iOS.
   *
   * SYNC-SAFE: Same rationale as scheduleNotifications$ above — dispatch:false
   * (no store mutations), idempotent native scheduling, and we deliberately want
   * deadline reminders scheduled for synced tasks. Cancellations are driven by
   * the selector diff against `_scheduledDeadlineIds`.
   */
  scheduleDeadlineNotifications$ =
    this._platformService.isNative &&
    this._platformService.isIOS() &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() =>
            combineLatest([
              this._store.select(selectAllTasksWithDeadlineReminder),
              this._reminderCfg$,
            ]),
          ),
          tap(async ([tasks, reminderCfg]) => {
            try {
              if (reminderCfg?.disableReminders) {
                for (const previousId of this._scheduledDeadlineIds) {
                  const notificationId = generateNotificationId(previousId + '_deadline');
                  await this._reminderService.cancelReminder(notificationId);
                }
                this._scheduledDeadlineIds.clear();
                return;
              }

              const currentDeadlineIds = new Set((tasks || []).map((t) => t.id));

              for (const previousId of this._scheduledDeadlineIds) {
                if (!currentDeadlineIds.has(previousId)) {
                  const notificationId = generateNotificationId(previousId + '_deadline');
                  await this._reminderService.cancelReminder(notificationId);
                }
              }

              if (!tasks || tasks.length === 0) {
                this._scheduledDeadlineIds.clear();
                return;
              }

              const hasPermission = await this._reminderService.ensurePermissions();
              if (!hasPermission) {
                return;
              }
              await this._warnIfExactAlarmPermissionDeniedOnce();

              const now = Date.now();
              for (const task of tasks) {
                if (!task.deadlineRemindAt || task.deadlineRemindAt <= now) {
                  if (this._scheduledDeadlineIds.has(task.id)) {
                    await this._reminderService.cancelReminder(
                      generateNotificationId(task.id + '_deadline'),
                    );
                  }
                  continue;
                }

                const id = generateNotificationId(task.id + '_deadline');
                await this._reminderService.scheduleReminder({
                  notificationId: id,
                  reminderId: task.id + '_deadline',
                  relatedId: task.id,
                  title: task.title,
                  reminderType: 'DEADLINE',
                  triggerAtMs: task.deadlineRemindAt,
                });
              }

              this._scheduledDeadlineIds = currentDeadlineIds;

              Log.log('MobileEffects: scheduled deadline reminders', {
                count: tasks.length,
              });
            } catch (error) {
              Log.err(error);
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  /**
   * For each active timed recurring config, find its NEXT occurrence within the
   * lookahead window that still needs a reminder, and compute its deterministic
   * task id + native trigger time.
   *
   * Reuses selectTaskRepeatCfgsForExactDay's projector per day so the
   * isPaused / already-created / deletedInstanceDates / archived-project guards
   * stay in lockstep with the instance-creation path. Time computation mirrors
   * TaskRepeatCfgService exactly so the pre-scheduled trigger matches the one
   * the real instance would get.
   */
  private _getUpcomingRepeatReminders(
    activeCfgs: TaskRepeatCfg[],
    now: number,
  ): { taskId: string; triggerAtMs: number; title: string }[] {
    const result: { taskId: string; triggerAtMs: number; title: string }[] = [];
    const foundCfgIds = new Set<string>();

    // Anchor each day at noon to keep the per-day timestamp clear of DST /
    // midnight edges; getDbDateStr/getDateTimeFromClockString only use the date.
    const baseDay = new Date(now);
    baseDay.setHours(12, 0, 0, 0);

    for (let dayOffset = 0; dayOffset <= REPEAT_LOOKAHEAD_DAYS; dayOffset++) {
      const day = new Date(baseDay);
      day.setDate(baseDay.getDate() + dayOffset);
      const dayMs = day.getTime();

      const dueCfgs = selectTaskRepeatCfgsForExactDay.projector(activeCfgs, {
        dayDate: dayMs,
      });

      for (const cfg of dueCfgs) {
        const cfgId = cfg.id as string;
        if (foundCfgIds.has(cfgId)) {
          continue;
        }
        // waitForCompletion: the next instance only exists once the current one
        // is completed, so its occurrence cannot be reliably pre-scheduled.
        if (cfg.waitForCompletion) {
          continue;
        }
        if (!isValidSplitTime(cfg.startTime) || !cfg.remindAt) {
          continue;
        }

        const dueMs = getDateTimeFromClockString(cfg.startTime, dayMs);
        const triggerAtMs = remindOptionToMilliseconds(dueMs, cfg.remindAt);
        if (typeof triggerAtMs !== 'number' || triggerAtMs <= now) {
          continue;
        }

        foundCfgIds.add(cfgId);
        result.push({
          taskId: getRepeatableTaskId(cfgId, getDbDateStr(dayMs)),
          triggerAtMs,
          title: cfg.title || '',
        });
      }
    }

    // Keep the soonest-firing occurrences when over the cap (see
    // REPEAT_MAX_SCHEDULED). The day loop already yields roughly ascending
    // order, but sort explicitly so the cap is deterministic.
    result.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
    if (result.length > REPEAT_MAX_SCHEDULED) {
      Log.log('MobileEffects: capping pre-scheduled repeat reminders', {
        total: result.length,
        cap: REPEAT_MAX_SCHEDULED,
      });
      return result.slice(0, REPEAT_MAX_SCHEDULED);
    }

    return result;
  }

  /**
   * Run the Android exact-alarm check at most once per app session, warning the
   * user when it is denied. Memoized via `_exactAlarmPermissionCheckPromise` so
   * the underlying `ensureExactAlarmPermission()` — which can open the Android
   * system settings page — never re-fires across the many scheduling effects
   * that call this. A later in-session grant is intentionally not re-detected
   * (it resets next launch); the trade-off avoids repeatedly opening that page.
   *
   * Gated on `isAndroid()`, the superset of native + legacy WebView: on legacy
   * WebView `ensureExactAlarmPermission()` self-guards and returns true, so no
   * spurious warning fires there.
   */
  private _warnIfExactAlarmPermissionDeniedOnce(): Promise<void> {
    if (!this._platformService.isAndroid()) {
      return Promise.resolve();
    }

    this._exactAlarmPermissionCheckPromise =
      this._exactAlarmPermissionCheckPromise ||
      this._reminderService
        .ensureExactAlarmPermission()
        .then((hasExactAlarm) => {
          if (!hasExactAlarm) {
            this._snackService.open({
              type: 'ERROR',
              msg: T.NOTIFICATION.EXACT_ALARM_DENIED,
            });
          }
        })
        // `ensureExactAlarmPermission()` swallows its own errors today, but keep
        // a resolving catch so a future throw can't cache a rejected promise
        // here (which every scheduling effect would then re-await). Log-only: a
        // thrown check is not an explicit denial, so don't show the snack.
        .catch((error: unknown) => {
          Log.warn('MobileEffects: exact alarm permission check failed', error);
        });

    return this._exactAlarmPermissionCheckPromise;
  }

  private _notifyPermissionIssue(message?: string): void {
    if (this._hasShownNotificationWarning) {
      return;
    }
    this._hasShownNotificationWarning = true;
    // Fallback snackbar so the user gets feedback even when the native APIs throw.
    this._snackService.open({
      type: 'ERROR',
      msg:
        message ||
        'Notification permission not granted. Please enable notifications in your device settings for reminders to work.',
    });
  }
}
