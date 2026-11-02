import { Store } from '@ngrx/store';
import { of, Subject, Subscription } from 'rxjs';
import { TimerState } from '../../focus-mode/focus-mode.model';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { TaskService } from '../../tasks/task.service';
import { MOBILE_BACKGROUND_IDLE_CAP_MS } from '../../../app.constants';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';
import { selectIsOvertimeEnabled } from '../../focus-mode/store/focus-mode.selectors';
import { handleIosResume, reconcileOnResume } from './ios-background-tracking.effects';

// Effect creation is gated by IS_IOS_NATIVE (false under Karma), so the spec
// drives the handler body directly. Mirrors the precedent in
// android-foreground-tracking.effects.spec.ts.

describe('IosBackgroundTrackingEffects', () => {
  describe('handleIosResume', () => {
    let globalTracking: jasmine.SpyObj<GlobalTrackingIntervalService>;
    let taskService: jasmine.SpyObj<TaskService>;
    let store: jasmine.SpyObj<Store>;

    const idleTimer: TimerState = {
      isRunning: false,
      startedAt: null,
      elapsed: 0,
      duration: 0,
      purpose: null,
    };

    const runningWorkTimer: TimerState = {
      isRunning: true,
      startedAt: Date.now() - 60_000,
      elapsed: 60_000,
      duration: 25 * 60_000,
      purpose: 'work',
    };

    const pausedWorkTimer: TimerState = {
      ...runningWorkTimer,
      isRunning: false,
    };

    const pausedBreakTimer: TimerState = {
      isRunning: false,
      startedAt: null,
      elapsed: 0,
      duration: 5 * 60_000,
      purpose: 'break',
    };

    beforeEach(() => {
      globalTracking = jasmine.createSpyObj('GlobalTrackingIntervalService', [
        'triggerWakeUpTick',
        'resetTrackingStart',
      ]);
      globalTracking.triggerWakeUpTick.and.returnValue({
        duration: 0,
        date: '2026-05-27',
        timestamp: Date.now(),
      });
      taskService = jasmine.createSpyObj('TaskService', ['flushAccumulatedTimeSpent']);
      store = jasmine.createSpyObj('Store', ['dispatch']);
    });

    it('triggers wake-up tick with the configured cap then resets the anchor without a focus session', () => {
      const callOrder: string[] = [];
      globalTracking.triggerWakeUpTick.and.callFake(() => {
        callOrder.push('wakeUp');
        return { duration: 0, date: '2026-05-27', timestamp: Date.now() };
      });
      globalTracking.resetTrackingStart.and.callFake(() => callOrder.push('reset'));
      taskService.flushAccumulatedTimeSpent.and.callFake(() => callOrder.push('flush'));

      handleIosResume({ globalTracking, taskService, store }, idleTimer, false);

      expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledOnceWith(
        MOBILE_BACKGROUND_IDLE_CAP_MS,
      );
      expect(callOrder).toEqual(['wakeUp', 'reset', 'flush']);
    });

    it('dispatches focus tick when a work session is running', () => {
      handleIosResume({ globalTracking, taskService, store }, runningWorkTimer, false);

      expect(store.dispatch).toHaveBeenCalledOnceWith(focusModeActions.tick());
    });

    it('does not dispatch focus tick when no session is active', () => {
      handleIosResume({ globalTracking, taskService, store }, idleTimer, false);

      expect(store.dispatch).not.toHaveBeenCalled();
      // But the reconcile work still runs — a backgrounded task without focus
      // mode still needs its time credited.
      expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledTimes(1);
      expect(taskService.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch focus tick when the session is paused', () => {
      handleIosResume({ globalTracking, taskService, store }, pausedWorkTimer, false);

      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch focus tick when a break is paused (not running)', () => {
      handleIosResume({ globalTracking, taskService, store }, pausedBreakTimer, false);

      expect(store.dispatch).not.toHaveBeenCalled();
    });

    // #10599: models the real service — each wake tick credits min(uncredited
    // gap, maxMs) to the task while it is tracked — and a focus tick that
    // completes the session and pauses tracking for the break.
    describe('background gap credit (#10599)', () => {
      const MIN = 60_000;
      const GAP_MS = 55 * MIN;
      let uncreditedMs: number;
      let isTaskTracked: boolean;
      let taskCreditMs: number;

      beforeEach(() => {
        uncreditedMs = GAP_MS;
        isTaskTracked = true;
        taskCreditMs = 0;
        globalTracking.triggerWakeUpTick.and.callFake((maxMs?: number) => {
          const duration = Math.min(uncreditedMs, maxMs ?? uncreditedMs);
          uncreditedMs -= duration;
          if (isTaskTracked) {
            taskCreditMs += duration;
          }
          return { duration, date: '2026-05-27', timestamp: Date.now() };
        });
        globalTracking.resetTrackingStart.and.callFake(() => {
          uncreditedMs = 0;
        });
      });

      it('credits a Pomodoro task only up to the session end', () => {
        (store.dispatch as jasmine.Spy).and.callFake(() => {
          isTaskTracked = false;
        });
        const pomodoroTimer: TimerState = {
          isRunning: true,
          startedAt: Date.now(),
          elapsed: 0,
          duration: 25 * MIN,
          purpose: 'work',
        };

        handleIosResume({ globalTracking, taskService, store }, pomodoroTimer, false);

        expect(taskCreditMs).toBe(25 * MIN);
        expect(store.dispatch).toHaveBeenCalledOnceWith(focusModeActions.tick());
      });

      it('credits the whole gap without a focus session', () => {
        handleIosResume({ globalTracking, taskService, store }, idleTimer, false);

        expect(taskCreditMs).toBe(GAP_MS);
        expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledOnceWith(
          MOBILE_BACKGROUND_IDLE_CAP_MS,
        );
      });

      it('credits the whole gap to a Flowtime session (no end time)', () => {
        const flowtimeTimer: TimerState = { ...runningWorkTimer, duration: 0 };

        handleIosResume({ globalTracking, taskService, store }, flowtimeTimer, false);

        expect(taskCreditMs).toBe(GAP_MS);
        expect(store.dispatch).toHaveBeenCalledOnceWith(focusModeActions.tick());
      });

      it('credits the whole gap when overtime keeps the session running', () => {
        handleIosResume({ globalTracking, taskService, store }, runningWorkTimer, true);

        expect(taskCreditMs).toBe(GAP_MS);
        expect(store.dispatch).toHaveBeenCalledOnceWith(focusModeActions.tick());
      });
    });
  });

  // Covers the effect pipe itself (onResume$ → withLatestFrom(selectTimer) →
  // handler). The effect field is `false` under Karma (IS_IOS_NATIVE gate), so
  // we exercise the extracted `reconcileOnResume` factory directly.
  describe('reconcileOnResume (effect wiring)', () => {
    let globalTracking: jasmine.SpyObj<GlobalTrackingIntervalService>;
    let taskService: jasmine.SpyObj<TaskService>;
    let store: jasmine.SpyObj<Store>;
    let onResume$: Subject<void>;
    let sub: Subscription;

    const runningWorkTimer: TimerState = {
      isRunning: true,
      startedAt: Date.now() - 60_000,
      elapsed: 60_000,
      duration: 25 * 60_000,
      purpose: 'work',
    };

    const idleTimer: TimerState = {
      isRunning: false,
      startedAt: null,
      elapsed: 0,
      duration: 0,
      purpose: null,
    };

    beforeEach(() => {
      globalTracking = jasmine.createSpyObj('GlobalTrackingIntervalService', [
        'triggerWakeUpTick',
        'resetTrackingStart',
      ]);
      globalTracking.triggerWakeUpTick.and.returnValue({
        duration: 0,
        date: '2026-05-27',
        timestamp: Date.now(),
      });
      taskService = jasmine.createSpyObj('TaskService', ['flushAccumulatedTimeSpent']);
      store = jasmine.createSpyObj('Store', ['select', 'dispatch']);
      onResume$ = new Subject<void>();
    });

    afterEach(() => sub?.unsubscribe());

    const selectFrom = (timer: TimerState, isOvertimeEnabled: boolean): void => {
      (store.select as jasmine.Spy).and.callFake((selector: unknown) =>
        of(selector === selectIsOvertimeEnabled ? isOvertimeEnabled : timer),
      );
    };

    it('reads the latest timer off the store and reconciles on each resume', () => {
      selectFrom(runningWorkTimer, false);
      sub = reconcileOnResume(onResume$, store, globalTracking, taskService).subscribe();

      onResume$.next();

      // capped at the session end: 25 min duration - 1 min elapsed (#10599)
      expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledOnceWith(24 * 60_000);
      expect(taskService.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(1);
      expect(store.dispatch).toHaveBeenCalledOnceWith(focusModeActions.tick());
    });

    it('does not dispatch a focus tick when the store timer is idle', () => {
      selectFrom(idleTimer, false);
      sub = reconcileOnResume(onResume$, store, globalTracking, taskService).subscribe();

      onResume$.next();

      expect(store.dispatch).not.toHaveBeenCalled();
      expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledTimes(1);
    });

    it('reads the overtime setting off the store and keeps the full gap cap', () => {
      selectFrom(runningWorkTimer, true);
      sub = reconcileOnResume(onResume$, store, globalTracking, taskService).subscribe();

      onResume$.next();

      expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledOnceWith(
        MOBILE_BACKGROUND_IDLE_CAP_MS,
      );
      expect(store.dispatch).toHaveBeenCalledOnceWith(focusModeActions.tick());
    });
  });
});
