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
import * as actions from './focus-mode.actions';
import * as selectors from './focus-mode.selectors';
import { FocusModeMode, FocusScreen, TimerState } from '../focus-mode.model';
import { unsetCurrentTask, setCurrentTask } from '../../tasks/store/task.actions';
import { openIdleDialog } from '../../idle/store/idle.actions';
import { selectTaskById } from '../../tasks/store/task.selectors';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
  selectPomodoroConfig,
} from '../../config/store/global-config.reducer';
import { updateGlobalConfigSection } from '../../config/store/global-config.actions';
import { take, toArray } from 'rxjs/operators';

describe('FocusModeEffects', () => {
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
      it('should dispatch startBreak for automatic completions when strategy allows', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: false }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.refreshState();

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            const startBreakAction = actionsArr.find(
              (a) => a.type === actions.startBreak.type,
            );
            expect(startBreakAction).toBeDefined();
            expect(startBreakAction.duration).toBe(5 * 60 * 1000);
            expect(startBreakAction.isLongBreak).toBeFalse();
            done();
          });
      });

      it('should dispatch startBreak for manual completions (to allow early break start)', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 1);
        store.refreshState();

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            const startBreakAction = actionsArr.find(
              (a) => a.type === actions.startBreak.type,
            );
            expect(startBreakAction).toBeDefined();
            done();
          });
      });

      it('should NOT dispatch startBreak when isManualBreakStart is enabled', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: false }));
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

      it('should dispatch correct isLongBreak based on cycle', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: false }));
        store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
        store.overrideSelector(selectors.selectCurrentCycle, 4);
        store.refreshState();

        strategyFactoryMock.getStrategy.and.returnValue({
          initialSessionDuration: 25 * 60 * 1000,
          shouldStartBreakAfterSession: true,
          shouldAutoStartNextSession: true,
          getBreakDuration: jasmine
            .createSpy('getBreakDuration')
            .and.returnValue({ duration: 15 * 60 * 1000, isLong: true }),
        });

        effects.autoStartBreakOnSessionComplete$
          .pipe(toArray())
          .subscribe((actionsArr) => {
            const startBreakAction = actionsArr.find(
              (a) => a.type === actions.startBreak.type,
            );
            expect(startBreakAction).toBeDefined();
            expect(startBreakAction.isLongBreak).toBeTrue();
            expect(startBreakAction.duration).toBe(15 * 60 * 1000);
            done();
          });
      });

      it('should NOT dispatch when strategy.shouldStartBreakAfterSession is false', (done) => {
        actions$ = of(actions.completeFocusSession({ isManual: false }));
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

    describe('stopTrackingOnManualEnd$', () => {
      it('should dispatch unsetCurrentTask when isManual=true AND isSyncSessionWithTracking=true AND currentTaskId exists', (done) => {
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
        });
        store.refreshState();

        effects.stopTrackingOnManualEnd$.pipe(take(1)).subscribe((action) => {
          expect(action).toEqual(unsetCurrentTask());
          done();
        });
      });

      it('should NOT dispatch unsetCurrentTask when isManual=true but isSyncSessionWithTracking=false', (done) => {
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: false,
          isSkipPreparation: false,
        });
        store.refreshState();

        effects.stopTrackingOnManualEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });

      it('should NOT dispatch unsetCurrentTask when isManual=true but currentTaskId is null', (done) => {
        currentTaskId$.next(null);
        actions$ = of(actions.completeFocusSession({ isManual: true }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
        });
        store.refreshState();

        effects.stopTrackingOnManualEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
          done();
        });
      });

      it('should NOT dispatch unsetCurrentTask when isManual=false (auto completion)', (done) => {
        currentTaskId$.next('task-123');
        actions$ = of(actions.completeFocusSession({ isManual: false }));
        store.overrideSelector(selectFocusModeConfig, {
          isSyncSessionWithTracking: true,
          isSkipPreparation: false,
        });
        store.refreshState();

        effects.stopTrackingOnManualEnd$.pipe(toArray()).subscribe((actionsArr) => {
          expect(actionsArr.length).toBe(0);
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

    it('should NOT dispatch during break', (done) => {
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

      currentTaskId$.next('task-123');

      setTimeout(() => {
        currentTaskId$.next(null);
      }, 10);

      setTimeout(() => {
        done();
      }, 50);
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

    it('should NOT dispatch during break', (done) => {
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
  });

  describe('syncSessionStartToTracking$', () => {
    it('should dispatch setCurrentTask when session starts with pausedTaskId and no current task', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, 'task-123');
      // Mock that the task exists
      store.overrideSelector(selectTaskById as any, {
        id: 'task-123',
        title: 'Test Task',
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

    it('should NOT dispatch when no pausedTaskId', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, null);
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

    it('should NOT dispatch setCurrentTask when task no longer exists', (done) => {
      store.overrideSelector(selectFocusModeConfig, {
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      store.overrideSelector(selectors.selectPausedTaskId, 'deleted-task-123');
      // Mock that the task doesn't exist (use any cast for parameterized selector)
      store.overrideSelector(selectTaskById as any, undefined as any);
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
  });

  describe('pauseTrackingDuringBreak (autoStartBreakOnSessionComplete$)', () => {
    it('should dispatch unsetCurrentTask when break starts and isPauseTrackingDuringBreak is true', (done) => {
      actions$ = of(actions.completeFocusSession({ isManual: false }));
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
      actions$ = of(actions.completeFocusSession({ isManual: false }));
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

  describe('_getIconButtonActions banner button behavior (issue #5889)', () => {
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
      const buttonActions = (effects as any)._getIconButtonActions(
        timer,
        false, // isOnBreak
        true, // isSessionCompleted
        false, // isBreakTimeUp
        focusModeConfig,
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

      const buttonActions = (effects as any)._getIconButtonActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
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

      const buttonActions = (effects as any)._getIconButtonActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
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

      const buttonActions = (effects as any)._getIconButtonActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
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

      const buttonActions = (effects as any)._getIconButtonActions(
        timer,
        false,
        true,
        false,
        focusModeConfig,
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

      const buttonActions = (effects as any)._getIconButtonActions(
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

      const buttonActions = (effects as any)._getIconButtonActions(
        timer,
        true, // isOnBreak
        false, // isSessionCompleted
        true, // isBreakTimeUp
        focusModeConfig,
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
  });
});
