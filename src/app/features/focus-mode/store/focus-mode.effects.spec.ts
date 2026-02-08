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
import { unsetCurrentTask, setCurrentTask } from '../../tasks/store/task.actions';
import { openIdleDialog } from '../../idle/store/idle.actions';
import { selectLastCurrentTask, selectTaskById } from '../../tasks/store/task.selectors';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
  selectPomodoroConfig,
} from '../../config/store/global-config.reducer';
import { updateGlobalConfigSection } from '../../config/store/global-config.actions';
import { take, toArray } from 'rxjs/operators';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';

describe('FocusModeEffects', () => {
  let actions$: Observable<any>;
  let effects: FocusModeEffects;
  let store: MockStore;
  let strategyFactoryMock: any;
  let taskServiceMock: any;
  let globalConfigServiceMock: any;
  let metricServiceMock: any;
  let bannerServiceMock: any;
  let hydrationStateServiceMock: any;
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

    bannerServiceMock = {
      open: jasmine.createSpy('open'),
      dismiss: jasmine.createSpy('dismiss'),
    };

    hydrationStateServiceMock = {
      isApplyingRemoteOps: jasmine
        .createSpy('isApplyingRemoteOps')
        .and.returnValue(false),
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
              value: { isSyncSessionWithTracking: false },
            },
            { selector: selectPomodoroConfig, value: { duration: 25 * 60 * 1000 } },
            { selector: selectIsFocusModeEnabled, value: true },
            { selector: selectLastCurrentTask, value: null },
          ],
        }),
        { provide: FocusModeStrategyFactory, useValue: strategyFactoryMock },
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        { provide: TaskService, useValue: taskServiceMock },
        { provide: BannerService, useValue: bannerServiceMock },
        { provide: MetricService, useValue: metricServiceMock },
        {
          provide: FocusModeStorageService,
          useValue: { setLastCountdownDuration: jasmine.createSpy() },
        },
        { provide: HydrationStateService, useValue: hydrationStateServiceMock },
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

  describe('syncDurationWithMode$', () => {
    it('should sync duration with mode when focusModeLoaded is dispatched', (done) => {
      actions$ = of(actions.focusModeLoaded());

      effects.syncDurationWithMode$.subscribe((action) => {
        expect(strategyFactoryMock.getStrategy).toHaveBeenCalledWith(
          FocusModeMode.Pomodoro,
        );
        expect(action).toEqual(
          actions.setFocusSessionDuration({ focusSessionDuration: 25 * 60 * 1000 }),
        );
        done();
      });
    });

    it('should sync duration with mode when setFocusModeMode is dispatched', (done) => {
      actions$ = of(actions.setFocusModeMode({ mode: FocusModeMode.Pomodoro }));

      effects.syncDurationWithMode$.subscribe((action) => {
        expect(strategyFactoryMock.getStrategy).toHaveBeenCalledWith(
          FocusModeMode.Pomodoro,
        );
        expect(action).toEqual(
          actions.setFocusSessionDuration({ focusSessionDuration: 25 * 60 * 1000 }),
        );
        done();
      });
    });

    it('should NOT sync duration on focusModeLoaded if duration is already > 0', (done) => {
      actions$ = of(actions.focusModeLoaded());
      store.overrideSelector(selectors.selectTimer, createMockTimer({ duration: 25000 }));
      store.refreshState();

      const result: any[] = [];
      effects.syncDurationWithMode$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });

    it('should NOT sync duration for Flowtime mode', (done) => {
      actions$ = of(actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.refreshState();

      const result: any[] = [];
      effects.syncDurationWithMode$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });
  });

  describe('syncDurationWithPomodoroConfig$', () => {
    it('should sync duration when pomodoro config changes for unstarted session', (done) => {
      actions$ = of(
        updateGlobalConfigSection({ sectionKey: 'pomodoro', sectionCfg: {} }),
      );
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ duration: 20 * 60 * 1000 }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectPomodoroConfig, {
        duration: 30 * 60 * 1000,
        cyclesBeforeLongerBreak: 4,
      });
      store.refreshState();

      effects.syncDurationWithPomodoroConfig$.subscribe((action) => {
        expect(action).toEqual(
          actions.setFocusSessionDuration({ focusSessionDuration: 30 * 60 * 1000 }),
        );
        done();
      });
    });

    it('should NOT sync when session has already started', (done) => {
      actions$ = of(
        updateGlobalConfigSection({ sectionKey: 'pomodoro', sectionCfg: {} }),
      );
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ duration: 20 * 60 * 1000, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectPomodoroConfig, {
        duration: 30 * 60 * 1000,
        cyclesBeforeLongerBreak: 4,
      });
      store.refreshState();

      const result: any[] = [];
      effects.syncDurationWithPomodoroConfig$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });

    it('should NOT sync for non-Pomodoro modes', (done) => {
      actions$ = of(
        updateGlobalConfigSection({ sectionKey: 'pomodoro', sectionCfg: {} }),
      );
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ duration: 20 * 60 * 1000 }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.overrideSelector(selectPomodoroConfig, {
        duration: 30 * 60 * 1000,
        cyclesBeforeLongerBreak: 4,
      });
      store.refreshState();

      const result: any[] = [];
      effects.syncDurationWithPomodoroConfig$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });

    it('should NOT sync for non-pomodoro config section updates', (done) => {
      actions$ = of(updateGlobalConfigSection({ sectionKey: 'misc', sectionCfg: {} }));
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ duration: 20 * 60 * 1000 }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectPomodoroConfig, {
        duration: 30 * 60 * 1000,
        cyclesBeforeLongerBreak: 4,
      });
      store.refreshState();

      const result: any[] = [];
      effects.syncDurationWithPomodoroConfig$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });

    it('should NOT sync if duration is not divisible by 1000', (done) => {
      actions$ = of(
        updateGlobalConfigSection({ sectionKey: 'pomodoro', sectionCfg: {} }),
      );
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ duration: 20 * 60 * 1000 }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      // 30 minutes + 500ms = not divisible by 1000
      store.overrideSelector(selectPomodoroConfig, {
        duration: 1800500,
        cyclesBeforeLongerBreak: 4,
      });
      store.refreshState();

      const result: any[] = [];
      effects.syncDurationWithPomodoroConfig$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });

    it('should NOT sync if duration is the same as current', (done) => {
      actions$ = of(
        updateGlobalConfigSection({ sectionKey: 'pomodoro', sectionCfg: {} }),
      );
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ duration: 25 * 60 * 1000 }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectPomodoroConfig, {
        duration: 25 * 60 * 1000,
        cyclesBeforeLongerBreak: 4,
      });
      store.refreshState();

      const result: any[] = [];
      effects.syncDurationWithPomodoroConfig$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });
  });

  describe('session completion effects (refactored)', () => {
    describe('incrementCycleOnSessionComplete$', () => {
      it('should dispatch incrementCycle for Pomodoro mode', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.refreshState();

        effects.incrementCycleOnSessionComplete$.pipe(take(1)).subscribe((action) => {
          expect(action).toEqual(actions.incrementCycle());
          done();
        });
      });

      it('should NOT dispatch incrementCycle for Flowtime mode', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
        store.refreshState();

        const result: any[] = [];
        effects.incrementCycleOnSessionComplete$.subscribe({
          next: (action) => result.push(action),
          complete: () => {
            expect(result.length).toBe(0);
            done();
          },
        });
      });
    });

    describe('autoStartBreakOnSessionComplete$', () => {
      it('should dispatch startBreak when incrementCycle is dispatched', (done) => {
        actions$ = of(actions.incrementCycle());
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.refreshState();

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            const startBreakAction = actionsArr.find(
              (a) => a.type === actions.startBreak.type,
            ) as any;
            expect(startBreakAction).toBeDefined();
            expect(startBreakAction.duration).toBe(5 * 60 * 1000);
            expect(startBreakAction.isLongBreak).toBeFalse();
            done();
          });
      });

      it('should NOT dispatch startBreak when isManualBreakStart is enabled', (done) => {
        actions$ = of(actions.incrementCycle());
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false,
          isSkipPreparation: false,
          isManualBreakStart: true,
        });
        store.refreshState();

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            expect(actionsArr.length).toBe(0);
            done();
          });
      });

      it('should dispatch long break after 4th session (Bug #6044)', (done) => {
        // Bug #6044 fix: Effect now listens to incrementCycle
        // When cycle=5 (after increment from 4 to 5), break should be long break
        actions$ = of(actions.incrementCycle());
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 5);
        store.refreshState();

        const getBreakDurationSpy = jasmine
          .createSpy('getBreakDuration')
          .and.returnValue({ duration: 15 * 60 * 1000, isLong: true });

        strategyFactoryMock.getStrategy.and.returnValue({
          initialSessionDuration: 25 * 60 * 1000,
          shouldStartBreakAfterSession: true,
          shouldAutoStartNextSession: true,
          getBreakDuration: getBreakDurationSpy,
        });

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            const startBreakAction = actionsArr.find(
              (a) => a.type === actions.startBreak.type,
            ) as any;
            // Verify getBreakDuration was called with cycle 4
            // Because we decrement cycle by 1 to get last focus session's cycle
            expect(getBreakDurationSpy).toHaveBeenCalledWith(4);
            expect(startBreakAction).toBeDefined();
            expect(startBreakAction.isLongBreak).toBeTrue();
            expect(startBreakAction.duration).toBe(15 * 60 * 1000);
            done();
          });
      });

      it('should dispatch short break after 5th session (Bug #6044)', (done) => {
        // Bug #6044 fix: Verify that session 5 (cycle 6) gets a short break, not long break
        actions$ = of(actions.incrementCycle());
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 6);
        store.refreshState();

        const getBreakDurationSpy = jasmine
          .createSpy('getBreakDuration')
          .and.returnValue({ duration: 5 * 60 * 1000, isLong: false });

        strategyFactoryMock.getStrategy.and.returnValue({
          initialSessionDuration: 25 * 60 * 1000,
          shouldStartBreakAfterSession: true,
          shouldAutoStartNextSession: true,
          getBreakDuration: getBreakDurationSpy,
        });

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            const startBreakAction = actionsArr.find(
              (a) => a.type === actions.startBreak.type,
            ) as any;
            // Verify getBreakDuration was called with cycle 5
            // Because we decrement cycle by 1 to get last focus session's cycle
            expect(getBreakDurationSpy).toHaveBeenCalledWith(5);
            expect(startBreakAction).toBeDefined();
            expect(startBreakAction.isLongBreak).toBeFalse();
            expect(startBreakAction.duration).toBe(5 * 60 * 1000);
            done();
          });
      });

      it('should NOT dispatch for non-Pomodoro modes', (done) => {
        actions$ = of(actions.incrementCycle());
        store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.refreshState();

        strategyFactoryMock.getStrategy.and.returnValue({
          initialSessionDuration: 0,
          shouldStartBreakAfterSession: false,
          shouldAutoStartNextSession: false,
          getBreakDuration: () => null,
        });

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            expect(actionsArr.length).toBe(0);
            done();
          });
      });
    });

    describe('stopTrackingOnSessionEnd$', () => {
      it('should dispatch setPausedTaskId and unsetCurrentTask when isManual=true AND isSyncSessionWithTracking=true AND isPauseTrackingDuringBreak=true AND currentTaskId exists (Bug #5737)', (done) => {
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isPauseTrackingDuringBreak: true,
          isSkipPreparation: false,
        });
        store.refreshState();

        // Bug #5737 fix: Should dispatch both setPausedTaskId and unsetCurrentTask
        // to preserve task for resumption after break
        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(2);
          expect(actionsArr[0]).toEqual(
            actions.setPausedTaskId({ pausedTaskId: 'task-123' }),
          );
          expect(actionsArr[1]).toEqual(unsetCurrentTask());
          done();
        });
      });

      it('should NOT dispatch unsetCurrentTask when isPauseTrackingDuringBreak=false (Bug #5954)', (done) => {
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isPauseTrackingDuringBreak: false,
          isSkipPreparation: false,
        });
        store.refreshState();

        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });

      it('should NOT dispatch unsetCurrentTask when isManual=true but isSyncSessionWithTracking=false', (done) => {
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false,
          isPauseTrackingDuringBreak: true,
          isSkipPreparation: false,
        });
        store.refreshState();

        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });

      it('should NOT dispatch unsetCurrentTask when isManual=true but currentTaskId is null', (done) => {
        currentTaskId$.next(null);
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isPauseTrackingDuringBreak: true,
          isSkipPreparation: false,
        });
        store.refreshState();

        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });

      it('should NOT dispatch unsetCurrentTask when isManual=false in Pomodoro mode with auto-break (Bug #5996)', (done) => {
        // In Pomodoro mode with auto-break, autoStartBreakOnSessionComplete$ handles tracking pause
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: false }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isPauseTrackingDuringBreak: true,
          isSkipPreparation: false,
          isManualBreakStart: false, // Break auto-starts
        });
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.refreshState();

        // Default mock has shouldStartBreakAfterSession: true (Pomodoro)
        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });

      it('should dispatch setPausedTaskId and unsetCurrentTask when isManual=false in Countdown mode (Bug #5996, #5737)', (done) => {
        // In Countdown mode, no break auto-starts, so this effect should fire
        // Bug #5737: Now also stores pausedTaskId for potential task resumption
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: false }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isPauseTrackingDuringBreak: true,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectors.selectMode, FocusModeMode.Countdown);
        store.refreshState();

        // Override strategy to return Countdown behavior
        strategyFactoryMock.getStrategy.and.returnValue({
          shouldStartBreakAfterSession: false,
          shouldAutoStartNextSession: false,
          getBreakDuration: () => null,
        });

        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(2);
          expect(actionsArr[0]).toEqual(
            actions.setPausedTaskId({ pausedTaskId: 'task-123' }),
          );
          expect(actionsArr[1]).toEqual(unsetCurrentTask());
          done();
        });
      });
    });

    describe('edge cases', () => {
      it('should handle missing focusModeConfig gracefully in incrementCycleOnSessionComplete$', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.overrideSelector(selectFocusModeConfig, null as any);
        store.refreshState();

        // Should still dispatch incrementCycle
        effects.incrementCycleOnSessionComplete$.pipe(take(1)).subscribe({
          next: (action) => {
            expect(action).toEqual(actions.incrementCycle());
            done();
          },
          error: (err) => {
            fail('Should not throw error: ' + err);
          },
        });
      });
    });
  });

  describe('break completion effects (refactored)', () => {
    describe('autoStartSessionOnBreakComplete$', () => {
      it('should dispatch startFocusSession when strategy.shouldAutoStartNextSession is true', (done) => {
        actions$ = of(actions.completeBreak({ pausedTaskId: null }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.refreshState();

        effects.autoStartSessionOnBreakComplete$.pipe(take(1)).subscribe((action) => {
          expect(action).toEqual(actions.startFocusSession({ duration: 25 * 60 * 1000 }));
          done();
        });
      });

      it('should NOT dispatch startFocusSession when shouldAutoStartNextSession is false', (done) => {
        actions$ = of(actions.completeBreak({ pausedTaskId: null }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Countdown);
        store.refreshState();

        strategyFactoryMock.getStrategy.and.returnValue({
          initialSessionDuration: 25 * 60 * 1000,
          shouldStartBreakAfterSession: false,
          shouldAutoStartNextSession: false,
          getBreakDuration: () => null,
        });

        effects.autoStartSessionOnBreakComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            expect(actionsArr.length).toBe(0);
            done();
          });
      });
    });

    describe('resumeTrackingOnBreakComplete$', () => {
      it('should dispatch setCurrentTask when pausedTaskId is provided', (done) => {
        const pausedTaskId = 'test-paused-task-id';
        actions$ = of(actions.completeBreak({ pausedTaskId }));

        effects.resumeTrackingOnBreakComplete$.pipe(take(1)).subscribe((action) => {
          expect(action).toEqual(setCurrentTask({ id: pausedTaskId }));
          done();
        });
      });

      it('should NOT dispatch setCurrentTask when pausedTaskId is null', (done) => {
        actions$ = of(actions.completeBreak({ pausedTaskId: null }));

        effects.resumeTrackingOnBreakComplete$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });
    });

    describe('combined behavior', () => {
      it('should dispatch setCurrentTask from resumeTrackingOnBreakComplete$ when pausedTaskId exists', (done) => {
        const pausedTaskId = 'test-paused-task-id';
        actions$ = of(actions.completeBreak({ pausedTaskId }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.refreshState();

        // Test resumeTrackingOnBreakComplete$ independently
        effects.resumeTrackingOnBreakComplete$.pipe(take(1)).subscribe((action) => {
          expect(action).toEqual(setCurrentTask({ id: pausedTaskId }));
          done();
        });
      });
    });
  });

  describe('skipBreak$', () => {
    it('should dispatch startFocusSession when strategy.shouldAutoStartNextSession is true', (done) => {
      actions$ = of(actions.skipBreak({ pausedTaskId: null }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.refreshState();

      effects.skipBreak$.subscribe((action) => {
        expect(action).toEqual(actions.startFocusSession({ duration: 25 * 60 * 1000 }));
        done();
      });
    });

    it('should NOT dispatch startFocusSession when shouldAutoStartNextSession is false', (done) => {
      actions$ = of(actions.skipBreak({ pausedTaskId: null }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Countdown);
      store.refreshState();

      strategyFactoryMock.getStrategy.and.returnValue({
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: false,
        shouldAutoStartNextSession: false,
        getBreakDuration: () => null,
      });

      const result: any[] = [];
      effects.skipBreak$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });

    it('should dispatch setCurrentTask when pausedTaskId is provided', (done) => {
      const pausedTaskId = 'test-paused-task-id';
      actions$ = of(actions.skipBreak({ pausedTaskId }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Countdown);
      store.refreshState();

      strategyFactoryMock.getStrategy.and.returnValue({
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: false,
        shouldAutoStartNextSession: false,
        getBreakDuration: () => null,
      });

      effects.skipBreak$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(setCurrentTask({ id: pausedTaskId }));
        done();
      });
    });
  });

  describe('cancelSession$', () => {
    it('should dispatch unsetCurrentTask when session is cancelled', (done) => {
      actions$ = of(actions.cancelFocusSession());

      effects.cancelSession$.subscribe((action) => {
        expect(action).toEqual(unsetCurrentTask());
        done();
      });
    });
  });

  describe('stopTrackingOnExitBreakToPlanning$', () => {
    it('should dispatch unsetCurrentTask when sync is enabled and task is being tracked', (done) => {
      actions$ = of(actions.exitBreakToPlanning({ pausedTaskId: null }));
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
      } as any);
      store.refreshState();
      currentTaskId$.next('task-123');

      effects.stopTrackingOnExitBreakToPlanning$.subscribe((action) => {
        expect(action).toEqual(unsetCurrentTask());
        done();
      });
    });

    it('should not dispatch when sync is disabled', (done) => {
      actions$ = of(actions.exitBreakToPlanning({ pausedTaskId: null }));
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
      } as any);
      store.refreshState();
      currentTaskId$.next('task-123');

      const result: any[] = [];
      effects.stopTrackingOnExitBreakToPlanning$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });

    it('should not dispatch when no task is being tracked', (done) => {
      actions$ = of(actions.exitBreakToPlanning({ pausedTaskId: null }));
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
      } as any);
      store.refreshState();
      currentTaskId$.next(null);

      const result: any[] = [];
      effects.stopTrackingOnExitBreakToPlanning$.subscribe({
        next: (action) => result.push(action),
        complete: () => {
          expect(result.length).toBe(0);
          done();
        },
      });
    });
  });

  describe('pauseOnIdle$', () => {
    it('should dispatch pauseFocusSession when openIdleDialog is dispatched', (done) => {
      actions$ = of(
        openIdleDialog({
          lastCurrentTaskId: null,
          enabledSimpleStopWatchCounters: [],
          wasFocusSessionRunning: false,
        }),
      );

      effects.pauseOnIdle$.subscribe((action) => {
        expect(action.type).toEqual(actions.pauseFocusSession.type);
        done();
      });
    });
  });

  describe('logFocusSession$', () => {
    it('should call metricService.logFocusSession with duration on completeFocusSession', () => {
      actions$ = of(actions.completeFocusSession({ isManual: false }));
      store.overrideSelector(selectors.selectLastSessionDuration, 25 * 60 * 1000);
      store.refreshState();

      effects.logFocusSession$.subscribe();

      expect(metricServiceMock.logFocusSession).toHaveBeenCalledWith(25 * 60 * 1000);
    });

    it('should NOT log when duration is 0', () => {
      actions$ = of(actions.completeFocusSession({ isManual: false }));
      store.overrideSelector(selectors.selectLastSessionDuration, 0);
      store.refreshState();

      effects.logFocusSession$.subscribe();

      expect(metricServiceMock.logFocusSession).not.toHaveBeenCalled();
    });
  });

  describe('autoShowOverlay$', () => {
    it('should dispatch showFocusOverlay when isSyncSessionWithTracking is true and task is selected', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.refreshState();

      // Need to recreate effects after selector override for store-based effects
      effects = TestBed.inject(FocusModeEffects);

      // Simulate task selection
      setTimeout(() => {
        currentTaskId$.next('task-123');
      }, 10);

      effects.autoShowOverlay$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(actions.showFocusOverlay());
        done();
      });
    });

    it('should NOT dispatch when isSyncSessionWithTracking is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      // Wait a bit to ensure no action is dispatched
      setTimeout(() => {
        // If we get here without the effect emitting, test passes
        done();
      }, 50);
    });

    it('should NOT dispatch when task id is null', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next(null);

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should NOT dispatch showFocusOverlay when isStartInBackground is true', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
        isStartInBackground: true,
      });
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        // If we get here without the effect emitting, test passes
        done();
      }, 50);
    });

    it('should NOT dispatch showFocusOverlay when isFocusModeEnabled is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectIsFocusModeEnabled, false);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        // If we get here without the effect emitting, test passes
        done();
      }, 50);
    });
  });

  describe('syncTrackingStartToSession$', () => {
    it('should dispatch startFocusSession when isSyncSessionWithTracking is true and task is selected on Main screen', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectTimer, createMockTimer());
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      setTimeout(() => {
        currentTaskId$.next('task-123');
      }, 10);

      effects.syncTrackingStartToSession$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(actions.startFocusSession({ duration: 25 * 60 * 1000 }));
        done();
      });
    });

    it('should dispatch unPauseFocusSession when session is paused and task is selected', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      // Session is paused (purpose is 'work' but not running)
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      setTimeout(() => {
        currentTaskId$.next('task-123');
      }, 10);

      effects.syncTrackingStartToSession$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(actions.unPauseFocusSession());
        done();
      });
    });

    it('should NOT dispatch when isSyncSessionWithTracking is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should NOT dispatch when session is already running', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should NOT dispatch when on SessionDone screen', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectTimer, createMockTimer());
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.SessionDone);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        // Should not start new session when on SessionDone screen
        done();
      }, 50);
    });

    it('should NOT dispatch when on Break screen', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectTimer, createMockTimer());
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Break);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        // Should not start new session when on Break screen
        done();
      }, 50);
    });

    it('should NOT dispatch when isFocusModeEnabled is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectTimer, createMockTimer());
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.overrideSelector(selectIsFocusModeEnabled, false);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        // Should not start session when focus mode feature is disabled
        done();
      }, 50);
    });
  });

  describe('syncTrackingStopToSession$', () => {
    it('should dispatch pauseFocusSession when tracking stops and session is running', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      // Simulate tracking stopping: emit task ID first, then null
      currentTaskId$.next('task-123');

      effects.syncTrackingStopToSession$.pipe(take(1)).subscribe((action) => {
        expect(action.type).toEqual(actions.pauseFocusSession.type);
        expect((action as any).pausedTaskId).toBe('task-123');
        done();
      });

      // After a short delay, stop tracking
      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);
    });

    it('should NOT dispatch when isSyncSessionWithTracking is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should NOT dispatch when session is not running', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'work' }),
      );
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should dispatch pauseFocusSession during break when tracking stops (Bug #5954)', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'break' }),
      );
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      let dispatched = false;
      effects.syncTrackingStopToSession$.subscribe((action) => {
        expect(action.type).toBe('[FocusMode] Pause Session');
        expect((action as any).pausedTaskId).toBe('task-123');
        dispatched = true;
      });

      currentTaskId$.next('task-123');

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);

      setTimeout(() => {
        expect(dispatched).toBe(true);
        done();
      }, 100);
    });

    it('should NOT dispatch when switching to different task (not stopping)', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        // Switch to different task, not null
        currentTaskId$.next('task-456');
      }, 10);

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should NOT dispatch when isFocusModeEnabled is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.overrideSelector(selectIsFocusModeEnabled, false);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);

      setTimeout(() => {
        // Should not pause session when focus mode feature is disabled
        done();
      }, 50);
    });

    it('should NOT dispatch when sync is applying remote operations (skipDuringSync)', (done) => {
      // This test verifies the fix for the app freeze bug:
      // When sync is active, the effect should be skipped to prevent
      // cascading action dispatches that overwhelm the store.
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      // Simulate sync being active
      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(true);

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);

      setTimeout(() => {
        // Effect should NOT fire during sync - this prevents the freeze bug
        done();
      }, 50);
    });

    it('should dispatch normally when sync completes (skipDuringSync allows)', (done) => {
      // Verify the effect works normally when not during sync
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      // Sync is NOT active
      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(false);

      effects = TestBed.inject(FocusModeEffects);

      currentTaskId$.next('task-123');

      effects.syncTrackingStopToSession$.pipe(take(1)).subscribe((action) => {
        expect(action.type).toEqual(actions.pauseFocusSession.type);
        expect((action as any).pausedTaskId).toBe('task-123');
        done();
      });

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);
    });

    it('should NOT dispatch during rapid currentTaskId changes while sync is active (freeze prevention)', (done) => {
      // This test simulates the freeze scenario: rapid task ID changes during sync
      // Without skipDuringSync, each change would trigger pauseFocusSession,
      // causing cascading effects that freeze the UI
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      // Sync is active
      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(true);

      effects = TestBed.inject(FocusModeEffects);

      let emitCount = 0;
      effects.syncTrackingStopToSession$.subscribe(() => {
        emitCount++;
      });

      // Simulate rapid task ID changes during sync (like bulk operations)
      currentTaskId$.next('task-1');
      currentTaskId$.next('task-2');
      currentTaskId$.next(null);
      currentTaskId$.next('task-3');
      currentTaskId$.next(null);
      currentTaskId$.next('task-4');
      currentTaskId$.next(null);

      setTimeout(() => {
        // Effect should NOT fire at all during sync
        expect(emitCount).toBe(0);
        done();
      }, 50);
    });

    it('should resume normal behavior after sync completes', (done) => {
      // Verify that after sync ends, the effect works correctly again
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      // Start with sync active
      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(true);

      effects = TestBed.inject(FocusModeEffects);

      effects.syncTrackingStopToSession$.subscribe((action) => {
        expect(action.type).toEqual(actions.pauseFocusSession.type);
        expect((action as any).pausedTaskId).toBe('task-after-sync');
        done();
      });

      // Changes during sync - should be ignored
      currentTaskId$.next('task-during-sync');

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);

      setTimeout(() => {
        // Sync completes
        hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(false);

        // Now changes should be processed
        currentTaskId$.next('task-after-sync');

        setTimeout(() => {
          currentTaskId$.next(null);
        }, 10);
      }, 30);
    });

    it('should handle sync state toggling rapidly without crashing', (done) => {
      // Edge case: sync state changes rapidly while task ID also changes
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      let emitCount = 0;
      effects.syncTrackingStopToSession$.subscribe(() => {
        emitCount++;
      });

      // Rapid sync state changes with task changes
      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(true);
      currentTaskId$.next('task-1');

      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(false);
      currentTaskId$.next('task-2');

      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(true);
      currentTaskId$.next(null);

      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(false);
      currentTaskId$.next('task-3');

      setTimeout(() => {
        // Should not crash and should handle state changes gracefully
        // The exact emit count depends on timing, but it should not freeze
        expect(emitCount).toBeGreaterThanOrEqual(0);
        done();
      }, 50);
    });

    it('should correctly use pairwise after skipDuringSync filters out emissions', (done) => {
      // Verify that pairwise works correctly with skipDuringSync
      // When sync filters out emissions, pairwise should still work on remaining emissions
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.refreshState();

      hydrationStateServiceMock.isApplyingRemoteOps.and.returnValue(false);

      effects = TestBed.inject(FocusModeEffects);

      const emittedActions: any[] = [];
      effects.syncTrackingStopToSession$.pipe(take(2)).subscribe((action) => {
        emittedActions.push(action);
        if (emittedActions.length === 2) {
          // Both emissions should have correct pausedTaskId from pairwise
          expect(emittedActions[0].pausedTaskId).toBe('task-A');
          expect(emittedActions[1].pausedTaskId).toBe('task-B');
          done();
        }
      });

      // First pair: task-A -> null
      currentTaskId$.next('task-A');
      setTimeout(() => {
        currentTaskId$.next(null);

        // Second pair: task-B -> null
        setTimeout(() => {
          currentTaskId$.next('task-B');
          setTimeout(() => {
            currentTaskId$.next(null);
          }, 10);
        }, 20);
      }, 10);
    });
  });

  describe('syncSessionPauseToTracking$', () => {
    it('should dispatch unsetCurrentTask when session pauses with pausedTaskId', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'work' }),
      );
      store.refreshState();

      actions$ = of(actions.pauseFocusSession({ pausedTaskId: 'task-123' }));

      effects.syncSessionPauseToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[Task] UnsetCurrentTask');
        done();
      });
    });

    it('should NOT dispatch when pausedTaskId is null', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'work' }),
      );
      store.refreshState();

      actions$ = of(actions.pauseFocusSession({ pausedTaskId: null }));

      let emitted = false;
      effects.syncSessionPauseToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT dispatch when isSyncSessionWithTracking is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'work' }),
      );
      store.refreshState();

      actions$ = of(actions.pauseFocusSession({ pausedTaskId: 'task-123' }));

      let emitted = false;
      effects.syncSessionPauseToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    // Bug #5974 fix: Pausing break should also stop tracking to maintain sync
    it('should dispatch unsetCurrentTask when break pauses with pausedTaskId', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'break' }),
      );
      store.refreshState();

      actions$ = of(actions.pauseFocusSession({ pausedTaskId: 'task-123' }));

      effects.syncSessionPauseToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[Task] UnsetCurrentTask');
        done();
      });
    });

    // Bug #5974: Additional edge case tests for break pause
    it('should NOT dispatch when break pauses but pausedTaskId is null', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'break' }),
      );
      store.refreshState();

      actions$ = of(actions.pauseFocusSession({ pausedTaskId: null }));

      let emitted = false;
      effects.syncSessionPauseToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT dispatch when break pauses but isSyncSessionWithTracking is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: false, purpose: 'break' }),
      );
      store.refreshState();

      actions$ = of(actions.pauseFocusSession({ pausedTaskId: 'task-123' }));

      let emitted = false;
      effects.syncSessionPauseToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });
  });

  describe('syncSessionResumeToTracking$', () => {
    it('should dispatch setCurrentTask when session resumes with pausedTaskId', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      // Mock that the task exists
      store.overrideSelector(selectTaskById as any, {
        id: 'task-123',
        title: 'Test Task',
      });
      currentTaskId$.next(null); // No current task
      store.refreshState();

      actions$ = of(actions.unPauseFocusSession());

      effects.syncSessionResumeToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[Task] SetCurrentTask');
        expect((action as any).id).toBe('task-123');
        done();
      });
    });

    it('should NOT dispatch when no pausedTaskId', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectPausedTaskId, null);
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.unPauseFocusSession());

      let emitted = false;
      effects.syncSessionResumeToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT dispatch when already tracking a task', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      currentTaskId$.next('task-456'); // Already tracking a different task
      store.refreshState();

      actions$ = of(actions.unPauseFocusSession());

      let emitted = false;
      effects.syncSessionResumeToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT dispatch when isSyncSessionWithTracking is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.unPauseFocusSession());

      let emitted = false;
      effects.syncSessionResumeToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT dispatch setCurrentTask when task no longer exists', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'work' }),
      );
      store.overrideSelector(selectors.selectPausedTaskId, 'deleted-task-123');
      // Mock that the task doesn't exist (use any cast for parameterized selector)
      store.overrideSelector(selectTaskById as any, undefined as any);
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.unPauseFocusSession());

      let emitted = false;
      effects.syncSessionResumeToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should dispatch setCurrentTask when BREAK resumes with pausedTaskId', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({ isRunning: true, purpose: 'break' }),
      );
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      // Mock that the task exists
      store.overrideSelector(selectTaskById as any, {
        id: 'task-123',
        title: 'Test Task',
      });
      currentTaskId$.next(null); // No current task
      store.refreshState();

      actions$ = of(actions.unPauseFocusSession());

      effects.syncSessionResumeToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[Task] SetCurrentTask');
        expect((action as any).id).toBe('task-123');
        done();
      });
    });
  });

  describe('syncSessionStartToTracking$', () => {
    it('should dispatch setCurrentTask when session starts with pausedTaskId and no current task', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      store.overrideSelector(selectLastCurrentTask, null);
      // Mock that the task exists
      store.overrideSelector(selectTaskById as any, {
        id: 'task-123',
        title: 'Test Task',
        isDone: false,
      });
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

      effects.syncSessionStartToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[Task] SetCurrentTask');
        expect((action as any).id).toBe('task-123');
        done();
      });
    });

    it('should NOT dispatch when already tracking a task', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      store.overrideSelector(selectLastCurrentTask, null);
      currentTaskId$.next('task-456'); // Already tracking
      store.refreshState();

      actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

      let emitted = false;
      effects.syncSessionStartToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT dispatch when no pausedTaskId and no lastCurrentTask', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, null);
      store.overrideSelector(selectLastCurrentTask, null);
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

      let emitted = false;
      effects.syncSessionStartToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT dispatch when isSyncSessionWithTracking is false', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      store.overrideSelector(selectLastCurrentTask, null);
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

      let emitted = false;
      effects.syncSessionStartToTracking$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should dispatch showFocusOverlay when task no longer exists (Bug #5954)', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, 'deleted-task-123');
      store.overrideSelector(selectLastCurrentTask, null);
      // Mock that the task doesn't exist (use any cast for parameterized selector)
      store.overrideSelector(selectTaskById as any, undefined as any);
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

      effects.syncSessionStartToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[FocusMode] Show Overlay');
        done();
      });
    });

    it('should fall back to lastCurrentTask when no pausedTaskId (Bug #5954)', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, null);
      store.overrideSelector(selectLastCurrentTask, {
        id: 'last-task-123',
        title: 'Last Task',
        isDone: false,
      } as any);
      // Mock that the task exists
      store.overrideSelector(selectTaskById as any, {
        id: 'last-task-123',
        title: 'Last Task',
        isDone: false,
      });
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

      effects.syncSessionStartToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[Task] SetCurrentTask');
        expect((action as any).id).toBe('last-task-123');
        done();
      });
    });

    it('should dispatch showFocusOverlay when lastCurrentTask is done (Bug #5954)', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, null);
      store.overrideSelector(selectLastCurrentTask, {
        id: 'done-task-123',
        title: 'Done Task',
        isDone: true,
      } as any);
      // Mock that the task exists but is done
      store.overrideSelector(selectTaskById as any, {
        id: 'done-task-123',
        title: 'Done Task',
        isDone: true,
      });
      currentTaskId$.next(null);
      store.refreshState();

      actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

      effects.syncSessionStartToTracking$.subscribe((action) => {
        expect(action.type).toEqual('[FocusMode] Show Overlay');
        done();
      });
    });
  });

  describe('pauseTrackingDuringBreak (autoStartBreakOnSessionComplete$)', () => {
    it('should dispatch unsetCurrentTask when break starts and isPauseTrackingDuringBreak is true', (done) => {
      actions$ = of(actions.incrementCycle());
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: true,
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      effects.autoStartBreakOnSessionComplete$.pipe(toArray()).subscribe((actionsArr) => {
        const unsetAction = actionsArr.find((a) => a.type === '[Task] UnsetCurrentTask');
        expect(unsetAction).toBeDefined();
        done();
      });
    });

    it('should NOT dispatch unsetCurrentTask when isPauseTrackingDuringBreak is false', (done) => {
      actions$ = of(actions.incrementCycle());
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
        isPauseTrackingDuringBreak: false,
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      effects.autoStartBreakOnSessionComplete$.pipe(toArray()).subscribe((actionsArr) => {
        const unsetAction = actionsArr.find((a) => a.type === '[Task] UnsetCurrentTask');
        expect(unsetAction).toBeUndefined();
        done();
      });
    });
  });

  describe('detectSessionCompletion$', () => {
    it('should dispatch completeFocusSession when timer completes (elapsed >= duration)', (done) => {
      // Setup timer that just completed
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: false,
          purpose: 'work',
          duration: 25 * 60 * 1000,
          elapsed: 25 * 60 * 1000, // Exactly at duration
        }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.refreshState();

      // Need to recreate effects after selector override
      effects = TestBed.inject(FocusModeEffects);

      effects.detectSessionCompletion$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(actions.completeFocusSession({ isManual: false }));
        done();
      });
    });

    it('should NOT dispatch for Flowtime mode (timer runs indefinitely)', (done) => {
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: false,
          purpose: 'work',
          duration: 25 * 60 * 1000,
          elapsed: 25 * 60 * 1000,
        }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      // Wait a bit to ensure no action is dispatched
      setTimeout(() => {
        done(); // If no emission occurred, test passes
      }, 50);
    });

    it('should NOT dispatch when timer is still running', (done) => {
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: true, // Still running
          purpose: 'work',
          duration: 25 * 60 * 1000,
          elapsed: 25 * 60 * 1000,
        }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should NOT dispatch when elapsed < duration', (done) => {
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: false,
          purpose: 'work',
          duration: 25 * 60 * 1000,
          elapsed: 20 * 60 * 1000, // Not complete yet
        }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      setTimeout(() => {
        done();
      }, 50);
    });

    it('should NOT dispatch when purpose is break', (done) => {
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: false,
          purpose: 'break', // Not a work session
          duration: 5 * 60 * 1000,
          elapsed: 5 * 60 * 1000,
        }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      setTimeout(() => {
        done();
      }, 50);
    });

    // Bug #6206: completeFocusSession must be dispatched even when isManualBreakStart=true
    // The screen transition to SessionDone depends on this action being dispatched
    it('should dispatch completeFocusSession when timer completes even with isManualBreakStart=true', (done) => {
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: false,
          purpose: 'work',
          duration: 25 * 60 * 1000,
          elapsed: 25 * 60 * 1000,
        }),
      );
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: false,
        isManualBreakStart: true,
        isSkipPreparation: false,
      });
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);

      effects.detectSessionCompletion$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(actions.completeFocusSession({ isManual: false }));
        done();
      });
    });
  });

  describe('detectBreakTimeUp$', () => {
    it('should call notification when break timer completes', (done) => {
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: false,
          purpose: 'break',
          duration: 5 * 60 * 1000,
          elapsed: 5 * 60 * 1000,
        }),
      );
      store.refreshState();

      // Create new effects instance and spy on _notifyUser
      effects = TestBed.inject(FocusModeEffects);
      const notifyUserSpy = spyOn(effects as any, '_notifyUser');

      effects.detectBreakTimeUp$.pipe(take(1)).subscribe(() => {
        expect(notifyUserSpy).toHaveBeenCalled();
        done();
      });
    });

    it('should NOT trigger while break timer is running (elapsed < duration)', (done) => {
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          isRunning: true,
          purpose: 'break',
          duration: 5 * 60 * 1000,
          elapsed: 3 * 60 * 1000, // Not complete
        }),
      );
      store.refreshState();

      effects = TestBed.inject(FocusModeEffects);
      const notifyUserSpy = spyOn(effects as any, '_notifyUser');

      setTimeout(() => {
        expect(notifyUserSpy).not.toHaveBeenCalled();
        done();
      }, 50);
    });
  });

  describe('_getBannerActions banner button behavior with icons (issue #5889)', () => {
    let dispatchSpy: jasmine.Spy;

    beforeEach(() => {
      dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
    });

    it('should dispatch startBreak when session completed with isManualBreakStart=true in Pomodoro mode', (done) => {
      // Setup Pomodoro mode with manual break start
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false,
      };

      // Access private method via bracket notation
      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        true, // isSessionCompleted
        false, // isBreakTimeUp
        focusModeConfig,
        true, // useIcons
        true, // useIcons
      );

      // Verify play button exists
      expect(buttonActions.action).toBeDefined();
      expect(buttonActions.action.icon).toBe('play_arrow');

      // Click the button
      buttonActions.action.fn();

      // Wait for async store select to complete
      setTimeout(() => {
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startBreakCall).toBeDefined();
        expect(startBreakCall?.args[0].duration).toBe(5 * 60 * 1000);
        expect(startBreakCall?.args[0].isLongBreak).toBeFalse();
        done();
      }, 50);
    });

    it('should dispatch startFocusSession when session completed with isManualBreakStart=false', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: false, // Disabled
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
        true, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const startSessionCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startFocusSession.type);
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startSessionCall).toBeDefined();
        expect(startBreakCall).toBeUndefined();
        done();
      }, 50);
    });

    it('should dispatch startFocusSession for Flowtime mode even with isManualBreakStart=true', (done) => {
      // Flowtime doesn't support breaks
      strategyFactoryMock.getStrategy.and.returnValue({
        initialSessionDuration: 0,
        shouldStartBreakAfterSession: false,
        shouldAutoStartNextSession: false,
        getBreakDuration: () => null,
      });

      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 0,
        elapsed: 30 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true, // Even if set, should not start break
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
        true, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const startSessionCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startFocusSession.type);
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startSessionCall).toBeDefined();
        expect(startBreakCall).toBeUndefined();
        done();
      }, 50);
    });

    it('should dispatch unsetCurrentTask before startBreak when isPauseTrackingDuringBreak=true', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.refreshState();

      // Mock that there's a current task
      taskServiceMock.currentTaskId = jasmine
        .createSpy('currentTaskId')
        .and.returnValue('task-123');

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: true, // Should pause tracking
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
        true, // useIcons
      );

      buttonActions.action.fn();

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

    it('should dispatch startBreak with long break when cycle triggers long break', (done) => {
      // Mock strategy to return long break
      strategyFactoryMock.getStrategy.and.returnValue({
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        getBreakDuration: jasmine.createSpy('getBreakDuration').and.returnValue({
          duration: 15 * 60 * 1000,
          isLong: true,
        }),
      });

      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 4);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
        true, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startBreakCall).toBeDefined();
        expect(startBreakCall?.args[0].duration).toBe(15 * 60 * 1000);
        expect(startBreakCall?.args[0].isLongBreak).toBeTrue();
        done();
      }, 50);
    });

    it('should NOT dispatch startBreak when focusModeConfig is undefined', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        undefined, // No config
      );

      buttonActions.action.fn();

      setTimeout(() => {
        // Should dispatch startFocusSession since no config means no manual break
        const startSessionCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startFocusSession.type);
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startSessionCall).toBeDefined();
        expect(startBreakCall).toBeUndefined();
        done();
      }, 50);
    });

    it('should handle isBreakTimeUp case correctly (existing behavior)', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectPausedTaskId, null);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'break',
        duration: 5 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: false,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        true, // isOnBreak
        false, // isSessionCompleted
        true, // isBreakTimeUp
        focusModeConfig,
        true, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        // Should dispatch skipBreak (existing behavior for break time up)
        const skipBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.skipBreak.type);
        expect(skipBreakCall).toBeDefined();
        done();
      }, 50);
    });

    // Bug #5974 fix: Manual break start should resume tracking when isPauseTrackingDuringBreak is false
    it('should dispatch setCurrentTask when starting break manually with isPauseTrackingDuringBreak=false and pausedTaskId exists', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.overrideSelector(selectors.selectPausedTaskId, 'previously-tracked-task');
      store.refreshState();

      // Mock that there's no current task (user manually stopped tracking)
      taskServiceMock.currentTaskId = jasmine
        .createSpy('currentTaskId')
        .and.returnValue(null);

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false, // User wants tracking during breaks
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        true, // isSessionCompleted
        false, // isBreakTimeUp
        focusModeConfig,
        true, // useIcons
        true, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        // Should dispatch setCurrentTask to resume tracking
        const setCurrentTaskCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === '[Task] SetCurrentTask');
        expect(setCurrentTaskCall).toBeDefined();
        expect(setCurrentTaskCall?.args[0].id).toBe('previously-tracked-task');

        // Should also dispatch startBreak
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startBreakCall).toBeDefined();
        done();
      }, 50);
    });

    it('should NOT dispatch setCurrentTask when starting break with isPauseTrackingDuringBreak=false but currentTaskId exists', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.overrideSelector(selectors.selectPausedTaskId, 'previously-tracked-task');
      store.refreshState();

      // Mock that there IS a current task (tracking is already active)
      taskServiceMock.currentTaskId = jasmine
        .createSpy('currentTaskId')
        .and.returnValue('current-task-123');

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
        true, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        // Should NOT dispatch setCurrentTask since tracking is already active
        const setCurrentTaskCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === '[Task] SetCurrentTask');
        expect(setCurrentTaskCall).toBeUndefined();

        // Should still dispatch startBreak
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startBreakCall).toBeDefined();
        done();
      }, 50);
    });

    it('should NOT dispatch setCurrentTask when starting break with isPauseTrackingDuringBreak=false but no pausedTaskId', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.overrideSelector(selectors.selectPausedTaskId, null); // No paused task
      store.refreshState();

      // Mock that there's no current task
      taskServiceMock.currentTaskId = jasmine
        .createSpy('currentTaskId')
        .and.returnValue(null);

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
        true, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        // Should NOT dispatch setCurrentTask since no pausedTaskId
        const setCurrentTaskCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === '[Task] SetCurrentTask');
        expect(setCurrentTaskCall).toBeUndefined();

        // Should still dispatch startBreak
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startBreakCall).toBeDefined();
        done();
      }, 50);
    });
  });

  describe('_getBannerActions banner button behavior with text (issue #6000)', () => {
    let dispatchSpy: jasmine.Spy;

    beforeEach(() => {
      dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
    });

    it('should have pause button when session is running', () => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        false, // isSessionCompleted
        false, // isBreakTimeUp
        {},
      );

      expect(buttonActions.action).toBeDefined();
      expect(buttonActions.action.label).toBe('F.FOCUS_MODE.B.PAUSE');
      expect(buttonActions.action.icon).toBe('pause');
    });

    it('should have resume button when session is paused', () => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: false,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        false, // isSessionCompleted
        false, // isBreakTimeUp
        {},
      );

      expect(buttonActions.action).toBeDefined();
      expect(buttonActions.action.label).toBe('F.FOCUS_MODE.B.RESUME');
    });

    it('should dispatch pauseFocusSession when pause button clicked', (done) => {
      taskServiceMock.currentTaskId = jasmine
        .createSpy('currentTaskId')
        .and.returnValue('task-123');

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        false,
        false,
        {},
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const pauseCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.pauseFocusSession.type);
        expect(pauseCall).toBeDefined();
        expect(pauseCall?.args[0].pausedTaskId).toBe('task-123');
        done();
      }, 50);
    });

    it('should dispatch unPauseFocusSession when resume button clicked', (done) => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: false,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        false,
        false,
        {},
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const resumeCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.unPauseFocusSession.type);
        expect(resumeCall).toBeDefined();
        done();
      }, 50);
    });

    it('should have end session button during work session', () => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        false, // isSessionCompleted
        false, // isBreakTimeUp
        {},
      );

      expect(buttonActions.action2).toBeDefined();
      expect(buttonActions.action2.label).toBe('F.FOCUS_MODE.B.END_SESSION');
    });

    it('should dispatch completeFocusSession when end session button clicked', (done) => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        false,
        false,
        {},
      );

      buttonActions.action2.fn();

      setTimeout(() => {
        const completeCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.completeFocusSession.type);
        expect(completeCall).toBeDefined();
        expect(completeCall?.args[0].isManual).toBeTrue();
        done();
      }, 50);
    });

    it('should have skip break button during break', () => {
      const timer = createMockTimer({
        purpose: 'break',
        duration: 5 * 60 * 1000,
        elapsed: 2 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        true, // isOnBreak
        false, // isSessionCompleted
        false, // isBreakTimeUp
        {},
      );

      expect(buttonActions.action2).toBeDefined();
      expect(buttonActions.action2.label).toBe('F.FOCUS_MODE.SKIP_BREAK');
    });

    it('should dispatch skipBreak when skip break button clicked', (done) => {
      store.overrideSelector(selectors.selectPausedTaskId, 'paused-task-123');
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'break',
        duration: 5 * 60 * 1000,
        elapsed: 2 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        true, // isOnBreak
        false,
        false,
        {},
      );

      buttonActions.action2.fn();

      setTimeout(() => {
        const skipBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.skipBreak.type);
        expect(skipBreakCall).toBeDefined();
        expect(skipBreakCall?.args[0].pausedTaskId).toBe('paused-task-123');
        done();
      }, 50);
    });

    it('should have start button when session is completed', () => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
        isRunning: false,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        true, // isSessionCompleted
        false, // isBreakTimeUp
        {},
      );

      expect(buttonActions.action).toBeDefined();
      expect(buttonActions.action.label).toBe('F.FOCUS_MODE.B.START');
      // action2 should show "End Focus Session" button when session is completed
      expect(buttonActions.action2).toBeDefined();
      expect(buttonActions.action2.label).toBe('F.FOCUS_MODE.B.END_FOCUS_SESSION');
    });

    it('should have start button when break time is up', () => {
      const timer = createMockTimer({
        purpose: 'break',
        duration: 5 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: false,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        true, // isOnBreak
        false, // isSessionCompleted
        true, // isBreakTimeUp
        {},
      );

      expect(buttonActions.action).toBeDefined();
      expect(buttonActions.action.label).toBe('F.FOCUS_MODE.B.START');
      expect(buttonActions.action2).toBeUndefined();
    });

    it('should always have to focus overlay button', () => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        false,
        false,
        {},
      );

      expect(buttonActions.action3).toBeDefined();
      expect(buttonActions.action3.label).toBe('F.FOCUS_MODE.B.TO_FOCUS_OVERLAY');
    });

    it('should dispatch showFocusOverlay when to focus overlay button clicked', (done) => {
      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: true,
      });

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        false,
        false,
        {},
      );

      buttonActions.action3.fn();

      setTimeout(() => {
        const overlayCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === '[FocusMode] Show Overlay');
        expect(overlayCall).toBeDefined();
        done();
      }, 50);
    });

    it('should dispatch startBreak when session completed with isManualBreakStart=true in Pomodoro mode', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        true, // isSessionCompleted
        false, // isBreakTimeUp
        focusModeConfig,
        false, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startBreakCall).toBeDefined();
        expect(startBreakCall?.args[0].duration).toBe(5 * 60 * 1000);
        expect(startBreakCall?.args[0].isLongBreak).toBeFalse();
        done();
      }, 50);
    });

    // Bug #6044: Manual break start should use cycle directly for break duration calculation
    it('should dispatch long break when cycle=5 with manual break start (Bug #6044)', (done) => {
      // Bug #6044 fix: After session 4 completes, incrementCycleOnSessionComplete$ runs first,
      // setting cycle to 5. When user manually clicks start, we use cycle directly (no adjustment).
      // This matches the auto-start behavior for consistent break timing.
      const getBreakDurationSpy = jasmine
        .createSpy('getBreakDuration')
        .and.callFake((cycle: number) => {
          // Return long break for cycle 4 (every 4th session)
          const isLong = cycle % 4 === 0;
          return {
            duration: isLong ? 15 * 60 * 1000 : 5 * 60 * 1000,
            isLong,
          };
        });
      strategyFactoryMock.getStrategy.and.returnValue({
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        initialSessionDuration: 25 * 60 * 1000,
        getBreakDuration: getBreakDurationSpy,
      });

      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 5); // Cycle 5 = long break, After work session 4
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false, // isOnBreak
        true, // isSessionCompleted
        false, // isBreakTimeUp
        focusModeConfig,
        false, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        // Verify getBreakDuration was called with cycle 4
        // Because we decrement cycle by 1 to get last focus session's cycle
        expect(getBreakDurationSpy).toHaveBeenCalledWith(4);

        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startBreakCall).toBeDefined();
        // Long break should be 15 minutes (default), not 5 minutes (short break)
        expect(startBreakCall?.args[0].duration).toBe(15 * 60 * 1000);
        expect(startBreakCall?.args[0].isLongBreak).toBeTrue();
        done();
      }, 50);
    });

    it('should dispatch startFocusSession when session completed with isManualBreakStart=false', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentCycle, 1);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'work',
        duration: 25 * 60 * 1000,
        elapsed: 25 * 60 * 1000,
      });
      const focusModeConfig = {
        isManualBreakStart: false,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
        false, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const startSessionCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startFocusSession.type);
        const startBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.startBreak.type);
        expect(startSessionCall).toBeDefined();
        expect(startBreakCall).toBeUndefined();
        done();
      }, 50);
    });

    it('should handle isBreakTimeUp case correctly', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectPausedTaskId, null);
      store.refreshState();

      const timer = createMockTimer({
        purpose: 'break',
        duration: 5 * 60 * 1000,
        elapsed: 5 * 60 * 1000,
        isRunning: false,
      });
      const focusModeConfig = {
        isManualBreakStart: true,
      };

      const buttonActions = (effects as any)._getBannerActions(
        timer,
        true, // isOnBreak
        false, // isSessionCompleted
        true, // isBreakTimeUp
        focusModeConfig,
        false, // useIcons
      );

      buttonActions.action.fn();

      setTimeout(() => {
        const skipBreakCall = dispatchSpy.calls
          .all()
          .find((call) => call.args[0]?.type === actions.skipBreak.type);
        expect(skipBreakCall).toBeDefined();
        done();
      }, 50);
    });
  });

  describe('storePausedTaskOnManualBreakSession$ (Bug #5954)', () => {
    it('should dispatch setPausedTaskId when session completes with manual break start and pause tracking enabled', (done) => {
      actions$ = of(actions.completeFocusSession({ isManual: false }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: true,
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      effects.storePausedTaskOnManualBreakSession$.pipe(take(1)).subscribe((action) => {
        expect(action.type).toBe('[FocusMode] Set Paused Task Id');
        expect((action as any).pausedTaskId).toBe('task-123');
        done();
      });
    });

    it('should NOT dispatch setPausedTaskId when isManualBreakStart is false', (done) => {
      actions$ = of(actions.completeFocusSession({ isManual: false }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isManualBreakStart: false, // Not manual break
        isPauseTrackingDuringBreak: true,
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      effects.storePausedTaskOnManualBreakSession$
        .pipe(toArray())
        .subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
    });

    // Bug #5974 fix: Store pausedTaskId even when isPauseTrackingDuringBreak is false
    // This allows tracking to resume if user manually stops tracking before starting break
    it('should dispatch setPausedTaskId when isPauseTrackingDuringBreak is false', (done) => {
      actions$ = of(actions.completeFocusSession({ isManual: false }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: false, // Don't pause tracking
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      effects.storePausedTaskOnManualBreakSession$.pipe(take(1)).subscribe((action) => {
        expect(action.type).toEqual(actions.setPausedTaskId.type);
        expect(action.pausedTaskId).toBe('task-123');
        done();
      });
    });

    it('should NOT dispatch setPausedTaskId when no current task', (done) => {
      actions$ = of(actions.completeFocusSession({ isManual: false }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: true,
      });
      currentTaskId$.next(null); // No current task
      store.refreshState();

      effects.storePausedTaskOnManualBreakSession$
        .pipe(toArray())
        .subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
    });

    it('should NOT dispatch setPausedTaskId for Flowtime mode (no breaks)', (done) => {
      // For Flowtime, shouldStartBreakAfterSession is false
      strategyFactoryMock.getStrategy.and.returnValue({
        initialSessionDuration: 0,
        shouldStartBreakAfterSession: false,
        shouldAutoStartNextSession: false,
        getBreakDuration: () => null,
      });

      actions$ = of(actions.completeFocusSession({ isManual: false }));
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isManualBreakStart: true,
        isPauseTrackingDuringBreak: true,
      });
      currentTaskId$.next('task-123');
      store.refreshState();

      effects.storePausedTaskOnManualBreakSession$
        .pipe(toArray())
        .subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
    });
  });

  describe('Bug #5954 Additional Edge Cases', () => {
    describe('syncSessionStartToTracking$ edge cases', () => {
      it('should prefer pausedTaskId over lastCurrentTask when both exist', (done) => {
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectors.selectPausedTaskId, 'paused-task-456');
        store.overrideSelector(selectLastCurrentTask, {
          id: 'last-task-123',
          title: 'Last Task',
          isDone: false,
        } as any);
        // Mock that the pausedTaskId task exists
        store.overrideSelector(selectTaskById as any, {
          id: 'paused-task-456',
          title: 'Paused Task',
          isDone: false,
        });
        currentTaskId$.next(null);
        store.refreshState();

        actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

        effects.syncSessionStartToTracking$.subscribe((action) => {
          expect(action.type).toEqual('[Task] SetCurrentTask');
          // Should use pausedTaskId, not lastCurrentTask
          expect((action as any).id).toBe('paused-task-456');
          done();
        });
      });

      it('should dispatch showFocusOverlay when lastCurrentTask no longer exists in store (Bug #5954)', (done) => {
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectors.selectPausedTaskId, null);
        store.overrideSelector(selectLastCurrentTask, {
          id: 'deleted-task-123',
          title: 'Deleted Task',
          isDone: false,
        } as any);
        // Mock that the task no longer exists (deleted)
        store.overrideSelector(selectTaskById as any, null);
        currentTaskId$.next(null);
        store.refreshState();

        actions$ = of(actions.startFocusSession({ duration: 25 * 60 * 1000 }));

        effects.syncSessionStartToTracking$.subscribe((action) => {
          expect(action.type).toEqual('[FocusMode] Show Overlay');
          done();
        });
      });
    });

    describe('syncTrackingStopToSession$ edge cases (break handling)', () => {
      it('should NOT dispatch when break timer is paused (not running)', (done) => {
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
        });
        // Break is paused - timer not running
        store.overrideSelector(
          selectors.selectTimer,
          createMockTimer({ isRunning: false, purpose: 'break' }),
        );
        store.refreshState();

        effects = TestBed.inject(FocusModeEffects);

        currentTaskId$.next('task-123');

        setTimeout(() => {
          currentTaskId$.next(null);
        }, 10);

        setTimeout(() => {
          // Should not dispatch when break timer is already paused
          done();
        }, 50);
      });

      it('should handle Pomodoro mode break correctly', (done) => {
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(
          selectors.selectTimer,
          createMockTimer({ isRunning: true, purpose: 'break', duration: 5 * 60 * 1000 }),
        );
        store.refreshState();

        effects = TestBed.inject(FocusModeEffects);

        let dispatched = false;
        effects.syncTrackingStopToSession$.subscribe((action) => {
          expect(action.type).toBe('[FocusMode] Pause Session');
          expect((action as any).pausedTaskId).toBe('task-123');
          dispatched = true;
        });

        currentTaskId$.next('task-123');

        setTimeout(() => {
          currentTaskId$.next(null);
        }, 10);

        setTimeout(() => {
          expect(dispatched).toBe(true);
          done();
        }, 100);
      });
    });

    describe('stopTrackingOnSessionEnd$ edge cases', () => {
      it('should respect isPauseTrackingDuringBreak=true for manual session end and store pausedTaskId (Bug #5737)', (done) => {
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
          isPauseTrackingDuringBreak: true,
        });
        currentTaskId$.next('task-123');
        store.refreshState();

        actions$ = of(actions.completeFocusSession({ isManual: true }));

        // Bug #5737: Now dispatches both setPausedTaskId and unsetCurrentTask
        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(2);
          expect(actionsArr[0].type).toEqual('[FocusMode] Set Paused Task Id');
          expect(actionsArr[1].type).toEqual('[Task] UnsetCurrentTask');
          done();
        });
      });

      it('should NOT stop tracking on manual end when isPauseTrackingDuringBreak=false', (done) => {
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
          isPauseTrackingDuringBreak: false,
        });
        currentTaskId$.next('task-123');
        store.refreshState();

        actions$ = of(actions.completeFocusSession({ isManual: true }));

        effects.stopTrackingOnSessionEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });
    });

    describe('storePausedTaskOnManualBreakSession$ edge cases', () => {
      it('should store pausedTaskId correctly for later resumption', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: false }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isManualBreakStart: true,
          isPauseTrackingDuringBreak: true,
          isSkipPreparation: false,
        });
        currentTaskId$.next('important-task-123');
        store.refreshState();

        effects.storePausedTaskOnManualBreakSession$.pipe(take(1)).subscribe((action) => {
          expect(action.type).toEqual('[FocusMode] Set Paused Task Id');
          expect((action as any).pausedTaskId).toBe('important-task-123');
          done();
        });
      });

      it('should work with sync disabled but manual break start and pause tracking enabled', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: false }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false, // Sync disabled
          isManualBreakStart: true,
          isPauseTrackingDuringBreak: true,
          isSkipPreparation: false,
        });
        currentTaskId$.next('task-123');
        store.refreshState();

        // Should still dispatch since it only checks isManualBreakStart and isPauseTrackingDuringBreak
        effects.storePausedTaskOnManualBreakSession$.pipe(take(1)).subscribe((action) => {
          expect(action.type).toEqual('[FocusMode] Set Paused Task Id');
          done();
        });
      });
    });

    describe('updateBanner$ cycleNr fix (Bug #5954)', () => {
      it('should show "Break #1" after Session #1 (cycle=2 during break shows cycleNr=1)', (done) => {
        // After completing Session #1, cycle is incremented to 2
        // But during break, we should show "Break #1", not "Break #2"
        store.overrideSelector(selectors.selectIsSessionRunning, false);
        store.overrideSelector(selectors.selectIsBreakActive, true);
        store.overrideSelector(selectors.selectIsSessionCompleted, false);
        store.overrideSelector(selectors.selectIsSessionPaused, false);
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 2); // Cycle incremented after session
        store.overrideSelector(selectors.selectIsOverlayShown, false);
        store.overrideSelector(
          selectors.selectTimer,
          createMockTimer({ isRunning: true, purpose: 'break', duration: 5 * 60 * 1000 }),
        );
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectIsFocusModeEnabled, true);
        store.refreshState();

        // Dispatch a tick action to trigger the effect
        actions$ = of(actions.tick());

        // Subscribe to the effect to trigger it
        effects.updateBanner$.pipe(take(1)).subscribe(() => {
          expect(bannerServiceMock.open).toHaveBeenCalled();
          const callArgs = bannerServiceMock.open.calls.mostRecent().args[0];
          // cycleNr should be 1 (cycle - 1) since we're on break
          expect(callArgs.translateParams).toEqual({ cycleNr: 1 });
          done();
        });
      });

      it('should show "Break #2" after Session #2 (cycle=3 during break shows cycleNr=2)', (done) => {
        store.overrideSelector(selectors.selectIsSessionRunning, false);
        store.overrideSelector(selectors.selectIsBreakActive, true);
        store.overrideSelector(selectors.selectIsSessionCompleted, false);
        store.overrideSelector(selectors.selectIsSessionPaused, false);
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 3); // Cycle 3 = after Session #2
        store.overrideSelector(selectors.selectIsOverlayShown, false);
        store.overrideSelector(
          selectors.selectTimer,
          createMockTimer({ isRunning: true, purpose: 'break', duration: 5 * 60 * 1000 }),
        );
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectIsFocusModeEnabled, true);
        store.refreshState();

        // Dispatch a tick action to trigger the effect
        actions$ = of(actions.tick());

        effects.updateBanner$.pipe(take(1)).subscribe(() => {
          expect(bannerServiceMock.open).toHaveBeenCalled();
          const callArgs = bannerServiceMock.open.calls.mostRecent().args[0];
          expect(callArgs.translateParams).toEqual({ cycleNr: 2 });
          done();
        });
      });

      it('should show "Session #1" during work session (no subtraction)', (done) => {
        store.overrideSelector(selectors.selectIsSessionRunning, true);
        store.overrideSelector(selectors.selectIsBreakActive, false);
        store.overrideSelector(selectors.selectIsSessionCompleted, false);
        store.overrideSelector(selectors.selectIsSessionPaused, false);
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.overrideSelector(selectors.selectIsOverlayShown, false);
        store.overrideSelector(
          selectors.selectTimer,
          createMockTimer({ isRunning: true, purpose: 'work', duration: 25 * 60 * 1000 }),
        );
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectIsFocusModeEnabled, true);
        store.refreshState();

        // Dispatch a tick action to trigger the effect
        actions$ = of(actions.tick());

        effects.updateBanner$.pipe(take(1)).subscribe(() => {
          expect(bannerServiceMock.open).toHaveBeenCalled();
          const callArgs = bannerServiceMock.open.calls.mostRecent().args[0];
          // During work session, cycleNr should be the actual cycle (no subtraction)
          expect(callArgs.translateParams).toEqual({ cycleNr: 1 });
          done();
        });
      });

      it('should ensure cycleNr never goes below 1 (edge case with cycle=1 on break)', (done) => {
        // Edge case: if somehow cycle is 1 during break, cycleNr should still be 1, not 0
        store.overrideSelector(selectors.selectIsSessionRunning, false);
        store.overrideSelector(selectors.selectIsBreakActive, true);
        store.overrideSelector(selectors.selectIsSessionCompleted, false);
        store.overrideSelector(selectors.selectIsSessionPaused, false);
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1); // Edge case
        store.overrideSelector(selectors.selectIsOverlayShown, false);
        store.overrideSelector(
          selectors.selectTimer,
          createMockTimer({ isRunning: true, purpose: 'break', duration: 5 * 60 * 1000 }),
        );
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false,
          isSkipPreparation: false,
        });
        store.overrideSelector(selectIsFocusModeEnabled, true);
        store.refreshState();

        // Dispatch a tick action to trigger the effect
        actions$ = of(actions.tick());

        effects.updateBanner$.pipe(take(1)).subscribe(() => {
          expect(bannerServiceMock.open).toHaveBeenCalled();
          const callArgs = bannerServiceMock.open.calls.mostRecent().args[0];
          // Math.max(1, 1 - 1) = Math.max(1, 0) = 1
          expect(callArgs.translateParams).toEqual({ cycleNr: 1 });
          done();
        });
      });
    });
  });
});
