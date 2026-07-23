import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { FocusModeMainComponent } from './focus-mode-main.component';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';
import { IssueService } from '../../issue/issue.service';
import { SimpleCounterService } from '../../simple-counter/simple-counter.service';
import { FocusModeService } from '../focus-mode.service';
import { FocusMainUIState, FocusModeMode } from '../focus-mode.model';
import { TaskCopy } from '../../tasks/task.model';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';
import * as actions from '../store/focus-mode.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { EffectsModule } from '@ngrx/effects';
import { Component, EventEmitter, Output, signal, WritableSignal } from '@angular/core';
import { FocusModeTaskSelectorComponent } from '../focus-mode-task-selector/focus-mode-task-selector.component';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DialogPomodoroSettingsComponent } from '../dialog-pomodoro-settings/dialog-pomodoro-settings.component';
import { By } from '@angular/platform-browser';
import { InlineMarkdownComponent } from '../../../ui/inline-markdown/inline-markdown.component';
import { MarkdownModule } from 'ngx-markdown';
import { MentionConfigService } from '../../tasks/mention-config.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';

@Component({
  selector: 'focus-mode-task-selector',
  template: '',
  standalone: true,
})
class MockFocusModeTaskSelectorComponent {
  @Output() taskSelected = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();
}

// Fakes `matchMedia` so the inline-launch tests don't read the CI host's real
// OS setting. macOS/Windows GitHub runners report `prefers-reduced-motion:
// reduce`, which makes the component skip the rocket animation and broke the
// release build (run 28593603470). Linux reports false, hiding the
// non-hermetic dependency locally.
const matchMediaFake =
  (prefersReducedMotion: boolean) =>
  (query: string): MediaQueryList =>
    ({
      matches: query.includes('prefers-reduced-motion') ? prefersReducedMotion : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;

describe('FocusModeMainComponent', () => {
  let component: FocusModeMainComponent;
  let fixture: ComponentFixture<FocusModeMainComponent>;
  let mockStore: MockStore;
  let mockTaskService: jasmine.SpyObj<TaskService>;
  let mockTaskAttachmentService: jasmine.SpyObj<TaskAttachmentService>;
  let mockIssueService: jasmine.SpyObj<IssueService>;
  let focusModeServiceSpy: jasmine.SpyObj<FocusModeService>;
  let currentTaskSubject: BehaviorSubject<TaskCopy | null>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;

  const mockTask: TaskCopy = {
    id: 'task-1',
    title: 'Test Task',
    notes: 'Test notes',
    timeSpent: 0,
    timeEstimate: 0,
    created: Date.now(),
    isDone: false,
    subTaskIds: [],
    projectId: 'project-1',
    timeSpentOnDay: {},
    attachments: [],
    tagIds: [],
    issueType: 'GITHUB',
    issueId: '123',
    issueProviderId: 'provider-1',
  } as TaskCopy;

  beforeEach(async () => {
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      tasks: jasmine.createSpy().and.returnValue({
        notesTemplate: 'Default task notes template',
      }),
    });

    currentTaskSubject = new BehaviorSubject<TaskCopy | null>(mockTask);
    const taskServiceSpy = jasmine.createSpyObj(
      'TaskService',
      ['currentTaskId', 'update'],
      {
        currentTask$: currentTaskSubject.asObservable(),
      },
    );
    taskServiceSpy.currentTaskId.and.returnValue(mockTask.id);

    const taskAttachmentServiceSpy = jasmine.createSpyObj('TaskAttachmentService', [
      'createFromDrop',
    ]);

    const issueServiceSpy = jasmine.createSpyObj('IssueService', ['issueLink']);
    issueServiceSpy.issueLink.and.returnValue(
      Promise.resolve('https://github.com/test/repo/issues/123'),
    );

    const simpleCounterServiceSpy = jasmine.createSpyObj('SimpleCounterService', ['']);

    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockMatDialog.open.and.returnValue({
      afterClosed: () => of(null),
    } as MatDialogRef<any>);

    focusModeServiceSpy = jasmine.createSpyObj('FocusModeService', [], {
      timeElapsed: jasmine.createSpy().and.returnValue(60000),
      isCountTimeDown: jasmine.createSpy().and.returnValue(true),
      progress: jasmine.createSpy().and.returnValue(0),
      timeRemaining: jasmine.createSpy().and.returnValue(1500000),
      isSessionRunning: jasmine.createSpy().and.returnValue(false),
      isBreakActive: jasmine.createSpy().and.returnValue(false),
      currentCycle: jasmine.createSpy().and.returnValue(1),
      sessionDuration: jasmine.createSpy().and.returnValue(0),
      mode: jasmine.createSpy().and.returnValue(FocusModeMode.Pomodoro),
      mainState: jasmine.createSpy().and.returnValue(FocusMainUIState.Preparation),
      focusModeConfig: jasmine.createSpy().and.returnValue({
        isSkipPreparation: false,
      }),
      pomodoroConfig: jasmine.createSpy().and.returnValue(undefined),
      isInOvertime: jasmine.createSpy().and.returnValue(false),
      isSessionPaused: jasmine.createSpy().and.returnValue(false),
    });

    await TestBed.configureTestingModule({
      imports: [
        FocusModeMainComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        EffectsModule.forRoot([]),
      ],
      providers: [
        provideMockStore(),
        provideMockActions(() => of()),
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: TaskAttachmentService, useValue: taskAttachmentServiceSpy },
        { provide: IssueService, useValue: issueServiceSpy },
        { provide: SimpleCounterService, useValue: simpleCounterServiceSpy },
        { provide: FocusModeService, useValue: focusModeServiceSpy },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } },
        { provide: LayoutService, useValue: { isXs: signal(false) } },
      ],
    })
      .overrideComponent(FocusModeMainComponent, {
        remove: { imports: [FocusModeTaskSelectorComponent] },
        add: { imports: [MockFocusModeTaskSelectorComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FocusModeMainComponent);
    component = fixture.componentInstance;
    mockStore = TestBed.inject(Store) as MockStore;
    spyOn(mockStore, 'dispatch');
    mockTaskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    mockTaskAttachmentService = TestBed.inject(
      TaskAttachmentService,
    ) as jasmine.SpyObj<TaskAttachmentService>;
    mockIssueService = TestBed.inject(IssueService) as jasmine.SpyObj<IssueService>;

    fixture.detectChanges();
    (mockStore.dispatch as jasmine.Spy).calls.reset();
  });

  describe('initialization', () => {
    it('should initialize with current task', () => {
      expect(component.currentTask()).toBe(mockTask);
    });

    it('should set default task notes from config', () => {
      expect(component.defaultTaskNotes()).toBe('Default task notes template');
    });

    it('should initialize focus mode service properties', () => {
      expect(component.timeElapsed()).toBe(60000);
      expect(component.isCountTimeDown()).toBe(true);
    });

    it('should initialize isFocusNotes to false', () => {
      expect(component.isFocusNotes()).toBe(false);
    });

    it('should initialize isDragOver to false', () => {
      expect(component.isDragOver()).toBe(false);
    });

    it('should constrain long task titles in focus mode layout (issue #8012)', () => {
      currentTaskSubject.next({
        ...mockTask,
        title: 'A'.repeat(1000),
      });
      fixture.detectChanges();

      const taskSection = fixture.nativeElement.querySelector(
        '.task-section',
      ) as HTMLElement | null;
      const taskTitle = fixture.nativeElement.querySelector(
        'task-title.task-title',
      ) as HTMLElement | null;

      expect(taskSection).not.toBeNull();
      expect(taskTitle).not.toBeNull();

      if (!taskSection || !taskTitle) {
        return;
      }

      const sectionStyles = window.getComputedStyle(taskSection);
      const titleStyles = window.getComputedStyle(taskTitle);

      expect(sectionStyles.maxWidth).not.toBe('none');
      expect(titleStyles.maxWidth).not.toBe('none');
      expect(titleStyles.maxHeight).not.toBe('none');
      expect(titleStyles.overflowX).toBe('hidden');
      expect(titleStyles.overflowY).toBe('auto');
    });
  });

  describe('issue URL observable', () => {
    it('should create issue URL for task with issue data', (done) => {
      component.issueUrl$.subscribe((url) => {
        expect(url).toBe('https://github.com/test/repo/issues/123');
        expect(mockIssueService.issueLink).toHaveBeenCalledWith(
          'GITHUB',
          '123',
          'provider-1',
        );
        done();
      });
    });

    it('should return null for task without issue data', (done) => {
      const taskWithoutIssue = {
        ...mockTask,
        issueType: undefined,
        issueId: undefined,
        issueProviderId: undefined,
      };
      currentTaskSubject.next(taskWithoutIssue);

      component.issueUrl$.subscribe((url) => {
        expect(url).toBeNull();
        done();
      });
    });

    it('should return null when no current task', (done) => {
      currentTaskSubject.next(null);

      component.issueUrl$.subscribe((url) => {
        expect(url).toBeNull();
        done();
      });
    });
  });

  describe('drag and drop', () => {
    let mockDragEvent: jasmine.SpyObj<DragEvent>;
    let mockTarget: HTMLElement;

    beforeEach(() => {
      mockTarget = document.createElement('div');
      mockDragEvent = jasmine.createSpyObj('DragEvent', [
        'preventDefault',
        'stopPropagation',
      ]);
      Object.defineProperty(mockDragEvent, 'target', {
        value: mockTarget,
        writable: true,
      });
    });

    describe('onDragEnter', () => {
      it('should set drag state and prevent default', () => {
        component.onDragEnter(mockDragEvent);

        expect(component.isDragOver()).toBe(true);
        expect(mockDragEvent.preventDefault).toHaveBeenCalled();
        expect(mockDragEvent.stopPropagation).toHaveBeenCalled();
      });

      it('should track drag enter target', () => {
        component.onDragEnter(mockDragEvent);

        expect(component['_dragEnterTarget']).toBe(mockTarget);
      });
    });

    describe('onDragLeave', () => {
      it('should reset drag state when leaving the same target', () => {
        component['_dragEnterTarget'] = mockTarget;
        component.isDragOver.set(true);

        component.onDragLeave(mockDragEvent);

        expect(component.isDragOver()).toBe(false);
        expect(mockDragEvent.preventDefault).toHaveBeenCalled();
        expect(mockDragEvent.stopPropagation).toHaveBeenCalled();
      });

      it('should not reset drag state when leaving different target', () => {
        const differentTarget = document.createElement('span');
        component['_dragEnterTarget'] = differentTarget;
        component.isDragOver.set(true);

        component.onDragLeave(mockDragEvent);

        expect(component.isDragOver()).toBe(true);
      });
    });

    describe('onDrop', () => {
      it('should create attachment from drop when task exists', () => {
        component.onDrop(mockDragEvent);

        expect(mockTaskAttachmentService.createFromDrop).toHaveBeenCalledWith(
          mockDragEvent,
          mockTask.id,
        );
        expect(mockDragEvent.stopPropagation).toHaveBeenCalled();
        expect(component.isDragOver()).toBe(false);
      });

      it('should not create attachment when no task', () => {
        currentTaskSubject.next(null);
        fixture.detectChanges();

        component.onDrop(mockDragEvent);

        expect(mockTaskAttachmentService.createFromDrop).not.toHaveBeenCalled();
      });
    });
  });

  describe('changeTaskNotes', () => {
    it('should update task notes when changed from default', () => {
      component.defaultTaskNotes.set('Default template');

      component.changeTaskNotes('New notes');

      expect(mockTaskService.update).toHaveBeenCalledWith(mockTask.id, {
        notes: 'New notes',
      });
    });

    it('should not update when notes match default template', () => {
      component.defaultTaskNotes.set('Default template');

      component.changeTaskNotes('Default template');

      expect(mockTaskService.update).not.toHaveBeenCalled();
    });

    it('should update when notes are empty', () => {
      component.changeTaskNotes('');

      expect(mockTaskService.update).toHaveBeenCalledWith(mockTask.id, {
        notes: '',
      });
    });

    it('should not update and not throw when no task loaded', () => {
      currentTaskSubject.next(null);
      fixture.detectChanges();

      expect(() => component.changeTaskNotes('New notes')).not.toThrow();
      expect(mockTaskService.update).not.toHaveBeenCalled();
    });

    it('should handle whitespace differences in comparison', () => {
      component.defaultTaskNotes.set('  Default template  ');

      component.changeTaskNotes('Default template');

      expect(mockTaskService.update).not.toHaveBeenCalled();
    });
  });

  describe('finishCurrentTask', () => {
    it('should dispatch all required actions', () => {
      component.finishCurrentTask();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.completeTask());
      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.selectFocusTask());
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: {
            id: mockTask.id,
            changes: {
              isDone: true,
              doneOn: jasmine.any(Number) as any,
            },
          },
        }),
      );
    });

    it('should set doneOn to current timestamp', () => {
      component.finishCurrentTask();

      const calls = (mockStore.dispatch as jasmine.Spy).calls.all();
      const actionTypes = calls.map((c: any) => c.args[0].type);

      // Verify exact actions dispatched
      expect(actionTypes).toEqual([
        '[FocusMode] Complete Task',
        '[Task Shared] updateTask',
        '[FocusMode] Select Task',
      ]);

      // Get all calls and verify the UpdateTask action details
      const hasUpdateTaskAction = calls.some((call: any) => {
        const action = call.args[0];
        return (
          action.task &&
          action.task.id === mockTask.id &&
          action.task.changes.isDone === true &&
          typeof action.task.changes.doneOn === 'number'
        );
      });

      expect(hasUpdateTaskAction).toBe(true);
    });

    it('should open task selector and NOT dispatch selectFocusTask when session is running', () => {
      focusModeServiceSpy.isSessionRunning.and.returnValue(true);
      component.finishCurrentTask();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.completeTask());
      expect(mockStore.dispatch).not.toHaveBeenCalledWith(actions.selectFocusTask());
      expect(component.isTaskSelectorOpen()).toBe(true);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: {
            id: mockTask.id,
            changes: {
              isDone: true,
              doneOn: jasmine.any(Number) as any,
            },
          },
        }),
      );
    });
  });

  describe('startSession', () => {
    let matchMediaSpy: jasmine.Spy;

    beforeEach(() => {
      (mockStore.dispatch as jasmine.Spy).calls.reset();
      focusModeServiceSpy.mode.and.returnValue(FocusModeMode.Pomodoro);
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
      });
      // Motion allowed by default so the inline rocket path is exercised
      // deterministically regardless of the host OS setting.
      matchMediaSpy = spyOn(globalThis, 'matchMedia').and.callFake(matchMediaFake(false));
    });

    it('should dispatch startFocusPreparation when the prep screen is opted in', () => {
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
        isShowPreparation: true,
      });

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.startFocusPreparation());
    });

    it('should play the inline rocket then dispatch startFocusSession by default', fakeAsync(() => {
      component.displayDuration.set(900000);
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
      });

      component.startSession();

      // The rocket launches first; the session does not start immediately.
      expect(component.isLaunching()).toBe(true);
      expect(mockStore.dispatch).not.toHaveBeenCalledWith(
        actions.startFocusSession({ duration: 900000 }),
      );

      tick(800);

      expect(component.isLaunching()).toBe(false);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({ duration: 900000 }),
      );
    }));

    it('should skip the inline rocket and dispatch immediately under reduced motion', fakeAsync(() => {
      matchMediaSpy.and.callFake(matchMediaFake(true));
      component.displayDuration.set(900000);
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
      });

      component.startSession();

      // No animation delay: the session starts synchronously.
      expect(component.isLaunching()).toBe(false);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({ duration: 900000 }),
      );
    }));

    it('should ignore a re-entrant start while the inline launch is playing', fakeAsync(() => {
      component.displayDuration.set(900000);
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
      });

      component.startSession();
      expect(component.isLaunching()).toBe(true);

      // A second start during the launch window (e.g. keyboard Enter on the
      // still-focused play button) must be a no-op — not a second timer that
      // would dispatch startFocusSession again and reset the session.
      component.startSession();

      tick(800);

      const startSessionDispatchCount = (mockStore.dispatch as jasmine.Spy).calls
        .allArgs()
        .filter(
          ([action]) => action.type === actions.startFocusSession({ duration: 0 }).type,
        ).length;
      expect(startSessionDispatchCount).toBe(1);
    }));

    it('should use zero duration for Flowtime on the default inline-start path', fakeAsync(() => {
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
      });
      focusModeServiceSpy.mode.and.returnValue(FocusModeMode.Flowtime);

      component.startSession();
      tick(800);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({ duration: 0 }),
      );
    }));

    it('should open the task selector when no task is selected', () => {
      currentTaskSubject.next(null);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).not.toHaveBeenCalled();
      expect(component.isTaskSelectorOpen()).toBe(true);
    });
  });

  describe('completeFocusSession', () => {
    it('should dispatch completeFocusSession for non-Flowtime modes', () => {
      focusModeServiceSpy.mode.and.returnValue(FocusModeMode.Pomodoro);

      component.completeFocusSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.completeFocusSession({ isManual: true }),
      );
    });

    it('should dispatch endFlowtimeSession with the current task id in Flowtime mode', () => {
      focusModeServiceSpy.mode.and.returnValue(FocusModeMode.Flowtime);
      mockTaskService.currentTaskId.and.returnValue(mockTask.id);

      component.completeFocusSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.endFlowtimeSession({ pausedTaskId: mockTask.id }),
      );
      expect(mockStore.dispatch).not.toHaveBeenCalledWith(
        actions.completeFocusSession({ isManual: true }),
      );
    });
  });

  describe('trackById', () => {
    it('should return item id', () => {
      const mockCounter: SimpleCounter = { id: 'counter-1' } as SimpleCounter;

      const result = component.trackById(0, mockCounter);

      expect(result).toBe('counter-1');
    });
  });

  describe('updateTaskTitleIfChanged', () => {
    it('should update task title when changed', () => {
      component.updateTaskTitleIfChanged(true, 'New Title');

      expect(mockTaskService.update).toHaveBeenCalledWith(mockTask.id, {
        title: 'New Title',
      });
    });

    it('should not update when not changed', () => {
      component.updateTaskTitleIfChanged(false, 'New Title');

      expect(mockTaskService.update).not.toHaveBeenCalled();
    });

    it('should not update and not throw when no task loaded', () => {
      currentTaskSubject.next(null);
      fixture.detectChanges();

      expect(() => component.updateTaskTitleIfChanged(true, 'New Title')).not.toThrow();
      expect(mockTaskService.update).not.toHaveBeenCalled();
    });
  });

  describe('pomodoro settings', () => {
    describe('isShowPomodoroSettings computed signal', () => {
      // Note: The component is initialized with Preparation state and Pomodoro mode
      // so isShowPomodoroSettings should be true by default
      it('should return true when initialized with preparation state and Pomodoro mode', () => {
        // Default setup has: mainState=Preparation, mode=Pomodoro
        expect(component.isShowPomodoroSettings()).toBe(true);
      });
    });

    describe('openPomodoroSettings', () => {
      it('should open the pomodoro settings dialog', () => {
        component.openPomodoroSettings();

        expect(mockMatDialog.open).toHaveBeenCalledWith(DialogPomodoroSettingsComponent);
      });
    });
  });

  describe('mode selector visibility', () => {
    it('should show mode selector in preparation state (default)', () => {
      // Default setup has: mainState=Preparation
      expect(component.isShowModeSelector()).toBe(true);
    });

    it('should mark the layout so mobile spacing can keep the close button clear', () => {
      const layout = fixture.nativeElement.querySelector(
        'focus-mode-layout',
      ) as HTMLElement;

      expect(layout.classList.contains('has-mode-selector')).toBe(true);
    });
  });

  describe('accessible names', () => {
    it('should label all icon-only preparation controls', () => {
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('.play-actions button'),
      ) as HTMLButtonElement[];

      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
        'F.FOCUS_MODE.START_FOCUS_SESSION',
        'F.FOCUS_MODE.POMODORO_SETTINGS',
      ]);
    });
  });

  describe('selectMode', () => {
    it('should dispatch setFocusModeMode action for valid mode', () => {
      component.selectMode(FocusModeMode.Flowtime);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
      );
    });

    it('should dispatch setFocusModeMode action for Pomodoro mode', () => {
      component.selectMode(FocusModeMode.Pomodoro);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.setFocusModeMode({ mode: FocusModeMode.Pomodoro }),
      );
    });

    it('should dispatch setFocusModeMode action for Countdown mode', () => {
      component.selectMode(FocusModeMode.Countdown);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.setFocusModeMode({ mode: FocusModeMode.Countdown }),
      );
    });

    it('should not dispatch for invalid mode value', () => {
      component.selectMode('invalid-mode');

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });
  });
});

