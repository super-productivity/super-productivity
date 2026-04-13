/**
 * Integration tests for GitHub issue #5875
 * https://github.com/super-productivity/super-productivity/issues/5875
 *
 * Bug: You can break Pomodoro timer syncing
 *
 * Two scenarios where time tracking and Pomodoro focus session sync can become desynchronized:
 *
 * Bug 1: Pressing time tracking button during break breaks sync
 * When a Pomodoro break is running (with isPauseTrackingDuringBreak enabled),
 * pressing the main time tracking button starts tracking even though a break is active.
 * This creates an inconsistent state where tracking is running but focus session is on break.
 *
 * Bug 2: "End Session" button doesn't stop time tracking
 * When user manually ends a session via the "End session" button,
 * time tracking continues even though the focus session has ended.
 *
 * Fix:
 * 1. syncTrackingStartToSession$ should check if break is active and not start/resume session
 * 2. sessionComplete$ should stop time tracking when session is manually completed
 */

import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { FocusModeEffects } from './focus-mode.effects';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { BannerService } from '../../../core/banner/banner.service';
import { MetricService } from '../../metric/metric.service';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { TakeABreakService } from '../../take-a-break/take-a-break.service';
import * as actions from './focus-mode.actions';
import * as selectors from './focus-mode.selectors';
import { FocusModeMode, FocusScreen, TimerState } from '../focus-mode.model';
import { unsetCurrentTask } from '../../tasks/store/task.actions';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
  selectPomodoroConfig,
} from '../../config/store/global-config.reducer';
import { skip, take, toArray } from 'rxjs/operators';

