import { fakeAsync, tick } from '@angular/core/testing';
import {
  createIosReminderBudget,
  IOS_REMINDER_BUDGET,
  IosReminderBudget,
  IosReminderBudgetDeps,
  pickSoonest,
} from './ios-reminder-budget';
import { ScheduleReminderOptions } from './capacitor-reminder.service';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// Longer than the budget's debounce, so one tick runs a whole pass.
const SETTLE_MS = 1000;

const reminder = (
  notificationId: number,
  triggerAtMs: number,
  title = `task ${notificationId}`,
): ScheduleReminderOptions => ({
  notificationId,
  reminderId: `t${notificationId}`,
  relatedId: `t${notificationId}`,
  title,
  reminderType: 'TASK',
  triggerAtMs,
});

describe('pickSoonest', () => {
  it('keeps the soonest reminders, whatever order they were asked for in', () => {
    const wanted = [reminder(1, 5 * DAY), reminder(2, 1 * DAY), reminder(3, 3 * DAY)];

    expect(pickSoonest(wanted, 2).map((r) => r.notificationId)).toEqual([2, 3]);
  });

  it('leaves room for notifications that are not reminders', () => {
    // iOS holds 64 pending notifications per app.
    expect(IOS_REMINDER_BUDGET).toBe(60);
  });
});

