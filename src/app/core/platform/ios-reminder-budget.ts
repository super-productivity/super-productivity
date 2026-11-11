import { Log } from '../log';
import type { ScheduleReminderOptions } from './capacitor-reminder.service';

/**
 * How many reminders the app keeps pending on iOS.
 *
 * iOS holds at most 64 pending local notifications per app. Past that it drops
 * the ones added first, whatever their fire time (measured in the Simulator,
 * see tools/ios-sim-reminders), so a reminder due tomorrow can lose its slot
 * to one due next year. The app therefore stays under the limit itself and
 * picks what is armed: the soonest.
 *
 * shortcut: 4 slots stay free for notifications that are not reminders (focus
 * session end, immediate ones) — subtract what getPending() shows if more
 * kinds appear.
 */
export const IOS_REMINDER_BUDGET = 60;

// Collects the calls of one scheduling pass (and of the four effects starting
// together) into a single plan.
const RECONCILE_DEBOUNCE_MS = 250;

export interface IosReminderBudgetDeps {
  /** Hands one reminder to iOS; resolves false if it was not accepted. */
  schedule: (reminder: ScheduleReminderOptions) => Promise<boolean>;
  /** Resolves false if iOS did not confirm the cancel. */
  cancel: (notificationIds: number[]) => Promise<boolean>;
  /** Ids iOS still holds from an earlier app run. */
  getPendingIds: () => Promise<number[]>;
  /**
   * Called after each pass with the fire time of the last armed reminder while
   * the budget is full (nothing later is armed), else null.
   */
  onPlanned: (horizonAtMs: number | null) => void;
}

export interface IosReminderBudget {
  /** The app wants this reminder; it is armed while it is among the soonest. */
  want: (reminder: ScheduleReminderOptions) => void;
  /** The app no longer wants this reminder. */
  unwant: (notificationId: number) => void;
}

/** The `budget` soonest reminders, soonest first. */
export const pickSoonest = (
  wanted: ScheduleReminderOptions[],
  budget: number,
): ScheduleReminderOptions[] =>
  [...wanted]
    // The id breaks ties so the pick does not depend on call order.
    .sort((a, b) => a.triggerAtMs - b.triggerAtMs || a.notificationId - b.notificationId)
    .slice(0, budget);

const isSame = (a: ScheduleReminderOptions, b: ScheduleReminderOptions): boolean =>
  a.triggerAtMs === b.triggerAtMs &&
  a.title === b.title &&
  a.reminderType === b.reminderType &&
  a.reminderId === b.reminderId &&
  a.relatedId === b.relatedId;

/**
 * Keeps iOS holding exactly the soonest wanted reminders, and talks to iOS only
 * about what changed: the scheduling effects ask for every reminder again on
 * each store change.
 */
export const createIosReminderBudget = (
  deps: IosReminderBudgetDeps,
  budget: number = IOS_REMINDER_BUDGET,
): IosReminderBudget => {
  const wanted = new Map<number, ScheduleReminderOptions>();
  // What iOS holds; null for one left by an earlier run, whose content is unknown.
  const armed = new Map<number, ScheduleReminderOptions | null>();
  const unwanted = new Set<number>();
  let hasLoadedPending = false;
  let isRunning = false;
  let isDirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const loadPendingOnce = async (): Promise<void> => {
    if (hasLoadedPending) {
      return;
    }
    // Not cancelled wholesale: a slower effect may still ask for these.
    (await deps.getPendingIds()).forEach((id) => armed.set(id, null));
    hasLoadedPending = true;
  };

  // A reminder that fired left iOS's pending list: it frees its slot and must
  // not be armed again.
  const forgetFired = (): void => {
    const now = Date.now();
    for (const [id, reminder] of wanted) {
      if (
        reminder.triggerAtMs <= now &&
        armed.get(id)?.triggerAtMs === reminder.triggerAtMs
      ) {
        wanted.delete(id);
        armed.delete(id);
      }
    }
  };

  const cancelDisplaced = async (admittedIds: Set<number>): Promise<void> => {
    // Nothing to cancel for a reminder iOS never held.
    [...unwanted].filter((id) => !armed.has(id)).forEach((id) => unwanted.delete(id));
    const cancelIds = [...armed.keys()].filter(
      (id) => unwanted.has(id) || (wanted.has(id) && !admittedIds.has(id)),
    );
    // Not confirmed by iOS: kept as they are, so the next pass asks again.
    if (!cancelIds.length || !(await deps.cancel(cancelIds))) {
      return;
    }
    cancelIds.forEach((id) => {
      armed.delete(id);
      unwanted.delete(id);
    });
  };

  const armChanged = async (admitted: ScheduleReminderOptions[]): Promise<void> => {
    for (const reminder of admitted) {
      const current = armed.get(reminder.notificationId);
      if (current && isSame(current, reminder)) {
        continue;
      }
      if (await deps.schedule(reminder)) {
        armed.set(reminder.notificationId, reminder);
      }
    }
  };

  const reconcile = async (): Promise<void> => {
    await loadPendingOnce();
    forgetFired();
    const admitted = pickSoonest([...wanted.values()], budget);
    // Cancel first, so iOS never holds more than the budget.
    await cancelDisplaced(new Set(admitted.map((r) => r.notificationId)));
    await armChanged(admitted);
    deps.onPlanned(
      admitted.length >= budget ? admitted[admitted.length - 1].triggerAtMs : null,
    );
  };

  const run = async (): Promise<void> => {
    // One pass at a time: two would cancel and arm against each other.
    if (isRunning) {
      isDirty = true;
      return;
    }
    isRunning = true;
    try {
      await reconcile();
    } catch (e) {
      Log.err('IosReminderBudget: pass failed', e);
    } finally {
      isRunning = false;
      if (isDirty) {
        isDirty = false;
        request();
      }
    }
  };

  const request = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), RECONCILE_DEBOUNCE_MS);
  };

  return {
    want: (reminder) => {
      wanted.set(reminder.notificationId, reminder);
      unwanted.delete(reminder.notificationId);
      // Also for an unchanged reminder: a pass moves waiting reminders into
      // slots that fired ones left, and costs no native call when nothing changed.
      request();
    },
    unwant: (notificationId) => {
      wanted.delete(notificationId);
      unwanted.add(notificationId);
      request();
    },
  };
};
