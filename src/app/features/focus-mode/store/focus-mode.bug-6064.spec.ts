/**
 * Integration tests for GitHub issue #6064
 * https://github.com/super-productivity/super-productivity/issues/6064
 *
 * Bug: Without break timer doesn't reset during Pomodoro breaks
 *
 * When you:
 * 1. Enable focus sync setting (isSyncSessionWithTracking = true)
 * 2. Complete two 25/5 Pomodoro sessions (1 hour of work + breaks)
 *
 * Expected: "Without break timer" should reset during breaks
 * Bug: Timer incorrectly accumulates break time as work time, triggers reminder after 1 hour
 *
 * Fix:
 * Add explicit break timer reset when startBreak action is dispatched.
 * This ensures Pomodoro breaks are recognized as rest periods regardless of
 * whether task tracking is paused during breaks (isPauseTrackingDuringBreak setting).
 */

import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, ReplaySubject, Subject } from 'rxjs';
import { FocusModeEffects } from './focus-mode.effects';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { BannerService } from '../../../core/banner/banner.service';
import { MetricService } from '../../metric/metric.service';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { TakeABreakService } from '../../take-a-break/take-a-break.service';
import * as actions from './focus-mode.actions';
import { FocusModeMode, FocusScreen, TimerState } from '../focus-mode.model';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
} from '../../config/store/global-config.reducer';
import { Action } from '@ngrx/store';

describe('FocusMode Bug #6064: Without break timer reset on break start', () => {
  let actions$: ReplaySubject<Action>;
  let effects: FocusModeEffects;
  let store: MockStore;
  let takeABreakServiceMock: any;
  let otherNoBreakTime$: Subject<number>;

  const createMockTimer = (overrides: Partial<TimerState> = {}): TimerState => ({
    isRunning: false,
    startedAt: null,
    elapsed: 0,
    duration: 0,
    purpose: null,
    ...overrides,
  });

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    otherNoBreakTime$ = new Subject<number>();

    takeABreakServiceMock = {
      otherNoBreakTIme$: otherNoBreakTime$,
    };

    const strategyFactoryMock = {
      getStrategy: jasmine.createSpy('getStrategy').and.returnValue({
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        getBreakDuration: jasmine
          .createSpy('getBreakDuration')
          .and.returnValue({ duration: 5 * 60 * 1000, isLong: false }),
      }),
    };

    const taskServiceMock = {
      currentTaskId$: new BehaviorSubject<string | null>(null).asObservable(),
      currentTaskId: jasmine.createSpy('currentTaskId').and.returnValue(null),
    };

    const globalConfigServiceMock = {
      sound: jasmine.createSpy('sound').and.returnValue({ volume: 75 }),
    };

    const metricServiceMock = {
      logFocusSession: jasmine.createSpy('logFocusSession'),
    };

    TestBed.configureTestingModule({
      providers: [
        FocusModeEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            focusMode: {
              timer: createMockTimer(),
              mode: FocusModeMode.Pomodoro,
              currentCycle: 1,
              currentScreen: FocusScreen.Main,
              mainState: 'preparation',
              pausedTaskId: null,
              lastCompletedDuration: null,
              isOverlayShown: false,
              _isResumingBreak: false,
            },
          },
        }),
        { provide: FocusModeStrategyFactory, useValue: strategyFactoryMock },
        { provide: TaskService, useValue: taskServiceMock },
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        { provide: BannerService, useValue: {} },
        { provide: MetricService, useValue: metricServiceMock },
        { provide: FocusModeStorageService, useValue: {} },
        { provide: TakeABreakService, useValue: takeABreakServiceMock },
      ],
    });

    effects = TestBed.inject(FocusModeEffects);
    store = TestBed.inject(MockStore);

    // Set up default selectors
    store.overrideSelector(selectFocusModeConfig, {
      isSkipPreparation: false,
      isSyncSessionWithTracking: true,
      isPauseTrackingDuringBreak: false,
      isManualBreakStart: false,
    });
    store.overrideSelector(selectIsFocusModeEnabled, true);
  });

  afterEach(() => {
    actions$.complete();
  });

  describe('resetBreakTimerOnBreakStart$ effect', () => {
    it('should reset break timer when startBreak action is dispatched', fakeAsync(() => {
      // Subscribe to the effect (non-dispatching effect, so we just need to subscribe)
      effects.resetBreakTimerOnBreakStart$.subscribe();

      // Spy on the Subject's next method
      spyOn(otherNoBreakTime$, 'next');

      // Dispatch startBreak action
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      // Verify: otherNoBreakTIme$.next(0) was called
      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);
      expect(otherNoBreakTime$.next).toHaveBeenCalledTimes(1);

      flush();
    }));

    it('should reset break timer regardless of isPauseTrackingDuringBreak setting (false)', fakeAsync(() => {
      // Configure with isPauseTrackingDuringBreak = false (default)
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isPauseTrackingDuringBreak: false, // Task tracking continues during breaks
        isManualBreakStart: false,
      });
      store.refreshState();

      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      // Dispatch startBreak action
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      // Verify: Break timer still resets
      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));

    it('should reset break timer regardless of isPauseTrackingDuringBreak setting (true)', fakeAsync(() => {
      // Configure with isPauseTrackingDuringBreak = true
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isPauseTrackingDuringBreak: true, // Task tracking pauses during breaks
        isManualBreakStart: false,
      });
      store.refreshState();

      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      // Dispatch startBreak action
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
          pausedTaskId: 'test-task-id',
        }),
      );
      tick(10);

      // Verify: Break timer still resets
      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));

    it('should reset break timer for short breaks', fakeAsync(() => {
      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      // Dispatch short break (5 minutes)
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));

    it('should reset break timer for long breaks', fakeAsync(() => {
      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      // Dispatch long break (15 minutes)
      actions$.next(
        actions.startBreak({
          duration: 15 * 60 * 1000,
          isLongBreak: true,
        }),
      );
      tick(10);

      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));

    it('should reset break timer multiple times across multiple breaks', fakeAsync(() => {
      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      // First break
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      // Second break
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      // Third break
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      // Verify: Reset was called 3 times
      expect(otherNoBreakTime$.next).toHaveBeenCalledTimes(3);
      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));

    it('should reset break timer for auto-started breaks', fakeAsync(() => {
      // Auto-started break (triggered by session completion)
      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      // Dispatch startBreak from autoStartBreakOnSessionComplete$ effect
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
          pausedTaskId: 'test-task-id',
        }),
      );
      tick(10);

      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));

    it('should reset break timer for manually started breaks', fakeAsync(() => {
      // Manually started break (user clicks "Start Break" button)
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isPauseTrackingDuringBreak: false,
        isManualBreakStart: true, // Manual break mode
      });
      store.refreshState();

      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      // Dispatch startBreak from user action
      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));

    it('should work even when focus mode feature is disabled', fakeAsync(() => {
      // Focus mode feature disabled (but effect still should work if startBreak is dispatched)
      store.overrideSelector(selectIsFocusModeEnabled, false);
      store.refreshState();

      effects.resetBreakTimerOnBreakStart$.subscribe();
      spyOn(otherNoBreakTime$, 'next');

      actions$.next(
        actions.startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
        }),
      );
      tick(10);

      // Effect is unconditional - it always resets the break timer
      expect(otherNoBreakTime$.next).toHaveBeenCalledWith(0);

      flush();
    }));
  });
});
