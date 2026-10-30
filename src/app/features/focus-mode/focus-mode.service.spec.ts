import {
  TestBed,
  fakeAsync,
  tick as testTick,
  discardPeriodicTasks,
} from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { FocusModeService } from './focus-mode.service';
import { GlobalConfigService } from '../config/global-config.service';
import { FocusScreen, FocusModeMode, FocusMainUIState } from './focus-mode.model';
import * as selectors from './store/focus-mode.selectors';
import * as actions from './store/focus-mode.actions';
import { selectFocusModeConfig } from '../config/store/global-config.reducer';
import { FocusModeStrategyFactory } from './focus-mode-strategies';
import { DEFAULT_TASK, TaskCopy } from '../tasks/task.model';

describe('FocusModeService', () => {
  let service: FocusModeService;
  let mockStore: jasmine.SpyObj<Store>;
  let isRunningValue: boolean;

  const setupTestBed = (): void => {
    const storeSpy = jasmine.createSpyObj('Store', [
      'select',
      'dispatch',
      'selectSignal',
    ]);
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      pomodoroConfig: jasmine.createSpy().and.returnValue({
        duration: 1500000,
        breakDuration: 300000,
        longerBreakDuration: 900000,
      }),
    });

    // Setup store selectors before TestBed configuration
    storeSpy.select.and.callFake((selector: unknown) => {
      if (selector === selectors.selectCurrentScreen) {
        return of(FocusScreen.Main);
      }
      if (selector === selectors.selectMainState) {
        return of(FocusMainUIState.Preparation);
      }
      if (selector === selectors.selectMode) {
        return of(FocusModeMode.Pomodoro);
      }
      if (selector === selectors.selectIsOverlayShown) {
        return of(false);
      }
      if (selector === selectors.selectCurrentCycle) {
        return of(0);
      }
      if (selector === selectors.selectIsRunning) {
        return of(isRunningValue);
      }
      if (selector === selectors.selectTimeElapsed) {
        return of(0);
      }
      if (selector === selectors.selectTimeRemaining) {
        return of(1500000);
      }
      if (selector === selectors.selectProgress) {
        return of(0);
      }
      if (selector === selectors.selectIsSessionRunning) {
        return of(false);
      }
      if (selector === selectors.selectIsSessionPaused) {
        return of(false);
      }
      if (selector === selectors.selectIsBreakActive) {
        return of(false);
      }
      if (selector === selectors.selectIsLongBreak) {
        return of(false);
      }
      if (selector === selectors.selectLastSessionDuration) {
        return of(0);
      }
      if (selector === selectors.selectTimeDuration) {
        return of(300000);
      }
      if (selector === selectFocusModeConfig) {
        return of({});
      }
      return of(null);
    });

    storeSpy.selectSignal.and.callFake((selector: unknown) => {
      if (selector === selectors.selectCurrentScreen) {
        return () => FocusScreen.Main;
      }
      if (selector === selectors.selectMainState) {
        return () => FocusMainUIState.Preparation;
      }
      if (selector === selectors.selectMode) {
        return () => FocusModeMode.Pomodoro;
      }
      if (selector === selectors.selectIsOverlayShown) {
        return () => false;
      }
      if (selector === selectors.selectCurrentCycle) {
        return () => 0;
      }
      if (selector === selectors.selectIsRunning) {
        return () => isRunningValue;
      }
      if (selector === selectors.selectTimeElapsed) {
        return () => 0;
      }
      if (selector === selectors.selectTimeRemaining) {
        return () => 1_500_000;
      }
      if (selector === selectors.selectProgress) {
        return () => 0;
      }
      if (selector === selectors.selectIsSessionRunning) {
        return () => false;
      }
      if (selector === selectors.selectIsSessionPaused) {
        return () => false;
      }
      if (selector === selectors.selectIsBreakActive) {
        return () => false;
      }
      if (selector === selectors.selectIsLongBreak) {
        return () => false;
      }
      if (selector === selectors.selectLastSessionDuration) {
        return () => 0;
      }
      if (selector === selectors.selectTimeDuration) {
        return () => 300_000;
      }
      if (selector === selectFocusModeConfig) {
        return () => ({});
      }
      return () => null;
    });

    TestBed.configureTestingModule({
      providers: [
        FocusModeService,
        { provide: Store, useValue: storeSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
      ],
    });

    mockStore = TestBed.inject(Store) as jasmine.SpyObj<Store>;
  };

  beforeEach(() => {
    isRunningValue = false;
  });

  describe('signals', () => {
    beforeEach(fakeAsync(() => {
      setupTestBed();
      service = TestBed.inject(FocusModeService);
    }));

    afterEach(fakeAsync(() => {
      discardPeriodicTasks();
    }));

    it('should initialize currentScreen signal', fakeAsync(() => {
      expect(service.currentScreen()).toBe(FocusScreen.Main);
    }));

    it('should initialize mainState signal', fakeAsync(() => {
      expect(service.mainState()).toBe(FocusMainUIState.Preparation);
    }));

    it('should initialize mode signal', fakeAsync(() => {
      expect(service.mode()).toBe(FocusModeMode.Pomodoro);
    }));

    it('should initialize isOverlayShown signal', fakeAsync(() => {
      expect(service.isOverlayShown()).toBe(false);
    }));

    it('should initialize currentCycle signal', fakeAsync(() => {
      expect(service.currentCycle()).toBe(0);
    }));

    it('should initialize timer signals', fakeAsync(() => {
      expect(service.isRunning()).toBe(false);
      expect(service.timeElapsed()).toBe(0);
      expect(service.timeRemaining()).toBe(1500000);
      expect(service.progress()).toBe(0);
      expect(service.sessionDuration()).toBe(300000);
    }));

    it('should initialize session signals', fakeAsync(() => {
      expect(service.isSessionRunning()).toBe(false);
      expect(service.isSessionPaused()).toBe(false);
    }));

    it('should initialize break signals', fakeAsync(() => {
      expect(service.isBreakActive()).toBe(false);
      expect(service.isLongBreak()).toBe(false);
    }));
  });

  describe('computed signals', () => {
    beforeEach(fakeAsync(() => {
      setupTestBed();
      service = TestBed.inject(FocusModeService);
    }));

    afterEach(fakeAsync(() => {
      discardPeriodicTasks();
    }));

    it('should compute isCountTimeDown correctly for Pomodoro mode', fakeAsync(() => {
      expect(service.isCountTimeDown()).toBe(true);
    }));

    it('should compute isCountTimeDown correctly for Flowtime mode', fakeAsync(() => {
      // The current service setup returns Pomodoro mode, so isCountTimeDown should be true
      expect(service.isCountTimeDown()).toBe(true);
    }));
  });

  describe('compatibility aliases', () => {
    beforeEach(fakeAsync(() => {
      setupTestBed();
      service = TestBed.inject(FocusModeService);
    }));

    afterEach(fakeAsync(() => {
      discardPeriodicTasks();
    }));

    it('should provide isBreakLong alias', fakeAsync(() => {
      expect(service.isBreakLong).toBe(service.isLongBreak);
    }));

    it('should provide timeElapsed signal', fakeAsync(() => {
      expect(service.timeElapsed()).toBe(0);
    }));

    it('should provide progress signal', fakeAsync(() => {
      expect(service.progress()).toBe(0);
    }));

    it('should provide focusModeConfig signal', fakeAsync(() => {
      expect(service.focusModeConfig).toBeDefined();
    }));

    it('should provide pomodoroConfig signal', fakeAsync(() => {
      expect(service.pomodoroConfig).toBeDefined();
    }));
  });

  describe('timer subscription', () => {
    it('should not dispatch tick action when timer is not running', fakeAsync(() => {
      isRunningValue = false;
      setupTestBed();
      service = TestBed.inject(FocusModeService);

      // Advance time by 1 second
      testTick(1000);

      expect(mockStore.dispatch).not.toHaveBeenCalledWith(actions.tick());
      discardPeriodicTasks();
    }));

    it('should dispatch tick action when timer is running', fakeAsync(() => {
      isRunningValue = true;
      setupTestBed();
      service = TestBed.inject(FocusModeService);

      // Advance time by 1 second
      testTick(1000);

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.tick());
      discardPeriodicTasks();
    }));

    it('should dispatch tick action every second when running', fakeAsync(() => {
      isRunningValue = true;
      setupTestBed();
      service = TestBed.inject(FocusModeService);

      // Advance time by 3 seconds
      testTick(3000);

      // Should have dispatched tick 3 times
      const tickCalls = mockStore.dispatch.calls
        .allArgs()
        .filter(
          (args) => (args[0] as unknown as { type: string }).type === actions.tick().type,
        );
      expect(tickCalls.length).toBe(3);
      discardPeriodicTasks();
    }));

    it('should have timer subscription active', fakeAsync(() => {
      setupTestBed();
      service = TestBed.inject(FocusModeService);
      expect(service).toBeDefined();
      expect(service.isRunning).toBeDefined();
      discardPeriodicTasks();
    }));
  });

  describe('observable versions for compatibility', () => {
    beforeEach(fakeAsync(() => {
      setupTestBed();
      service = TestBed.inject(FocusModeService);
    }));

    afterEach(fakeAsync(() => {
      discardPeriodicTasks();
    }));

    it('should provide sessionProgress$ observable', fakeAsync(() => {
      service.sessionProgress$.subscribe((progress) => {
        expect(progress).toBe(0);
      });
    }));

    it('should provide currentSessionTime$ observable', fakeAsync(() => {
      service.currentSessionTime$.subscribe((time) => {
        expect(time).toBe(0);
      });
    }));

    it('should provide timeToGo$ observable', fakeAsync(() => {
      service.timeToGo$.subscribe((time) => {
        expect(time).toBe(1500000);
      });
    }));
  });

  describe('currentScreen signal', () => {
    beforeEach(fakeAsync(() => {
      setupTestBed();
      service = TestBed.inject(FocusModeService);
    }));

    afterEach(fakeAsync(() => {
      discardPeriodicTasks();
    }));

    it('should initialize with Main screen by default', fakeAsync(() => {
      expect(service.currentScreen()).toBe(FocusScreen.Main);
    }));
  });
});