describe('FocusMode Bug #5875: Pomodoro timer sync issues', () => {
  let actions$: Observable<any>;
  let effects: FocusModeEffects;
  let store: MockStore;
  let strategyFactoryMock: any;
  let taskServiceMock: any;
  let globalConfigServiceMock: any;
  let metricServiceMock: any;
  let currentTaskId$: BehaviorSubject<string | null>;

  const createMockTimer = (overrides: Partial<TimerState> = {}): TimerState => ({
    isRunning: false,
    startedAt: null,
    elapsed: 0,
    duration: 0,
    purpose: null,
    ...overrides,
  });

  beforeEach(() => {
    currentTaskId$ = new BehaviorSubject<string | null>(null);

    strategyFactoryMock = {
      getStrategy: jasmine.createSpy('getStrategy').and.returnValue({
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        getBreakDuration: jasmine
          .createSpy('getBreakDuration')
          .and.returnValue({ duration: 5 * 60 * 1000, isLong: false }),
      }),
    };

    taskServiceMock = {
      currentTaskId$: currentTaskId$.asObservable(),
      currentTaskId: jasmine.createSpy('currentTaskId').and.returnValue(null),
    };

    globalConfigServiceMock = {
      sound: jasmine.createSpy('sound').and.returnValue({ volume: 75 }),
    };

    metricServiceMock = {
      logFocusSession: jasmine.createSpy('logFocusSession'),
    };

    const takeABreakServiceMock = {
      otherNoBreakTIme$: new BehaviorSubject<number>(0),
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
              lastCompletedDuration: 0,
            },
          },
          selectors: [
            { selector: selectors.selectTimer, value: createMockTimer() },
            { selector: selectors.selectMode, value: FocusModeMode.Pomodoro },
            { selector: selectors.selectCurrentCycle, value: 1 },
            { selector: selectors.selectLastSessionDuration, value: 0 },
            {
              selector: selectFocusModeConfig,
              value: { isSyncSessionWithTracking: true },
            },
            { selector: selectPomodoroConfig, value: { duration: 25 * 60 * 1000 } },
            { selector: selectIsFocusModeEnabled, value: true },
          ],
        }),
        { provide: FocusModeStrategyFactory, useValue: strategyFactoryMock },
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        { provide: TaskService, useValue: taskServiceMock },
        {
          provide: BannerService,
          useValue: { open: jasmine.createSpy(), dismiss: jasmine.createSpy() },
        },
        { provide: MetricService, useValue: metricServiceMock },
        {
          provide: FocusModeStorageService,
          useValue: { setLastCountdownDuration: jasmine.createSpy() },
        },
        { provide: TakeABreakService, useValue: takeABreakServiceMock },
        {
          provide: GlobalTrackingIntervalService,
          useValue: {
            todayStr$: new BehaviorSubject<string>('2024-01-19'),
          },
        },
      ],
    });

    effects = TestBed.inject(FocusModeEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('Bug 1: Time tracking start during break should skip break and start session', () => {
    it('should dispatch skipBreak when break is running and user starts tracking', (done) => {
      // Setup: Break is running (timer.purpose === 'break', isRunning === true)
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'break', duration: 5 * 60 * 1000 }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Break);
      store.overrideSelector(selectors.selectPausedTaskId, null);
      store.overrideSelector(selectors.selectIsResumingBreak, false);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      // Simulate user pressing time tracking button during break
      setTimeout(() => {
        currentTaskId$.next('task-123');
      }, 10);

      // Should dispatch skipBreak to sync state
      effects.syncTrackingStartToSession$.pipe(take(1)).subscribe((action) => {
        expect(action.type).toEqual(actions.skipBreak.type);
        done();
      });
    });

    it('should dispatch skipBreak when break is paused and user starts tracking', (done) => {
      // Setup: Break is paused (timer.purpose === 'break', isRunning === false)
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: false,
          purpose: 'break',
          duration: 5 * 60 * 1000,
          elapsed: 60 * 1000,
        }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Break);
      store.overrideSelector(selectors.selectPausedTaskId, null);
      store.overrideSelector(selectors.selectIsResumingBreak, false);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      // Simulate user pressing time tracking button during paused break
      setTimeout(() => {
        currentTaskId$.next('task-123');
      }, 10);

      // Should dispatch skipBreak to sync state
      effects.syncTrackingStartToSession$.pipe(take(1)).subscribe((action) => {
        expect(action.type).toEqual(actions.skipBreak.type);
        done();
      });
    });
  });

  describe('Bug 2: Manual End Session should stop time tracking', () => {
    it('should dispatch unsetCurrentTask when session is manually ended and sync is enabled', (done) => {
      // Setup: Session is running, sync is enabled, task is being tracked
      // isPauseTrackingDuringBreak must be true for this effect to fire (Bug #5954 fix)
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
      });
      currentTaskId$.next('task-123'); // Task is being tracked
      store.refreshState();

      actions$ = of(actions.completeFocusSession({ isManual: true }));

      // Effect emits setPausedTaskId first (Bug #5737 fix), then unsetCurrentTask
      effects.stopTrackingOnSessionEnd$.pipe(skip(1), take(1)).subscribe((action) => {
        expect(action.type).toEqual(unsetCurrentTask.type);
        done();
      });
    });

    it('should dispatch setPausedTaskId before unsetCurrentTask (Bug #5737 race condition fix)', (done) => {
      // Setup: Session is running, sync is enabled, task is being tracked
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      actions$ = of(actions.completeFocusSession({ isManual: true }));

      // Bug #5737 fix: Effect must emit setPausedTaskId BEFORE unsetCurrentTask
      // to store the task ID before it's cleared, enabling resume after break
      effects.stopTrackingOnSessionEnd$
        .pipe(take(2), toArray())
        .subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(2);
          expect(actionsArr[0].type).toEqual(actions.setPausedTaskId.type);
          expect(
            (actionsArr[0] as ReturnType<typeof actions.setPausedTaskId>).pausedTaskId,
          ).toEqual('task-123');
          expect(actionsArr[1].type).toEqual(unsetCurrentTask.type);
          done();
        });
    });

    it('should NOT dispatch unsetCurrentTask when session ends automatically in Pomodoro mode (break auto-starts)', (done) => {
      // Setup: Session completes automatically in Pomodoro mode
      // Break will auto-start, so autoStartBreakOnSessionComplete$ handles tracking pause
      // This effect should NOT fire to avoid double dispatch
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
        isManualBreakStart: false, // Break will auto-start
      });
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      currentTaskId$.next('task-123');
      store.refreshState();

      // Pomodoro strategy has shouldStartBreakAfterSession: true
      strategyFactoryMock.getStrategy.and.returnValue({
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        getBreakDuration: () => ({ duration: 5 * 60 * 1000, isLong: false }),
      });

      actions$ = of(actions.completeFocusSession({ isManual: false }));

      effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
        // For Pomodoro automatic completion with auto-break, tracking is handled by autoStartBreakOnSessionComplete$
        expect(actionsArr.length).toBe(0);
        done();
      });
    });

    it('should NOT dispatch unsetCurrentTask when sync is disabled', (done) => {
      // Setup: Sync is disabled
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false, // Sync disabled
        isSkipPreparation: false,
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      actions$ = of(actions.completeFocusSession({ isManual: true }));

      effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
        expect(actionsArr.length).toBe(0);
        done();
      });
    });

    it('should NOT dispatch unsetCurrentTask when no task is being tracked', (done) => {
      // Setup: No task is being tracked
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      currentTaskId$.next(null); // No task tracking
      store.refreshState();

      actions$ = of(actions.completeFocusSession({ isManual: true }));

      effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
        expect(actionsArr.length).toBe(0);
        done();
      });
    });
  });

  describe('Bug #5996: Countdown timer automatic completion should stop tracking', () => {
    it('should dispatch unsetCurrentTask when Countdown session ends automatically', (done) => {
      // Setup: Countdown mode, session completes automatically, both sync settings enabled
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
      });
      store.overrideSelector(selectors.selectMode, FocusModeMode.Countdown);
      currentTaskId$.next('task-123');
      store.refreshState();

      // Countdown strategy has shouldStartBreakAfterSession: false
      strategyFactoryMock.getStrategy.and.returnValue({
        shouldStartBreakAfterSession: false,
        shouldAutoStartNextSession: false,
        getBreakDuration: () => null,
      });

      actions$ = of(actions.completeFocusSession({ isManual: false }));

      // Effect emits setPausedTaskId first (Bug #5737 fix), then unsetCurrentTask
      effects.stopTrackingOnSessionEnd$.pipe(skip(1), take(1)).subscribe((action) => {
        expect(action.type).toEqual(unsetCurrentTask.type);
        done();
      });
    });

    it('should dispatch unsetCurrentTask when Flowtime session ends automatically', (done) => {
      // Setup: Flowtime mode, session completes automatically, both sync settings enabled
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
      });
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      currentTaskId$.next('task-123');
      store.refreshState();

      // Flowtime strategy has shouldStartBreakAfterSession: false
      strategyFactoryMock.getStrategy.and.returnValue({
        shouldStartBreakAfterSession: false,
        shouldAutoStartNextSession: false,
        getBreakDuration: () => null,
      });

      actions$ = of(actions.completeFocusSession({ isManual: false }));

      // Effect emits setPausedTaskId first (Bug #5737 fix), then unsetCurrentTask
      effects.stopTrackingOnSessionEnd$.pipe(skip(1), take(1)).subscribe((action) => {
        expect(action.type).toEqual(unsetCurrentTask.type);
        done();
      });
    });

    it('should NOT dispatch unsetCurrentTask when Pomodoro session ends automatically with isManualBreakStart (Bug #6510)', (done) => {
      // Bug #6510: When isManualBreakStart=true, tracking should continue until the user
      // manually starts a break. The break-start logic handles pausing tracking.
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
        isManualBreakStart: true, // User must manually start break
      });
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      currentTaskId$.next('task-123');
      store.refreshState();

      // Pomodoro strategy has shouldStartBreakAfterSession: true
      strategyFactoryMock.getStrategy.and.returnValue({
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        getBreakDuration: () => ({ duration: 5 * 60 * 1000, isLong: false }),
      });

      actions$ = of(actions.completeFocusSession({ isManual: false }));

      effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
        expect(actionsArr.length).toBe(0);
        done();
      });
    });
  });

  describe('Bug #6510: Full flow — session auto-completes then manual break start pauses tracking', () => {
    it('should keep tracking after auto-complete, then pause when user manually starts break via banner', (done) => {
      // Step 1: Setup Pomodoro with manual break + pause tracking + sync
      const focusModeConfig = {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
        isManualBreakStart: true,
      };
      store.overrideSelector(selectFocusModeConfig, focusModeConfig);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.overrideSelector(selectors.selectPausedTaskId, null);
      currentTaskId$.next('task-123');
      store.refreshState();

      strategyFactoryMock.getStrategy.and.returnValue({
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        getBreakDuration: () => ({ duration: 5 * 60 * 1000, isLong: false }),
      });

      // Mock TaskService.currentTaskId() (synchronous signal used by banner path)
      taskServiceMock.currentTaskId = jasmine
        .createSpy('currentTaskId')
        .and.returnValue('task-123');

      // Step 2: Session auto-completes → stopTrackingOnSessionEnd$ should NOT fire
      actions$ = of(actions.completeFocusSession({ isManual: false }));

      effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
        expect(actionsArr.length).toBe(0);

        // Step 3: User clicks "Start Break" on the banner
        const dispatchSpy: jasmine.Spy = spyOn(store, 'dispatch').and.callThrough();
        const timer = createMockTimer({
          purpose: 'work',
          duration: 25 * 60 * 1000,
          elapsed: 25 * 60 * 1000,
        });

        const buttonActions = (effects as any)._getBannerActions(
          timer,
          false, // isOnBreak
          true, // isSessionCompleted
          false, // isBreakTimeUp
          focusModeConfig,
        );

        buttonActions.action.fn();

        // Step 4: Verify tracking was paused and break was started
        setTimeout(() => {
          const unsetTaskCall = dispatchSpy.calls
            .all()
            .find((call) => call.args[0]?.type === '[Task] UnsetCurrentTask');
          expect(unsetTaskCall).toBeDefined();

          const startBreakCall = dispatchSpy.calls
            .all()
            .find((call) => call.args[0]?.type === actions.startBreak.type);
          expect(startBreakCall).toBeDefined();
          expect(startBreakCall?.args[0].pausedTaskId).toBe('task-123');
          done();
        }, 50);
      });
    });
  });
});
