import { Store } from '@ngrx/store';
import { TimerState } from '../../focus-mode/focus-mode.model';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { TaskService } from '../../tasks/task.service';
import { MOBILE_BACKGROUND_IDLE_CAP_MS } from '../../../app.constants';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';
import { handleIosPause, handleIosResume } from './ios-background-tracking.effects';

// Effect creation is gated by IS_IOS_NATIVE (false under Karma), so the spec
// drives the handler bodies directly. Mirrors the precedent in
// android-foreground-tracking.effects.spec.ts.

describe('IosBackgroundTrackingEffects', () => {
  describe('handleIosPause', () => {
    let taskService: jasmine.SpyObj<TaskService>;
    let operationWriteFlush: jasmine.SpyObj<OperationWriteFlushService>;

    beforeEach(() => {
      taskService = jasmine.createSpyObj('TaskService', ['flushAccumulatedTimeSpent']);
      operationWriteFlush = jasmine.createSpyObj('OperationWriteFlushService', [
        'flushPendingWrites',
      ]);
      operationWriteFlush.flushPendingWrites.and.returnValue(Promise.resolve());
    });

    it('flushes accumulated time before draining the write queue', async () => {
      const callOrder: string[] = [];
      taskService.flushAccumulatedTimeSpent.and.callFake(() =>
        callOrder.push('flushAccumulated'),
      );
      operationWriteFlush.flushPendingWrites.and.callFake(() => {
        callOrder.push('flushWrites');
        return Promise.resolve();
      });

      await handleIosPause(taskService, operationWriteFlush);

      expect(callOrder).toEqual(['flushAccumulated', 'flushWrites']);
    });

    it('awaits the write-queue drain', async () => {
      let resolveFlush!: () => void;
      operationWriteFlush.flushPendingWrites.and.returnValue(
        new Promise((resolve) => {
          resolveFlush = resolve;
        }),
      );

      let settled = false;
      const promise = handleIosPause(taskService, operationWriteFlush).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBeFalse();

      resolveFlush();
      await promise;
      expect(settled).toBeTrue();
    });

    it('propagates a write-queue rejection so the effect can log it', async () => {
      const err = new Error('IDB unavailable');
      operationWriteFlush.flushPendingWrites.and.returnValue(Promise.reject(err));

      await expectAsync(
        handleIosPause(taskService, operationWriteFlush),
      ).toBeRejectedWith(err);
      expect(taskService.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(1);
    });
  });

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

    const breakOfferTimer: TimerState = {
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

    it('triggers wake-up tick with the configured cap then resets the anchor', () => {
      const callOrder: string[] = [];
      globalTracking.triggerWakeUpTick.and.callFake(() => {
        callOrder.push('wakeUp');
        return { duration: 0, date: '2026-05-27', timestamp: Date.now() };
      });
      globalTracking.resetTrackingStart.and.callFake(() => callOrder.push('reset'));
      taskService.flushAccumulatedTimeSpent.and.callFake(() => callOrder.push('flush'));

      handleIosResume(globalTracking, taskService, store, runningWorkTimer);

      expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledOnceWith(
        MOBILE_BACKGROUND_IDLE_CAP_MS,
      );
      expect(callOrder).toEqual(['wakeUp', 'reset', 'flush']);
    });

    it('dispatches focus tick when a work session is running', () => {
      handleIosResume(globalTracking, taskService, store, runningWorkTimer);

      expect(store.dispatch).toHaveBeenCalledOnceWith(focusModeActions.tick());
    });

    it('does not dispatch focus tick when no session is active', () => {
      handleIosResume(globalTracking, taskService, store, idleTimer);

      expect(store.dispatch).not.toHaveBeenCalled();
      // But the reconcile work still runs — a backgrounded task without focus
      // mode still needs its time credited.
      expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledTimes(1);
      expect(taskService.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch focus tick when the session is paused', () => {
      handleIosResume(globalTracking, taskService, store, pausedWorkTimer);

      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch focus tick on the BreakOffer screen', () => {
      handleIosResume(globalTracking, taskService, store, breakOfferTimer);

      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });
});
