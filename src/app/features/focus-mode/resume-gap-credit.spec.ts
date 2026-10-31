import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { TaskService } from '../tasks/task.service';
import { ANDROID_BACKGROUND_TICK_CAP_MS } from '../../app.constants';
import { TimerState } from './focus-mode.model';
import { creditBackgroundTickGap, getFocusAutoCompleteCapMs } from './resume-gap-credit';

// Platform resume flows using these (creditResumeGap) are covered in the
// Android (handleAndroidResume) and iOS (handleIosResume) effect specs.

describe('creditBackgroundTickGap - background tick gap (#8243)', () => {
  let globalTracking: jasmine.SpyObj<GlobalTrackingIntervalService>;
  let taskService: jasmine.SpyObj<TaskService>;

  beforeEach(() => {
    globalTracking = jasmine.createSpyObj<GlobalTrackingIntervalService>(
      'GlobalTrackingIntervalService',
      ['triggerWakeUpTick', 'resetTrackingStart'],
    );
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'flushAccumulatedTimeSpent',
    ]);
  });

  it('should credit a capped wake-up tick, reset the anchor and flush', () => {
    creditBackgroundTickGap(globalTracking, taskService, ANDROID_BACKGROUND_TICK_CAP_MS);

    expect(globalTracking.triggerWakeUpTick).toHaveBeenCalledWith(
      ANDROID_BACKGROUND_TICK_CAP_MS,
    );
    expect(globalTracking.resetTrackingStart).toHaveBeenCalledTimes(1);
    expect(taskService.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(1);
  });

  it('should credit the gap before flushing it into a syncTimeSpent op', () => {
    const callOrder: string[] = [];
    globalTracking.triggerWakeUpTick.and.callFake(() => {
      callOrder.push('wakeUpTick');
      return { duration: 0, date: '2026-06-11', timestamp: 0 };
    });
    globalTracking.resetTrackingStart.and.callFake(() => callOrder.push('reset'));
    taskService.flushAccumulatedTimeSpent.and.callFake(() => callOrder.push('flush'));

    creditBackgroundTickGap(globalTracking, taskService, ANDROID_BACKGROUND_TICK_CAP_MS);

    expect(callOrder).toEqual(['wakeUpTick', 'reset', 'flush']);
  });
});

describe('getFocusAutoCompleteCapMs', () => {
  const MIN = 60_000;
  const timer = (over: Partial<TimerState> = {}): TimerState =>
    ({
      isRunning: true,
      purpose: 'work',
      duration: 25 * MIN,
      elapsed: 5 * MIN,
      startedAt: 0,
      ...over,
    }) as TimerState;

  it('returns the remaining time of a running fixed-duration work session', () => {
    expect(getFocusAutoCompleteCapMs(timer(), false)).toBe(20 * MIN);
  });

  it('never returns a negative cap', () => {
    expect(getFocusAutoCompleteCapMs(timer({ elapsed: 30 * MIN }), false)).toBe(0);
  });

  it('returns null when the tick cannot complete a work session', () => {
    expect(getFocusAutoCompleteCapMs(timer(), true)).toBeNull();
    expect(getFocusAutoCompleteCapMs(timer({ duration: 0 }), false)).toBeNull();
    expect(getFocusAutoCompleteCapMs(timer({ isRunning: false }), false)).toBeNull();
    expect(getFocusAutoCompleteCapMs(timer({ purpose: 'break' }), false)).toBeNull();
    expect(getFocusAutoCompleteCapMs(timer({ purpose: null }), false)).toBeNull();
  });
});
