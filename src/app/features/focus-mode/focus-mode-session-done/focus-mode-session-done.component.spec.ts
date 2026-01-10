import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { EnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { FocusModeSessionDoneComponent } from './focus-mode-session-done.component';
import { FocusModeService } from '../focus-mode.service';
import { ConfettiService } from '../../../core/confetti/confetti.service';
import {
  cancelFocusSession,
  hideFocusOverlay,
  selectFocusTask,
  selectFocusDuration,
  startBreak,
} from '../store/focus-mode.actions';
import { selectCurrentCycle } from '../store/focus-mode.selectors';
import { FocusModeMode } from '../focus-mode.model';
import { T } from '../../../t.const';
import {
  selectCurrentTask,
  selectLastCurrentTask,
} from '../../tasks/store/task.selectors';
import { selectFocusModeConfig } from '../../config/store/global-config.reducer';
import { FocusModeStrategyFactory, PomodoroStrategy } from '../focus-mode-strategies';
import { unsetCurrentTask } from '../../tasks/store/task.actions';

describe('FocusModeSessionDoneComponent', () => {
  let component: FocusModeSessionDoneComponent;
  let mockStore: jasmine.SpyObj<Store>;
  let mockFocusModeService: {
    mode: ReturnType<typeof signal<FocusModeMode>>;
    lastSessionTotalDurationOrTimeElapsedFallback: ReturnType<typeof signal<number>>;
  };
  let mockConfettiService: jasmine.SpyObj<ConfettiService>;
  let mockStrategyFactory: jasmine.SpyObj<FocusModeStrategyFactory>;
  let mockPomodoroStrategy: jasmine.SpyObj<PomodoroStrategy>;
  let environmentInjector: EnvironmentInjector;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select', 'pipe']);
    mockConfettiService = jasmine.createSpyObj('ConfettiService', ['createConfetti']);
    mockPomodoroStrategy = jasmine.createSpyObj(
      'PomodoroStrategy',
      ['getBreakDuration'],
      {
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
      },
    );
    mockPomodoroStrategy.getBreakDuration.and.returnValue({
      duration: 5 * 60 * 1000,
      isLong: false,
    });
    mockStrategyFactory = jasmine.createSpyObj('FocusModeStrategyFactory', [
      'getStrategy',
    ]);
    mockStrategyFactory.getStrategy.and.returnValue(mockPomodoroStrategy);

    mockFocusModeService = {
      mode: signal(FocusModeMode.Pomodoro),
      lastSessionTotalDurationOrTimeElapsedFallback: signal(1500000),
    };

    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectCurrentTask) {
        return of({ id: 'task-1', title: 'Test Task' });
      }
      if (selector === selectLastCurrentTask) {
        return of({ id: 'task-1', title: 'Last Task' });
      }
      if (selector === selectFocusModeConfig) {
        return of({ isManualBreakStart: false, isPauseTrackingDuringBreak: false });
      }
      if (selector === selectCurrentCycle) {
        return of(1);
      }
      return of(null);
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: mockStore },
        { provide: FocusModeService, useValue: mockFocusModeService },
        { provide: ConfettiService, useValue: mockConfettiService },
        { provide: FocusModeStrategyFactory, useValue: mockStrategyFactory },
      ],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);

    runInInjectionContext(environmentInjector, () => {
      component = new FocusModeSessionDoneComponent();
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should expose T translations', () => {
      expect(component.T).toBe(T);
    });

    it('should expose FocusModeMode enum', () => {
      expect(component.FocusModeMode).toBe(FocusModeMode);
    });

    it('should have mode signal from service', () => {
      expect(component.mode()).toBe(FocusModeMode.Pomodoro);
    });

    it('should have lastSessionTotalDuration from service', () => {
      expect(component.lastSessionTotalDuration()).toBe(1500000);
    });
  });

  describe('ngAfterViewInit', () => {
    it('should create confetti twice', async () => {
      await component.ngAfterViewInit();

      expect(mockConfettiService.createConfetti).toHaveBeenCalledTimes(2);
    });

    it('should call confetti with correct configuration', async () => {
      await component.ngAfterViewInit();

      const expectedConfig = {
        startVelocity: 80,
        spread: 720,
        ticks: 600,
        zIndex: 0,
        particleCount: 200,
        origin: { x: 0.5, y: 1 },
      };

      expect(mockConfettiService.createConfetti).toHaveBeenCalledWith(expectedConfig);
    });
  });

  describe('cancelAndCloseFocusOverlay', () => {
    it('should dispatch hideFocusOverlay action', () => {
      component.cancelAndCloseFocusOverlay();

      expect(mockStore.dispatch).toHaveBeenCalledWith(hideFocusOverlay());
    });

    it('should dispatch cancelFocusSession action', () => {
      component.cancelAndCloseFocusOverlay();

      expect(mockStore.dispatch).toHaveBeenCalledWith(cancelFocusSession());
    });
  });

  describe('startNextFocusSession', () => {
    it('should dispatch selectFocusTask action', () => {
      component.startNextFocusSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(selectFocusTask());
    });
  });

  describe('continueWithFocusSession', () => {
    it('should dispatch selectFocusDuration action', () => {
      component.continueWithFocusSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(selectFocusDuration());
    });
  });

  describe('startBreakManually', () => {
    it('should get strategy from factory', () => {
      component.startBreakManually();

      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith(
        FocusModeMode.Pomodoro,
      );
    });

    it('should dispatch startBreak action with correct duration', () => {
      component.startBreakManually();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
          pausedTaskId: undefined,
        }),
      );
    });

    it('should pause tracking and include pausedTaskId when isPauseTrackingDuringBreak is enabled', () => {
      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectCurrentTask) {
          return of({ id: 'task-1', title: 'Test Task' });
        }
        if (selector === selectLastCurrentTask) {
          return of({ id: 'task-1', title: 'Last Task' });
        }
        if (selector === selectFocusModeConfig) {
          return of({ isManualBreakStart: true, isPauseTrackingDuringBreak: true });
        }
        if (selector === selectCurrentCycle) {
          return of(1);
        }
        return of(null);
      });

      runInInjectionContext(environmentInjector, () => {
        component = new FocusModeSessionDoneComponent();
      });

      component.startBreakManually();

      expect(mockStore.dispatch).toHaveBeenCalledWith(unsetCurrentTask());
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        startBreak({
          duration: 5 * 60 * 1000,
          isLongBreak: false,
          pausedTaskId: 'task-1',
        }),
      );
    });

    it('should use long break duration when on long break cycle', () => {
      mockPomodoroStrategy.getBreakDuration.and.returnValue({
        duration: 15 * 60 * 1000,
        isLong: true,
      });

      component.startBreakManually();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        startBreak({
          duration: 15 * 60 * 1000,
          isLongBreak: true,
          pausedTaskId: undefined,
        }),
      );
    });
  });
});