/**
 * Separate test suite for notes panel tests that need InProgress state
 * Uses signal-based mocks to properly trigger computed signals
 */
describe('FocusModeMainComponent - notes panel (issue #5752)', () => {
  let component: FocusModeMainComponent;
  let fixture: ComponentFixture<FocusModeMainComponent>;
  let mockStore: MockStore;
  let currentTaskSubject: BehaviorSubject<TaskCopy | null>;
  let mainStateSignal: WritableSignal<FocusMainUIState>;
  let modeSignal: WritableSignal<FocusModeMode>;
  let isSessionRunningSignal: WritableSignal<boolean>;
  let isXsSignal: WritableSignal<boolean>;
  let mockIssueService: jasmine.SpyObj<IssueService>;

  const mockTask: TaskCopy = {
    id: 'task-1',
    title: 'Test Task',
    notes: 'Test notes',
    timeSpent: 0,
    timeEstimate: 0,
    created: Date.now(),
    isDone: false,
    subTaskIds: [],
    projectId: 'project-1',
    timeSpentOnDay: {},
    attachments: [],
    tagIds: [],
    issueType: 'GITHUB',
    issueId: '123',
    issueProviderId: 'provider-1',
    issuePoints: 5,
  } as TaskCopy;

  beforeEach(async () => {
    // Create writable signals for state that affects template rendering
    mainStateSignal = signal(FocusMainUIState.InProgress);
    modeSignal = signal(FocusModeMode.Pomodoro);
    isSessionRunningSignal = signal(true);
    isXsSignal = signal(true);

    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      tasks: jasmine.createSpy().and.returnValue({
        notesTemplate: 'Default task notes template',
      }),
    });

    currentTaskSubject = new BehaviorSubject<TaskCopy | null>(mockTask);
    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['update'], {
      currentTask$: currentTaskSubject.asObservable(),
    });

    const taskAttachmentServiceSpy = jasmine.createSpyObj('TaskAttachmentService', [
      'createFromDrop',
    ]);

    mockIssueService = jasmine.createSpyObj('IssueService', ['issueLink']);
    mockIssueService.issueLink.and.returnValue(Promise.resolve('https://example.com'));

    const simpleCounterServiceSpy = jasmine.createSpyObj('SimpleCounterService', [''], {
      enabledSimpleCounters$: of([]),
    });

    const mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockMatDialog.open.and.returnValue({
      afterClosed: () => of(null),
    } as MatDialogRef<any>);

    // Use signals instead of spies for properties that affect computed signals
    const focusModeServiceMock = {
      timeElapsed: signal(60000),
      isCountTimeDown: signal(true),
      progress: signal(0),
      timeRemaining: signal(1500000),
      isSessionRunning: isSessionRunningSignal,
      isSessionPaused: signal(false),
      isBreakActive: signal(false),
      currentCycle: signal(1),
      sessionDuration: signal(0),
      mode: modeSignal,
      mainState: mainStateSignal,
      focusModeConfig: signal({
        isSkipPreparation: false,
      }),
      pomodoroConfig: signal(undefined),
      isInOvertime: signal(false),
    };

    await TestBed.configureTestingModule({
      imports: [
        FocusModeMainComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        EffectsModule.forRoot([]),
        MarkdownModule.forRoot(),
      ],
      providers: [
        provideMockStore(),
        provideMockActions(() => of()),
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: TaskAttachmentService, useValue: taskAttachmentServiceSpy },
        { provide: IssueService, useValue: mockIssueService },
        { provide: SimpleCounterService, useValue: simpleCounterServiceSpy },
        { provide: FocusModeService, useValue: focusModeServiceMock },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } },
        { provide: LayoutService, useValue: { isXs: isXsSignal } },
      ],
    })
      .overrideComponent(FocusModeMainComponent, {
        remove: { imports: [FocusModeTaskSelectorComponent] },
        add: { imports: [MockFocusModeTaskSelectorComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FocusModeMainComponent);
    component = fixture.componentInstance;
    mockStore = TestBed.inject(Store) as MockStore;
    spyOn(mockStore, 'dispatch');
    fixture.detectChanges();
    (mockStore.dispatch as jasmine.Spy).calls.reset();
  });

  it('should hide the mode selector while a focus session is in progress', () => {
    expect(component.isShowModeSelector()).toBe(false);
  });

  it('should remove the mode selector from the DOM (not just visually hide it) while in progress', () => {
    // Regression: a visibility:hidden selector still left its mat-icons painted,
    // because the global `body.isMaterialSymbolsLoaded mat-icon` rule forces
    // visibility:visible (an explicit value beats the inherited hidden one).
    // The selector must be removed from the DOM so no icons can remain.
    const selector = fixture.nativeElement.querySelector('segmented-button-group');

    expect(selector).toBeNull();
  });

  it('should hide the mode selector while a Flowtime session is in progress', () => {
    modeSignal.set(FocusModeMode.Flowtime);
    fixture.detectChanges();

    expect(component.isShowModeSelector()).toBe(false);
  });

  it('should only show the active fixed-duration mode and Flowtime while in progress', () => {
    const options = component.modeOptions();

    expect(options.map((option) => option.id)).toEqual([
      FocusModeMode.Flowtime,
      FocusModeMode.Pomodoro,
    ]);
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  it('should dispatch Flowtime mode changes while a fixed-duration session is in progress', () => {
    component.selectMode(FocusModeMode.Flowtime);

    expect(mockStore.dispatch).toHaveBeenCalledWith(
      actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
    );
  });

  it('should ignore active-session mode changes to another fixed-duration mode', () => {
    component.selectMode(FocusModeMode.Countdown);

    expect(mockStore.dispatch).not.toHaveBeenCalled();
  });

  it('should keep the primary session actions visible and group secondary actions on mobile', () => {
    const controls = fixture.nativeElement.querySelector(
      '.bottom-controls',
    ) as HTMLElement;
    const buttons = Array.from(
      controls.querySelectorAll(':scope > button, :scope > a'),
    ) as HTMLElement[];

    expect(buttons.length).toBe(4);
    expect(controls.querySelector('.secondary-actions-menu-btn')).not.toBeNull();
  });

  it('should restore direct secondary session actions and issue points on desktop', () => {
    isXsSignal.set(false);
    fixture.detectChanges();

    const controls = fixture.nativeElement.querySelector(
      '.bottom-controls',
    ) as HTMLElement;
    const buttons = Array.from(
      controls.querySelectorAll(':scope > button, :scope > a'),
    ) as HTMLElement[];

    expect(buttons.length).toBe(6);
    expect(controls.querySelector('.secondary-actions-menu-btn')).toBeNull();
    expect(controls.querySelector('.reset-cycles-btn')).not.toBeNull();
    expect(controls.querySelector('.open-issue-btn')).not.toBeNull();
    expect(controls.querySelector('.show-notes-btn')).not.toBeNull();
    expect(controls.querySelector('.mini-badge')?.textContent?.trim()).toBe('5');
  });

  it('should defer resolving the issue URL until the mobile More menu opens', async () => {
    expect(mockIssueService.issueLink).not.toHaveBeenCalled();

    const trigger = fixture.nativeElement.querySelector(
      '.secondary-actions-menu-btn',
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockIssueService.issueLink).toHaveBeenCalledOnceWith(
      'GITHUB',
      '123',
      'provider-1',
    );
  });

  it('should open the secondary actions menu and toggle notes', async () => {
    const trigger = fixture.nativeElement.querySelector(
      '.secondary-actions-menu-btn',
    ) as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const menuItems = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button'),
    );
    const notesButton = menuItems.find((button) =>
      button.textContent?.includes('F.FOCUS_MODE.SHOW_HIDE_NOTES_AND_ATTACHMENTS'),
    );

    expect(notesButton).toBeDefined();
    expect(component.isFocusNotes()).toBe(false);

    notesButton!.click();
    fixture.detectChanges();

    expect(component.isFocusNotes()).toBe(true);
  });

  it('should label every icon-only primary session action', () => {
    const controls = fixture.nativeElement.querySelector(
      '.bottom-controls',
    ) as HTMLElement;
    const buttons = Array.from(
      controls.querySelectorAll(':scope > button, :scope > a'),
    ) as HTMLElement[];

    expect(buttons.every((button) => Boolean(button.getAttribute('aria-label')))).toBe(
      true,
    );
  });

  it('should pass isDefaultText=false to inline-markdown when task has notes', () => {
    // Arrange: task has existing notes
    const taskWithNotes = { ...mockTask, notes: 'My existing notes' };
    currentTaskSubject.next(taskWithNotes);
    fixture.detectChanges();

    // Act: open notes panel
    component.isFocusNotes.set(true);
    fixture.detectChanges();

    // Assert: inline-markdown should receive isDefaultText=false
    const inlineMarkdown = fixture.debugElement.query(
      By.directive(InlineMarkdownComponent),
    );
    expect(inlineMarkdown).toBeTruthy();
    expect(inlineMarkdown.componentInstance.isDefaultText()).toBe(false);
  });

  it('should pass isDefaultText=true to inline-markdown when task has no notes', () => {
    // Arrange: task has no notes (undefined)
    const taskWithoutNotes = { ...mockTask, notes: undefined };
    currentTaskSubject.next(taskWithoutNotes);
    fixture.detectChanges();

    // Act: open notes panel
    component.isFocusNotes.set(true);
    fixture.detectChanges();

    // Assert: inline-markdown should receive isDefaultText=true
    const inlineMarkdown = fixture.debugElement.query(
      By.directive(InlineMarkdownComponent),
    );
    expect(inlineMarkdown).toBeTruthy();
    expect(inlineMarkdown.componentInstance.isDefaultText()).toBe(true);
  });

  it('should pass isDefaultText=true to inline-markdown when task has empty notes', () => {
    // Arrange: task has empty string notes
    const taskWithEmptyNotes = { ...mockTask, notes: '' };
    currentTaskSubject.next(taskWithEmptyNotes);
    fixture.detectChanges();

    // Act: open notes panel
    component.isFocusNotes.set(true);
    fixture.detectChanges();

    // Assert: inline-markdown should receive isDefaultText=true
    const inlineMarkdown = fixture.debugElement.query(
      By.directive(InlineMarkdownComponent),
    );
    expect(inlineMarkdown).toBeTruthy();
    expect(inlineMarkdown.componentInstance.isDefaultText()).toBe(true);
  });

  it('should display existing notes instead of default template when task has notes', () => {
    // Arrange: task has existing notes, default template is set
    const existingNotes = 'My important existing notes';
    const taskWithNotes = { ...mockTask, notes: existingNotes };
    currentTaskSubject.next(taskWithNotes);
    component.defaultTaskNotes.set('Default task notes template');
    fixture.detectChanges();

    // Act: open notes panel
    component.isFocusNotes.set(true);
    fixture.detectChanges();

    // Assert: inline-markdown model should be the existing notes, not the template
    const inlineMarkdown = fixture.debugElement.query(
      By.directive(InlineMarkdownComponent),
    );
    expect(inlineMarkdown).toBeTruthy();
    expect(inlineMarkdown.componentInstance.model).toBe(existingNotes);
  });
});