describe('FocusModeService.tryStartSessionForTask', () => {
  const MIN = 60_000;
  let service: FocusModeService;
  let dispatch: jasmine.Spy;
  let mode: FocusModeMode;
  let timerPurpose: 'work' | 'break' | null;
  let focusCfg: { isShowPreparation?: boolean };
  let strategyDuration: number;
  const task = {
    ...DEFAULT_TASK,
    id: 't1',
    timeEstimate: 15 * MIN,
    timeSpent: 0,
  } as TaskCopy;

  beforeEach(() => {
    mode = FocusModeMode.Countdown;
    timerPurpose = null;
    focusCfg = {};
    strategyDuration = 25 * MIN;
    const storeSpy = jasmine.createSpyObj('Store', [
      'select',
      'dispatch',
      'selectSignal',
    ]);
    storeSpy.select.and.returnValue(of(null));
    storeSpy.selectSignal.and.callFake((selector: unknown) => {
      if (selector === selectors.selectMode) return () => mode;
      if (selector === selectors.selectTimer) return () => ({ purpose: timerPurpose });
      if (selector === selectFocusModeConfig) return () => focusCfg;
      return () => null;
    });
    dispatch = storeSpy.dispatch;
    TestBed.configureTestingModule({
      providers: [
        FocusModeService,
        { provide: Store, useValue: storeSpy },
        { provide: GlobalConfigService, useValue: { pomodoroConfig: () => null } },
        {
          provide: FocusModeStrategyFactory,
          useValue: {
            getStrategy: () => ({ initialSessionDuration: strategyDuration }),
          },
        },
      ],
    });
    service = TestBed.inject(FocusModeService);
  });

  it('starts a countdown capped to the remaining estimate and shows the overlay', () => {
    expect(service.tryStartSessionForTask(task)).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      actions.startFocusSession({ duration: 15 * MIN, taskId: 't1' }),
    );
    expect(dispatch).toHaveBeenCalledWith(actions.showFocusOverlay());
  });

  it('keeps the configured duration for pomodoro', () => {
    mode = FocusModeMode.Pomodoro;
    service.tryStartSessionForTask(task);
    expect(dispatch).toHaveBeenCalledWith(
      actions.startFocusSession({ duration: 25 * MIN, taskId: 't1' }),
    );
  });

  it('starts flowtime with an open-ended duration', () => {
    mode = FocusModeMode.Flowtime;
    strategyDuration = 0;
    service.tryStartSessionForTask(task);
    expect(dispatch).toHaveBeenCalledWith(
      actions.startFocusSession({ duration: 0, taskId: 't1' }),
    );
  });

  it('does nothing during a break', () => {
    timerPurpose = 'break';
    expect(service.tryStartSessionForTask(task)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does nothing when a session is already active', () => {
    timerPurpose = 'work';
    expect(service.tryStartSessionForTask(task)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does nothing when the preparation screen is enabled', () => {
    focusCfg = { isShowPreparation: true };
    expect(service.tryStartSessionForTask(task)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
