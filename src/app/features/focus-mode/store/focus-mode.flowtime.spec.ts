import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, ReplaySubject, Subject, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { Action } from '@ngrx/store';
import { FocusModeMode } from '../focus-mode.model';
import * as selectors from './focus-mode.selectors';
import * as actions from './focus-mode.actions';
import { focusModeReducer, initialState } from './focus-mode.reducer';
import { FocusModeEffects } from './focus-mode.effects';
import { BannerService } from '../../../core/banner/banner.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { MetricService } from '../../metric/metric.service';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { selectFocusModeConfig } from '../../config/store/global-config.reducer';

describe('FocusMode Flowtime behavior', () => {
  describe('Reducer: startFocusSession', () => {
    it('should preserve zero duration for Flowtime sessions', () => {
      const state = {
        ...initialState,
        mode: FocusModeMode.Flowtime,
      };

      const next = focusModeReducer(state, actions.startFocusSession({ duration: 0 }));

      expect(next.timer.duration).toBe(0);
      expect(next.timer.isRunning).toBe(true);
      expect(next.timer.purpose).toBe('work');
    });

    it('should use default duration when duration is undefined', () => {
      const state = {
        ...initialState,
        mode: FocusModeMode.Pomodoro,
      };

      const next = focusModeReducer(state, actions.startFocusSession({}));

      expect(next.timer.duration).toBe(25 * 60 * 1000); // 25 minutes default
    });
  });

  describe('Reducer: setFocusSessionDuration', () => {
    it('should ignore duration changes when mode is Flowtime', () => {
      const state = {
        ...initialState,
        mode: FocusModeMode.Flowtime,
        timer: {
          isRunning: true,
          startedAt: Date.now(),
          elapsed: 0,
          duration: 0,
          purpose: 'work' as const,
        },
      };

      const next = focusModeReducer(
        state,
        actions.setFocusSessionDuration({ focusSessionDuration: 25 * 60 * 1000 }),
      );

      expect(next.timer.duration).toBe(0);
    });

    it('should update duration for non-Flowtime modes', () => {
      const state = {
        ...initialState,
        mode: FocusModeMode.Pomodoro,
        timer: {
          isRunning: true,
          startedAt: Date.now(),
          elapsed: 0,
          duration: 0,
          purpose: 'work' as const,
        },
      };

      const next = focusModeReducer(
        state,
        actions.setFocusSessionDuration({ focusSessionDuration: 5_000 }),
      );

      expect(next.timer.duration).toBe(5_000);
    });
  });

  describe('Effects: detectSessionCompletion$', () => {
    let store: MockStore;
    let actions$: ReplaySubject<Action>;
    let storageService: jasmine.SpyObj<FocusModeStorageService>;
    let effects: FocusModeEffects;

    beforeEach(() => {
      actions$ = new ReplaySubject<Action>(1);

      TestBed.configureTestingModule({
        providers: [
          provideMockStore({ initialState: { focusMode: initialState } }),
          provideMockActions(() => actions$),
          FocusModeEffects,
          { provide: BannerService, useValue: { open: () => {}, dismiss: () => {} } },
          { provide: GlobalConfigService, useValue: { sound: () => ({ volume: 0 }) } },
          { provide: TaskService, useValue: { currentTaskId$: of(null) } },
          {
            provide: FocusModeStrategyFactory,
            useValue: {
              getStrategy: () => ({
                shouldStartBreakAfterSession: false,
                initialSessionDuration: 0,
                shouldAutoStartNextSession: false,
                getBreakDuration: () => null,
              }),
            },
          },
          {
            provide: MetricService,
            useValue: {
              logFocusSession: () => {},
            },
          },
          {
            provide: FocusModeStorageService,
            useValue: jasmine.createSpyObj('FocusModeStorageService', [
              'getLastCountdownDuration',
              'setLastCountdownDuration',
            ]),
          },
        ],
      });
      store = TestBed.inject(MockStore);
      effects = TestBed.inject(FocusModeEffects);
      storageService = TestBed.inject(
        FocusModeStorageService,
      ) as jasmine.SpyObj<FocusModeStorageService>;
      storageService.getLastCountdownDuration.and.returnValue(null);
      storageService.setLastCountdownDuration.calls.reset();
      storageService.getLastCountdownDuration.and.returnValue(null);
      storageService.setLastCountdownDuration.calls.reset();
    });

    afterEach(() => {
      // Reset any overridden selectors to avoid cross-test contamination
      if (store && 'resetSelectors' in store) {
        (store as any).resetSelectors();
      }
    });

    it('should NOT emit completeFocusSession for Flowtime even if elapsed >= duration', (done) => {
      const timer = {
        purpose: 'work' as const,
        isRunning: false,
        duration: 1_000,
        elapsed: 1_000,
        startedAt: 0,
      };

      store.overrideSelector(selectors.selectTimer, timer as any);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isManualBreakStart: false,
      });
      store.refreshState();

      const sub = effects.detectSessionCompletion$.pipe(take(1)).subscribe({
        next: () => fail('Should not emit'),
        error: (e) => fail(String(e)),
        complete: () => done(),
      });
      // Complete if no emission happens within a short window
      setTimeout(() => {
        sub.unsubscribe();
        done();
      }, 50);
    });

    it('should emit completeFocusSession for Pomodoro when elapsed >= duration', (done) => {
      const timer = {
        purpose: 'work' as const,
        isRunning: false,
        duration: 1_000,
        elapsed: 1_000,
        startedAt: 0,
      };

      store.overrideSelector(selectors.selectTimer, timer as any);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isManualBreakStart: false,
      });
      store.refreshState();

      effects.detectSessionCompletion$.pipe(take(1)).subscribe((action: any) => {
        expect(action.type).toBe(actions.completeFocusSession.type);
        done();
      });
    });
  });

  describe('Reducer: Timer tick behavior beyond 25 minutes', () => {
    let initialTime: number;

    beforeEach(() => {
      initialTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(initialTime));
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('should continue counting for Flowtime sessions beyond 25 minutes', () => {
      // Start a Flowtime session with duration: 0
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Flowtime },
        actions.startFocusSession({ duration: 0 }),
      );

      expect(state.timer.duration).toBe(0);
      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.purpose).toBe('work');

      // Simulate 25 minutes passing (1500000ms)
      const twentyFiveMinutes = 25 * 60 * 1000;
      jasmine.clock().tick(twentyFiveMinutes);

      // Process tick action
      state = focusModeReducer(state, actions.tick());

      // Timer should still be running and counting beyond 25 minutes
      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(twentyFiveMinutes);
      expect(state.timer.purpose).toBe('work');
      expect(state.currentScreen).toBe('Main'); // Should not auto-complete

      // Simulate another 10 minutes (35 minutes total)
      const tenMoreMinutes = 10 * 60 * 1000;
      jasmine.clock().tick(tenMoreMinutes);

      state = focusModeReducer(state, actions.tick());

      // Should still be running at 35 minutes
      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(
        twentyFiveMinutes + tenMoreMinutes,
      );
      expect(state.timer.purpose).toBe('work');
    });

    it('should auto-complete Pomodoro sessions at 25 minutes', () => {
      // Start a Pomodoro session with default 25-minute duration
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Pomodoro },
        actions.startFocusSession({}), // undefined duration should use default
      );

      expect(state.timer.duration).toBe(25 * 60 * 1000);
      expect(state.timer.isRunning).toBe(true);

      // Simulate 25 minutes passing
      const twentyFiveMinutes = 25 * 60 * 1000;
      jasmine.clock().tick(twentyFiveMinutes);

      // Process tick action
      state = focusModeReducer(state, actions.tick());

      // Timer should auto-complete (stop running) at 25 minutes
      expect(state.timer.isRunning).toBe(false);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(twentyFiveMinutes);
      expect(state.lastCompletedDuration).toBeGreaterThanOrEqual(twentyFiveMinutes);
    });

    it('should handle manual completion of Flowtime sessions at any time', () => {
      // Start a Flowtime session
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Flowtime },
        actions.startFocusSession({ duration: 0 }),
      );

      // Simulate 35 minutes of work
      const thirtyFiveMinutes = 35 * 60 * 1000;
      jasmine.clock().tick(thirtyFiveMinutes);
      state = focusModeReducer(state, actions.tick());

      // Should still be running
      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(thirtyFiveMinutes);

      // Manually complete the session
      state = focusModeReducer(state, actions.completeFocusSession({ isManual: true }));

      // Should be completed
      expect(state.timer.isRunning).toBe(false);
      expect(state.currentScreen).toBe('SessionDone');
      expect(state.lastCompletedDuration).toBeGreaterThanOrEqual(thirtyFiveMinutes);
    });
  });

  describe('Effects: persistCountdownDuration$', () => {
    let store: MockStore;
    let actions$: ReplaySubject<Action>;
    let storageService: jasmine.SpyObj<FocusModeStorageService>;
    let effects: FocusModeEffects;
    let subscription: Subscription;
    const timerTemplate = {
      isRunning: true,
      startedAt: Date.now(),
      elapsed: 60_000,
      duration: 45_000,
      purpose: 'work' as const,
    };

    beforeEach(() => {
      actions$ = new ReplaySubject<Action>(1);

      TestBed.configureTestingModule({
        providers: [
          provideMockStore({ initialState: { focusMode: initialState } }),
          provideMockActions(() => actions$),
          FocusModeEffects,
          { provide: BannerService, useValue: { open: () => {}, dismiss: () => {} } },
          { provide: GlobalConfigService, useValue: { sound: () => ({ volume: 0 }) } },
          { provide: TaskService, useValue: { currentTaskId$: of(null) } },
          {
            provide: FocusModeStrategyFactory,
            useValue: {
              getStrategy: () => ({
                shouldStartBreakAfterSession: false,
                initialSessionDuration: 0,
                shouldAutoStartNextSession: false,
                getBreakDuration: () => null,
              }),
            },
          },
          {
            provide: MetricService,
            useValue: {
              logFocusSession: () => {},
            },
          },
          {
            provide: FocusModeStorageService,
            useValue: jasmine.createSpyObj('FocusModeStorageService', [
              'getLastCountdownDuration',
              'setLastCountdownDuration',
            ]),
          },
        ],
      });

      store = TestBed.inject(MockStore);
      effects = TestBed.inject(FocusModeEffects);
      subscription = effects.persistCountdownDuration$.subscribe();
      storageService = TestBed.inject(
        FocusModeStorageService,
      ) as jasmine.SpyObj<FocusModeStorageService>;
      storageService.getLastCountdownDuration.and.returnValue(null);
      storageService.setLastCountdownDuration.calls.reset();
    });

    afterEach(() => {
      if (store && 'resetSelectors' in store) {
        (store as any).resetSelectors();
      }
      subscription?.unsubscribe();
    });

    it('should persist duration when mode is Countdown', () => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Countdown);
      store.overrideSelector(selectors.selectTimer, timerTemplate as any);
      store.refreshState();

      actions$.next(actions.setFocusSessionDuration({ focusSessionDuration: 45_000 }));

      expect(storageService.setLastCountdownDuration).toHaveBeenCalledWith(45_000);
    });

    it('should not persist duration for non-countdown modes', () => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectTimer, timerTemplate as any);
      store.refreshState();

      actions$.next(actions.setFocusSessionDuration({ focusSessionDuration: 45_000 }));

      expect(storageService.setLastCountdownDuration).not.toHaveBeenCalled();
    });

    it('should ignore non-positive durations', () => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Countdown);
      store.overrideSelector(selectors.selectTimer, {
        ...timerTemplate,
        duration: 0,
      } as any);
      store.refreshState();

      actions$.next(actions.setFocusSessionDuration({ focusSessionDuration: 0 }));

      expect(storageService.setLastCountdownDuration).not.toHaveBeenCalled();
    });
  });

  describe('Effects: syncDurationWithMode$', () => {
    let store: MockStore;
    let effects: FocusModeEffects;
    let actions$: Subject<Action>;
    let getStrategySpy: jasmine.Spy;

    beforeEach(() => {
      actions$ = new Subject<Action>();
      getStrategySpy = jasmine
        .createSpy('getStrategy')
        .and.callFake((mode: FocusModeMode) => ({
          initialSessionDuration: mode === FocusModeMode.Pomodoro ? 42_000 : 12_000,
          shouldStartBreakAfterSession: false,
          shouldAutoStartNextSession: false,
          getBreakDuration: () => null,
        }));

      TestBed.configureTestingModule({
        providers: [
          provideMockStore({ initialState: { focusMode: initialState } }),
          provideMockActions(() => actions$),
          FocusModeEffects,
          { provide: BannerService, useValue: { open: () => {}, dismiss: () => {} } },
          { provide: GlobalConfigService, useValue: { sound: () => ({ volume: 0 }) } },
          { provide: TaskService, useValue: { currentTaskId$: of(null) } },
          {
            provide: FocusModeStrategyFactory,
            useValue: {
              getStrategy: getStrategySpy,
            },
          },
          {
            provide: MetricService,
            useValue: {
              logFocusSession: () => {},
            },
          },
          {
            provide: FocusModeStorageService,
            useValue: jasmine.createSpyObj('FocusModeStorageService', [
              'getLastCountdownDuration',
              'setLastCountdownDuration',
            ]),
          },
        ],
      });

      store = TestBed.inject(MockStore);
      effects = TestBed.inject(FocusModeEffects);

      store.overrideSelector(selectors.selectTimer, {
        purpose: null,
        isRunning: false,
        duration: 0,
        elapsed: 0,
        startedAt: null,
      } as any);
      store.refreshState();
    });

    afterEach(() => {
      actions$.complete();
      if (store && 'resetSelectors' in store) {
        (store as any).resetSelectors();
      }
    });

    it('should emit setFocusSessionDuration when switching to Pomodoro while idle', (done) => {
      const expectedDuration = 42_000;

      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.refreshState();

      getStrategySpy.and.callFake((mode: FocusModeMode) => ({
        initialSessionDuration:
          mode === FocusModeMode.Pomodoro ? expectedDuration : 12_000,
        shouldStartBreakAfterSession: false,
        shouldAutoStartNextSession: false,
        getBreakDuration: () => null,
      }));

      effects.syncDurationWithMode$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(
          actions.setFocusSessionDuration({ focusSessionDuration: expectedDuration }),
        );
        done();
      });

      actions$.next(actions.setFocusModeMode({ mode: FocusModeMode.Pomodoro }));
    });

    it('should emit setFocusSessionDuration when switching to Countdown while idle', (done) => {
      store.overrideSelector(selectors.selectMode, FocusModeMode.Flowtime);
      store.refreshState();

      effects.syncDurationWithMode$.pipe(take(1)).subscribe((action) => {
        expect(action).toEqual(
          actions.setFocusSessionDuration({ focusSessionDuration: 12_000 }),
        );
        done();
      });

      actions$.next(actions.setFocusModeMode({ mode: FocusModeMode.Countdown }));
    });

    it('should not emit when a timer is active', (done) => {
      store.overrideSelector(selectors.selectTimer, {
        purpose: 'break',
        isRunning: true,
        duration: 5_000,
        elapsed: 1_000,
        startedAt: Date.now(),
      } as any);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.refreshState();

      const sub = effects.syncDurationWithMode$.subscribe({
        next: () => fail('Should not emit duration update while timer is active'),
        error: (error) => fail(String(error)),
      });

      actions$.next(actions.setFocusModeMode({ mode: FocusModeMode.Pomodoro }));

      setTimeout(() => {
        sub.unsubscribe();
        expect(getStrategySpy).not.toHaveBeenCalled();
        done();
      }, 50);
    });
  });
});
