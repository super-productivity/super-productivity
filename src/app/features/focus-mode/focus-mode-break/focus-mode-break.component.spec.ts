import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { FocusModeBreakComponent } from './focus-mode-break.component';
import { FocusModeService } from '../focus-mode.service';
import {
  skipBreak,
  completeBreak,
  completeTask,
  pauseFocusSession,
  unPauseFocusSession,
  cancelFocusSession,
} from '../store/focus-mode.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  Signal,
} from '@angular/core';
import { T } from '../../../t.const';
import { BehaviorSubject, of } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { TaskCopy } from '../../tasks/task.model';
import { FocusMainUIState, FocusModeMode } from '../focus-mode.model';
import { FocusModeConfig } from '../../config/global-config.model';

describe('FocusModeBreakComponent', () => {
  let component: FocusModeBreakComponent;
  let mockStore: jasmine.SpyObj<Store>;
  let mockTaskService: jasmine.SpyObj<any>;
  let mockFocusModeService: {
    timeRemaining: Signal<number>;
    progress: Signal<number>;
    isBreakLong: Signal<boolean>;
    isSessionPaused: Signal<boolean>;
    isSessionRunning: Signal<boolean>;
    mainState: Signal<FocusMainUIState>;
    mode: Signal<FocusModeMode>;
    sessionDuration: Signal<number>;
    focusModeConfig: Signal<FocusModeConfig | undefined>;
  };
  let environmentInjector: EnvironmentInjector;
  let currentTaskSubject: BehaviorSubject<TaskCopy | null>;
  const mockPausedTaskId = 'test-task-id';
  const mockCurrentTaskId = 'current-task-id';
  const mockTask = { id: 'cur-task', title: 'Current task' } as TaskCopy;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    mockStore.select.and.returnValue(of(mockPausedTaskId));

    currentTaskSubject = new BehaviorSubject<TaskCopy | null>(null);
    mockTaskService = jasmine.createSpyObj(
      'TaskService',
      ['currentTaskId', 'setCurrentId', 'update'],
      { currentTask$: currentTaskSubject.asObservable() },
    );
    mockTaskService.currentTaskId.and.returnValue(mockCurrentTaskId);

    mockFocusModeService = {
      timeRemaining: signal(300000),
      progress: signal(0.5),
      isBreakLong: signal(false),
      isSessionPaused: signal(false),
      isSessionRunning: signal(false),
      mainState: signal(FocusMainUIState.InProgress),
      mode: signal(FocusModeMode.Pomodoro),
      sessionDuration: signal(300000),
      focusModeConfig: signal(undefined),
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
    it('should dispatch unPauseFocusSession action when it is a normal resume', () => {
      (mockFocusModeService.mainState as any).set(FocusMainUIState.InProgress);
      component.resumeBreak();

      expect(mockStore.dispatch).toHaveBeenCalledWith(unPauseFocusSession());
    });
  });

  describe('exitToPlanning', () => {
    it('should dispatch cancelFocusSession (unified back-to-planning flow)', () => {
      component.exitToPlanning();

      expect(mockStore.dispatch).toHaveBeenCalledWith(cancelFocusSession());
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

  describe('shared task-row controls', () => {
    it('opens and closes the task selector', () => {
      expect(component.isTaskSelectorOpen()).toBe(false);
      component.openTaskSelector();
      expect(component.isTaskSelectorOpen()).toBe(true);
      component.closeTaskSelector();
      expect(component.isTaskSelectorOpen()).toBe(false);
    });

    it('selects a task and closes the selector', () => {
      component.openTaskSelector();
      component.onTaskSelected('new-task');
      expect(mockTaskService.setCurrentId).toHaveBeenCalledWith('new-task');
      expect(component.isTaskSelectorOpen()).toBe(false);
    });

    it('finishCurrentTask completes + marks the tracked task done, then opens the selector', () => {
      currentTaskSubject.next(mockTask);

      component.finishCurrentTask();

      expect(mockStore.dispatch).toHaveBeenCalledWith(completeTask());
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: TaskSharedActions.updateTask.type }),
      );
      expect(component.isTaskSelectorOpen()).toBe(true);
    });

    it('updateTaskTitle updates the tracked task only when changed', () => {
      currentTaskSubject.next(mockTask);

      component.updateTaskTitle(false, 'ignored');
      expect(mockTaskService.update).not.toHaveBeenCalled();

      component.updateTaskTitle(true, 'New title');
      expect(mockTaskService.update).toHaveBeenCalledWith(mockTask.id, {
        title: 'New title',
      });
    });
  });
});
