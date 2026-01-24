import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { FocusModeBreakComponent } from './focus-mode-break.component';
import { FocusModeService } from '../focus-mode.service';
import {
  skipBreak,
  completeBreak,
  pauseFocusSession,
  unPauseFocusSession,
  exitBreakToPlanning,
} from '../store/focus-mode.actions';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  Signal,
} from '@angular/core';
import { T } from '../../../t.const';
import { of } from 'rxjs';
import { TaskService } from '../../tasks/task.service';

describe('FocusModeBreakComponent', () => {
  let component: FocusModeBreakComponent;
  let mockStore: jasmine.SpyObj<Store>;
  let mockTaskService: jasmine.SpyObj<any>;
  let mockFocusModeService: {
    timeRemaining: Signal<number>;
    progress: Signal<number>;
    isBreakLong: Signal<boolean>;
    isSessionPaused: Signal<boolean>;
  };
  let environmentInjector: EnvironmentInjector;
  const mockPausedTaskId = 'test-task-id';
  const mockCurrentTaskId = 'current-task-id';

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    mockStore.select.and.returnValue(of(mockPausedTaskId));

    mockTaskService = jasmine.createSpyObj('TaskService', ['currentTaskId']);
    mockTaskService.currentTaskId.and.returnValue(mockCurrentTaskId);

    mockFocusModeService = {
      timeRemaining: signal(300000),
      progress: signal(0.5),
      isBreakLong: signal(false),
      isSessionPaused: signal(false),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: mockStore },
        { provide: FocusModeService, useValue: mockFocusModeService },
        { provide: TaskService, useValue: mockTaskService },
      ],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);

    runInInjectionContext(environmentInjector, () => {
      component = new FocusModeBreakComponent();
    });
  });

  describe('initialization', () => {
    it('should expose T translations', () => {
      expect(component.T).toBe(T);
    });
  });

  describe('computed signals', () => {
    it('should compute remainingTime from focusModeService', () => {
      expect(component.remainingTime()).toBe(300000);
    });

    it('should compute progressPercentage from focusModeService', () => {
      expect(component.progressPercentage()).toBe(0.5);
    });

    it('should compute breakTypeLabel for short break', () => {
      expect(component.breakTypeLabel()).toBe(T.F.FOCUS_MODE.SHORT_BREAK);
    });

    it('should compute breakTypeLabel for long break', () => {
      (mockFocusModeService.isBreakLong as any).set(true);
      expect(component.breakTypeLabel()).toBe(T.F.FOCUS_MODE.LONG_BREAK);
    });
  });

  describe('skipBreak', () => {
    it('should dispatch skipBreak action with pausedTaskId', () => {
      component.skipBreak();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        skipBreak({ pausedTaskId: mockPausedTaskId }),
      );
    });
  });

  describe('completeBreak', () => {
    it('should dispatch completeBreak action with pausedTaskId', () => {
      component.completeBreak();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        completeBreak({ pausedTaskId: mockPausedTaskId }),
      );
    });
  });

  describe('pauseBreak', () => {
    it('should dispatch pauseFocusSession with currentTaskId when tracking is active (Bug #5995 fix)', () => {
      // Scenario: Tracking continues during break (isPauseTrackingDuringBreak=FALSE)
      mockTaskService.currentTaskId.and.returnValue(mockCurrentTaskId);

      component.pauseBreak();

      expect(mockTaskService.currentTaskId).toHaveBeenCalled();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        pauseFocusSession({ pausedTaskId: mockCurrentTaskId }),
      );
    });

    it('should fall back to stored pausedTaskId when tracking is stopped', () => {
      // Scenario: Tracking was auto-paused during break (isPauseTrackingDuringBreak=TRUE)
      mockTaskService.currentTaskId.and.returnValue(null);

      component.pauseBreak();

      expect(mockTaskService.currentTaskId).toHaveBeenCalled();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        pauseFocusSession({ pausedTaskId: mockPausedTaskId }),
      );
    });
  });

  describe('resumeBreak', () => {
    it('should dispatch unPauseFocusSession action', () => {
      component.resumeBreak();

      expect(mockStore.dispatch).toHaveBeenCalledWith(unPauseFocusSession());
    });
  });

  describe('exitToPlanning', () => {
    it('should dispatch exitBreakToPlanning action with pausedTaskId', () => {
      component.exitToPlanning();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        exitBreakToPlanning({ pausedTaskId: mockPausedTaskId }),
      );
    });
  });

  describe('isBreakPaused', () => {
    it('should return false when break is not paused', () => {
      expect(component.isBreakPaused()).toBe(false);
    });

    it('should return true when break is paused', () => {
      (mockFocusModeService.isSessionPaused as any).set(true);
      expect(component.isBreakPaused()).toBe(true);
    });
  });
});
