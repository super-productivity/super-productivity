import { TestBed } from '@angular/core/testing';
import { GlobalConfigService } from '../config/global-config.service';
import {
  PomodoroStrategy,
  FlowtimeStrategy,
  CountdownStrategy,
  FocusModeStrategyFactory,
} from './focus-mode-strategies';
import { FocusModeMode, FocusScreen, FOCUS_MODE_DEFAULTS } from './focus-mode.model';
import { FocusModeStorageService } from './focus-mode-storage.service';

describe('FocusModeStrategies', () => {
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let focusModeStorage: jasmine.SpyObj<FocusModeStorageService>;

  beforeEach(() => {
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      pomodoroConfig: jasmine.createSpy().and.returnValue({
        duration: 1500000, // 25 minutes
        breakDuration: 300000, // 5 minutes
        longerBreakDuration: 900000, // 15 minutes
        cyclesBeforeLongerBreak: 4,
      }),
    });

    TestBed.configureTestingModule({
      providers: [
        PomodoroStrategy,
        FlowtimeStrategy,
        CountdownStrategy,
        FocusModeStrategyFactory,
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        {
          provide: FocusModeStorageService,
          useValue: jasmine.createSpyObj('FocusModeStorageService', [
            'getLastCountdownDuration',
            'setLastCountdownDuration',
          ]),
        },
      ],
    });

    mockGlobalConfigService = TestBed.inject(
      GlobalConfigService,
    ) as jasmine.SpyObj<GlobalConfigService>;
    focusModeStorage = TestBed.inject(
      FocusModeStorageService,
    ) as jasmine.SpyObj<FocusModeStorageService>;
    focusModeStorage.getLastCountdownDuration.and.returnValue(null);
  });

  describe('PomodoroStrategy', () => {
    let strategy: PomodoroStrategy;

    beforeEach(() => {
      strategy = TestBed.inject(PomodoroStrategy);
    });

    describe('initialSessionDuration', () => {
      it('should return duration from config', () => {
        expect(strategy.initialSessionDuration).toBe(1500000);
      });

      it('should return default when config is null', () => {
        // Replace the spy to return null
        (mockGlobalConfigService.pomodoroConfig as jasmine.Spy).and.returnValue(null);

        expect(strategy.initialSessionDuration).toBe(
          FOCUS_MODE_DEFAULTS.SESSION_DURATION,
        );
      });
    });

    describe('getBreakDuration', () => {
      it('should return short break for cycles 1-3', () => {
        const result1 = strategy.getBreakDuration(1);
        const result2 = strategy.getBreakDuration(2);
        const result3 = strategy.getBreakDuration(3);

        expect(result1).toEqual({ duration: 300000, isLong: false });
        expect(result2).toEqual({ duration: 300000, isLong: false });
        expect(result3).toEqual({ duration: 300000, isLong: false });
      });

      it('should return long break for cycle 4', () => {
        const result = strategy.getBreakDuration(4);

        expect(result).toEqual({ duration: 900000, isLong: true });
      });

      it('should return short break after long break cycle', () => {
        const result = strategy.getBreakDuration(5);

        expect(result).toEqual({ duration: 300000, isLong: false });
      });

      it('should return long break every 4th cycle', () => {
        const result8 = strategy.getBreakDuration(8);
        const result12 = strategy.getBreakDuration(12);

        expect(result8).toEqual({ duration: 900000, isLong: true });
        expect(result12).toEqual({ duration: 900000, isLong: true });
      });

      it('should use default values when config is incomplete', () => {
        // Replace the spy to return empty object
        (mockGlobalConfigService.pomodoroConfig as jasmine.Spy).and.returnValue({});

        const shortBreak = strategy.getBreakDuration(1);
        const longBreak = strategy.getBreakDuration(4);

        expect(shortBreak).toEqual({
          duration: FOCUS_MODE_DEFAULTS.SHORT_BREAK_DURATION,
          isLong: false,
        });
        expect(longBreak).toEqual({
          duration: FOCUS_MODE_DEFAULTS.LONG_BREAK_DURATION,
          isLong: true,
        });
      });
    });

    describe('getNextScreenAfterTaskSelection', () => {
      it('should go to preparation when not skipping', () => {
        const result = strategy.getNextScreenAfterTaskSelection(false);

        expect(result).toEqual({
          screen: FocusScreen.Preparation,
          duration: 1500000,
        });
      });

      it('should go to main screen when skipping preparation', () => {
        const result = strategy.getNextScreenAfterTaskSelection(true);

        expect(result).toEqual({
          screen: FocusScreen.Main,
          duration: 1500000,
        });
      });
    });

    describe('strategy properties', () => {
      it('should have correct boolean properties', () => {
        expect(strategy.shouldStartBreakAfterSession).toBe(true);
        expect(strategy.shouldAutoStartNextSession).toBe(true);
      });
    });
  });

  describe('FlowtimeStrategy', () => {
    let strategy: FlowtimeStrategy;

    beforeEach(() => {
      strategy = TestBed.inject(FlowtimeStrategy);
    });

    describe('properties', () => {
      it('should have correct initial session duration', () => {
        expect(strategy.initialSessionDuration).toBe(0);
      });

      it('should have correct boolean properties', () => {
        expect(strategy.shouldStartBreakAfterSession).toBe(false);
        expect(strategy.shouldAutoStartNextSession).toBe(false);
      });
    });

    describe('getBreakDuration', () => {
      it('should always return null', () => {
        const result1 = strategy.getBreakDuration();

        expect(result1).toBeNull();
      });
    });

    describe('getNextScreenAfterTaskSelection', () => {
      it('should go to preparation when not skipping', () => {
        const result = strategy.getNextScreenAfterTaskSelection(false);

        expect(result).toEqual({
          screen: FocusScreen.Preparation,
          duration: 0,
        });
      });

      it('should go to main screen when skipping preparation', () => {
        const result = strategy.getNextScreenAfterTaskSelection(true);

        expect(result).toEqual({
          screen: FocusScreen.Main,
          duration: 0,
        });
      });
    });
  });

  describe('CountdownStrategy', () => {
    let strategy: CountdownStrategy;

    beforeEach(() => {
      strategy = TestBed.inject(CountdownStrategy);
    });

    describe('initialSessionDuration', () => {
      it('should return duration from storage when available', () => {
        focusModeStorage.getLastCountdownDuration.and.returnValue(1_800_000);

        expect(strategy.initialSessionDuration).toBe(1_800_000);
        expect(focusModeStorage.getLastCountdownDuration).toHaveBeenCalled();
      });

      it('should return default when storage is empty', () => {
        expect(strategy.initialSessionDuration).toBe(
          FOCUS_MODE_DEFAULTS.SESSION_DURATION,
        );
      });

      it('should return default when storage returns non-positive value', () => {
        focusModeStorage.getLastCountdownDuration.and.returnValue(0);

        expect(strategy.initialSessionDuration).toBe(
          FOCUS_MODE_DEFAULTS.SESSION_DURATION,
        );
      });
    });

    describe('properties', () => {
      it('should have correct boolean properties', () => {
        expect(strategy.shouldStartBreakAfterSession).toBe(false);
        expect(strategy.shouldAutoStartNextSession).toBe(false);
      });
    });

    describe('getBreakDuration', () => {
      it('should always return null', () => {
        const result1 = strategy.getBreakDuration();

        expect(result1).toBeNull();
      });
    });

    describe('getNextScreenAfterTaskSelection', () => {
      it('should always go to duration selection', () => {
        const result1 = strategy.getNextScreenAfterTaskSelection(false);
        const result2 = strategy.getNextScreenAfterTaskSelection(true);

        expect(result1).toEqual({
          screen: FocusScreen.DurationSelection,
        });
        expect(result2).toEqual({
          screen: FocusScreen.DurationSelection,
        });
      });
    });
  });

  describe('FocusModeStrategyFactory', () => {
    let factory: FocusModeStrategyFactory;
    let pomodoroStrategy: PomodoroStrategy;
    let flowtimeStrategy: FlowtimeStrategy;
    let countdownStrategy: CountdownStrategy;

    beforeEach(() => {
      factory = TestBed.inject(FocusModeStrategyFactory);
      pomodoroStrategy = TestBed.inject(PomodoroStrategy);
      flowtimeStrategy = TestBed.inject(FlowtimeStrategy);
      countdownStrategy = TestBed.inject(CountdownStrategy);
    });

    describe('getStrategy', () => {
      it('should return PomodoroStrategy for Pomodoro mode', () => {
        const result = factory.getStrategy(FocusModeMode.Pomodoro);

        expect(result).toBe(pomodoroStrategy);
      });

      it('should return FlowtimeStrategy for Flowtime mode', () => {
        const result = factory.getStrategy(FocusModeMode.Flowtime);

        expect(result).toBe(flowtimeStrategy);
      });

      it('should return CountdownStrategy for Countdown mode', () => {
        const result = factory.getStrategy(FocusModeMode.Countdown);

        expect(result).toBe(countdownStrategy);
      });

      it('should return CountdownStrategy for unknown mode', () => {
        const result = factory.getStrategy('UnknownMode' as FocusModeMode);

        expect(result).toBe(countdownStrategy);
      });
    });
  });
});