describe('createIosReminderBudget', () => {
  let deps: jasmine.SpyObj<IosReminderBudgetDeps>;
  let budget: IosReminderBudget;
  let now: number;

  // A fire time `count` units (days unless said otherwise) from now.
  const fromNow = (count: number, unit: number = DAY): number => {
    const offsetMs = count * unit;
    return now + offsetMs;
  };
  const scheduledIds = (): number[] =>
    deps.schedule.calls.allArgs().map(([r]) => r.notificationId);
  const cancelledIds = (): number[] =>
    deps.cancel.calls.allArgs().flatMap(([ids]) => ids);

  // Sets up inside fakeAsync, where timers and Date.now() are virtual.
  const setup = (size: number, pendingIds: number[] = []): void => {
    deps = jasmine.createSpyObj<IosReminderBudgetDeps>('deps', [
      'schedule',
      'cancel',
      'getPendingIds',
      'onPlanned',
    ]);
    deps.schedule.and.resolveTo(true);
    deps.cancel.and.resolveTo(true);
    deps.getPendingIds.and.resolveTo(pendingIds);
    budget = createIosReminderBudget(deps, size);
    now = Date.now();
  };

  it('arms each reminder once, not again when asked for it unchanged', fakeAsync(() => {
    setup(3);
    budget.want(reminder(1, fromNow(1)));
    budget.want(reminder(2, fromNow(2)));
    tick(SETTLE_MS);
    expect(scheduledIds()).toEqual([1, 2]);

    budget.want(reminder(1, fromNow(1)));
    budget.want(reminder(2, fromNow(2)));
    tick(SETTLE_MS);

    expect(scheduledIds()).toEqual([1, 2]);
    expect(deps.cancel).not.toHaveBeenCalled();
  }));

  it('arms only the soonest when more are wanted than fit', fakeAsync(() => {
    setup(3);
    // Farthest first: iOS itself would keep the last three added (2, 1 and 3).
    for (const days of [5, 4, 3, 2, 1]) {
      budget.want(reminder(days, fromNow(days)));
    }
    tick(SETTLE_MS);

    expect(scheduledIds()).toEqual([1, 2, 3]);
    expect(deps.cancel).not.toHaveBeenCalled();
  }));

  it('makes room for a nearer reminder by cancelling the farthest armed one', fakeAsync(() => {
    setup(3);
    for (const days of [2, 3, 4]) {
      budget.want(reminder(days, fromNow(days)));
    }
    tick(SETTLE_MS);
    deps.schedule.calls.reset();

    budget.want(reminder(1, fromNow(1)));
    tick(SETTLE_MS);

    expect(cancelledIds()).toEqual([4]);
    expect(scheduledIds()).toEqual([1]);
  }));

  it('arms the next waiting reminder when an armed one is cancelled', fakeAsync(() => {
    setup(3);
    for (const days of [1, 2, 3, 4]) {
      budget.want(reminder(days, fromNow(days)));
    }
    tick(SETTLE_MS);
    deps.schedule.calls.reset();

    budget.unwant(2);
    tick(SETTLE_MS);

    expect(cancelledIds()).toEqual([2]);
    expect(scheduledIds()).toEqual([4]);
  }));

  it('re-arms a reminder whose time or title changed', fakeAsync(() => {
    setup(3);
    budget.want(reminder(1, fromNow(1), 'Call Anna'));
    tick(SETTLE_MS);

    budget.want(reminder(1, fromNow(2), 'Call Anna'));
    tick(SETTLE_MS);
    budget.want(reminder(1, fromNow(2), 'Call Anna back'));
    tick(SETTLE_MS);

    expect(deps.schedule.calls.allArgs().map(([r]) => [r.triggerAtMs, r.title])).toEqual([
      [fromNow(1), 'Call Anna'],
      [fromNow(2), 'Call Anna'],
      [fromNow(2), 'Call Anna back'],
    ]);
  }));

  it('does not arm a fired reminder again and gives its slot to the next one', fakeAsync(() => {
    setup(2);
    budget.want(reminder(1, fromNow(1, MINUTE)));
    budget.want(reminder(2, fromNow(1)));
    budget.want(reminder(3, fromNow(2)));
    tick(SETTLE_MS);
    expect(scheduledIds()).toEqual([1, 2]);
    deps.schedule.calls.reset();

    // Reminder 1 fires; the effects then ask for the others again.
    tick(2 * MINUTE);
    budget.want(reminder(2, fromNow(1)));
    budget.want(reminder(3, fromNow(2)));
    tick(SETTLE_MS);

    expect(scheduledIds()).toEqual([3]);
    expect(deps.cancel).not.toHaveBeenCalled();
  }));

  describe('with reminders left pending by an earlier app run', () => {
    it('cancels one that no longer fits and re-arms one that does', fakeAsync(() => {
      setup(2, [3, 2]);
      for (const days of [1, 2, 3]) {
        budget.want(reminder(days, fromNow(days)));
      }
      tick(SETTLE_MS);

      expect(cancelledIds()).toEqual([3]);
      expect(scheduledIds()).toEqual([1, 2]);
    }));

    it('leaves alone a pending notification nobody asked to cancel', fakeAsync(() => {
      setup(2, [99]);
      budget.want(reminder(1, fromNow(1)));
      tick(SETTLE_MS);

      expect(deps.cancel).not.toHaveBeenCalled();
    }));

    it('cancels one the app no longer wants', fakeAsync(() => {
      setup(2, [7]);
      budget.unwant(7);
      tick(SETTLE_MS);

      expect(cancelledIds()).toEqual([7]);
    }));
  });

  // The pending list comes back empty when reading it failed, so a cancel
  // must not depend on it: iOS may still hold the reminder from an earlier run.
  it('cancels an unwanted reminder the pending list did not show, once', fakeAsync(() => {
    setup(2);
    budget.unwant(5);
    tick(SETTLE_MS);
    budget.want(reminder(1, fromNow(1)));
    tick(SETTLE_MS);

    expect(cancelledIds()).toEqual([5]);
  }));

  it('tries again on the next pass when iOS refused a reminder', fakeAsync(() => {
    setup(2);
    deps.schedule.and.resolveTo(false);
    budget.want(reminder(1, fromNow(1)));
    tick(SETTLE_MS);

    deps.schedule.and.resolveTo(true);
    budget.want(reminder(1, fromNow(1)));
    tick(SETTLE_MS);
    budget.want(reminder(1, fromNow(1)));
    tick(SETTLE_MS);

    expect(scheduledIds()).toEqual([1, 1]);
  }));

  it('asks again on the next pass when iOS did not confirm a cancel', fakeAsync(() => {
    setup(2);
    budget.want(reminder(1, fromNow(1)));
    tick(SETTLE_MS);

    deps.cancel.and.resolveTo(false);
    budget.unwant(1);
    tick(SETTLE_MS);
    deps.cancel.and.resolveTo(true);
    budget.want(reminder(2, fromNow(2)));
    tick(SETTLE_MS);
    budget.want(reminder(2, fromNow(2)));
    tick(SETTLE_MS);

    expect(cancelledIds()).toEqual([1, 1]);
  }));

  it('applies a change made while a pass is talking to iOS', fakeAsync(() => {
    setup(2);
    let finishFirst: (isOk: boolean) => void = () => undefined;
    deps.schedule.and.returnValues(
      new Promise<boolean>((resolve) => (finishFirst = resolve)),
      Promise.resolve(true),
    );
    budget.want(reminder(1, fromNow(1)));
    tick(SETTLE_MS);

    budget.want(reminder(2, fromNow(2)));
    tick(SETTLE_MS);
    expect(scheduledIds()).toEqual([1]);

    finishFirst(true);
    tick(SETTLE_MS);

    expect(scheduledIds()).toEqual([1, 2]);
  }));

  describe('onPlanned', () => {
    it('reports no horizon while slots are free', fakeAsync(() => {
      setup(3);
      budget.want(reminder(1, fromNow(1)));
      tick(SETTLE_MS);

      expect(deps.onPlanned.calls.mostRecent().args).toEqual([null]);
    }));

    it('reports when the last armed reminder fires once the budget is full', fakeAsync(() => {
      setup(2);
      for (const days of [1, 2, 3]) {
        budget.want(reminder(days, fromNow(days)));
      }
      tick(SETTLE_MS);

      expect(deps.onPlanned.calls.mostRecent().args).toEqual([fromNow(2)]);
    }));
  });
});