/**
 * Separate test suite for isPlayButtonDisabled and startSession with sync tracking (issue #6009)
 * Uses signal-based mocks to properly test computed signals
 */
describe('FocusModeMainComponent - sync with tracking (issue #6009)', () => {
  let component: FocusModeMainComponent;
  let fixture: ComponentFixture<FocusModeMainComponent>;
  let mockStore: jasmine.SpyObj<Store>;
  let currentTaskSubject: BehaviorSubject<TaskCopy | null>;
  let focusModeConfigSignal: WritableSignal<any>;

  const mockTask: TaskCopy = {
    id: 'task-1',
    title: 'Test Task',
    notes: 'Test notes',
    timeSpent: 0,
    timeEstimate: 0,
    created: Date.now(),
    isDone: false,
    subTaskIds: [],
    projectId: 'project-1',
    timeSpentOnDay: {},
    attachments: [],
    tagIds: [],
  } as TaskCopy;

  beforeEach(async () => {
    // Create writable signal for focusModeConfig to test computed signals
    focusModeConfigSignal = signal({
      isSkipPreparation: false,
    });

    const storeSpy = jasmine.createSpyObj('Store', [
      'dispatch',
      'select',
      'selectSignal',
    ]);
    storeSpy.select.and.returnValue(of([]));
    storeSpy.selectSignal.and.returnValue(signal(null));

    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      tasks: jasmine.createSpy().and.returnValue({
        notesTemplate: 'Default task notes template',
      }),
    });

    currentTaskSubject = new BehaviorSubject<TaskCopy | null>(mockTask);
    const taskServiceSpy = jasmine.createSpyObj(
      'TaskService',
      ['update', 'setCurrentId'],
      {
        currentTask$: currentTaskSubject.asObservable(),
        currentTaskId: jasmine.createSpy().and.returnValue(null),
      },
    );

    const taskAttachmentServiceSpy = jasmine.createSpyObj('TaskAttachmentService', [
      'createFromDrop',
    ]);

    const issueServiceSpy = jasmine.createSpyObj('IssueService', ['issueLink']);
    issueServiceSpy.issueLink.and.returnValue(Promise.resolve('https://example.com'));

    const simpleCounterServiceSpy = jasmine.createSpyObj('SimpleCounterService', [''], {
      enabledSimpleCounters$: of([]),
    });

    const mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockMatDialog.open.and.returnValue({
      afterClosed: () => of(null),
    } as MatDialogRef<any>);

    // Use signals for properties that affect computed signals
    const focusModeServiceMock = {
      timeElapsed: signal(60000),
      isCountTimeDown: signal(true),
      progress: signal(0),
      timeRemaining: signal(1500000),
      isSessionRunning: signal(false),
      isSessionPaused: signal(false),
      isBreakActive: signal(false),
      currentCycle: signal(1),
      sessionDuration: signal(0),
      mode: signal(FocusModeMode.Pomodoro),
      mainState: signal(FocusMainUIState.Preparation),
      focusModeConfig: focusModeConfigSignal,
      pomodoroConfig: signal(undefined),
      isInOvertime: signal(false),
    };

    await TestBed.configureTestingModule({
      imports: [
        FocusModeMainComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        EffectsModule.forRoot([]),
        MarkdownModule.forRoot(),
      ],
      providers: [
        { provide: Store, useValue: storeSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: TaskAttachmentService, useValue: taskAttachmentServiceSpy },
        { provide: IssueService, useValue: issueServiceSpy },
        { provide: SimpleCounterService, useValue: simpleCounterServiceSpy },
        { provide: FocusModeService, useValue: focusModeServiceMock },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } },
        { provide: LayoutService, useValue: { isXs: signal(false) } },
      ],
    })
      .overrideComponent(FocusModeMainComponent, {
        remove: { imports: [FocusModeTaskSelectorComponent] },
        add: { imports: [MockFocusModeTaskSelectorComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FocusModeMainComponent);
    component = fixture.componentInstance;
    mockStore = TestBed.inject(Store) as jasmine.SpyObj<Store>;
    fixture.detectChanges();
    mockStore.dispatch.calls.reset();
  });

  describe('isPlayButtonDisabled', () => {
    // Tracking and focus session lifecycles are now always synced —
    // starting a session without a task would orphan tracking.
    it('should return true when no task is selected', () => {
      focusModeConfigSignal.set({
        isSkipPreparation: false,
      });
      currentTaskSubject.next(null);
      fixture.detectChanges();

      expect(component.isPlayButtonDisabled()).toBe(true);
    });

    it('should return false when a task is selected', () => {
      focusModeConfigSignal.set({
        isSkipPreparation: false,
      });
      currentTaskSubject.next(mockTask);
      fixture.detectChanges();

      expect(component.isPlayButtonDisabled()).toBe(false);
    });
  });

  describe('finishCurrentTask - session state captured before dispatch (issue #6127)', () => {
    it('should use pre-dispatch session state when effects pause the session during dispatch', () => {
      const isSessionRunningSignal = (TestBed.inject(FocusModeService) as any)
        .isSessionRunning;
      isSessionRunningSignal.set(true);
      fixture.detectChanges();

      // Simulate the NgRx effect chain: dispatching updateTask triggers
      // autoSetNextTask$ → syncTrackingStopToSession$ → pauseFocusSession(),
      // which sets isSessionRunning to false before finishCurrentTask continues.
      (mockStore.dispatch as jasmine.Spy).and.callFake(() => {
        isSessionRunningSignal.set(false);
      });

      component.finishCurrentTask();

      // The task selector should open because the session WAS running
      // before the dispatch, even though effects paused it during dispatch.
      expect(component.isTaskSelectorOpen()).toBe(true);
      expect(mockStore.dispatch).not.toHaveBeenCalledWith(actions.selectFocusTask());
    });
  });

  describe('startSession', () => {
    beforeEach(() => {
      // Deterministic motion setting so the inline rocket path is exercised
      // regardless of the host OS (macOS/Windows CI report reduced motion).
      spyOn(globalThis, 'matchMedia').and.callFake(matchMediaFake(false));
    });

    it('should open task selector when no task is selected', () => {
      focusModeConfigSignal.set({
        isSkipPreparation: false,
      });
      currentTaskSubject.next(null);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).not.toHaveBeenCalled();
      expect(component.isTaskSelectorOpen()).toBe(true);
    });

    it('should dispatch startFocusPreparation when a task is selected and the prep screen is opted in', () => {
      focusModeConfigSignal.set({
        isSkipPreparation: false,
        isShowPreparation: true,
      });
      currentTaskSubject.next(mockTask);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.startFocusPreparation());
      expect(component.isTaskSelectorOpen()).toBe(false);
    });

    it('should play the inline rocket then dispatch startFocusSession by default', fakeAsync(() => {
      component.displayDuration.set(1500000);
      focusModeConfigSignal.set({
        isSkipPreparation: false,
      });
      currentTaskSubject.next(mockTask);
      fixture.detectChanges();

      component.startSession();
      expect(component.isLaunching()).toBe(true);

      tick(800);

      expect(component.isLaunching()).toBe(false);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({
          duration: 1500000,
        }),
      );
    }));
  });
});
