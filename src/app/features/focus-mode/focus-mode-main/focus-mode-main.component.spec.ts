import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';
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

@Component({
  selector: 'focus-mode-task-selector',
  template: '',
  standalone: true,
})
class MockFocusModeTaskSelectorComponent {
  @Output() taskSelected = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();
}

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
    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['update'], {
      currentTask$: currentTaskSubject.asObservable(),
    });

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
    beforeEach(() => {
      (mockStore.dispatch as jasmine.Spy).calls.reset();
      focusModeServiceSpy.mode.and.returnValue(FocusModeMode.Pomodoro);
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
      });
    });

    it('should dispatch startFocusPreparation when skip is disabled', () => {
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: false,
      });

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.startFocusPreparation());
    });

    it('should dispatch startFocusSession with duration when skip is enabled', () => {
      component.displayDuration.set(900000);
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: true,
      });

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({ duration: 900000, isManualSessionCompletion: false }),
      );
    });

    it('should dispatch startFocusSession with isManualSessionCompletion: true when isManualBreakStart is enabled', () => {
      component.displayDuration.set(900000);
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: true,
        isManualBreakStart: true,
      });

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({ duration: 900000, isManualSessionCompletion: true }),
      );
    });

    it('should use zero duration for Flowtime when skipping preparation', () => {
      focusModeServiceSpy.focusModeConfig.and.returnValue({
        isSkipPreparation: true,
      });
      focusModeServiceSpy.mode.and.returnValue(FocusModeMode.Flowtime);

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({ duration: 0, isManualSessionCompletion: false }),
      );
    });

    it('should dispatch even when no current task', () => {
      currentTaskSubject.next(null);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.startFocusPreparation());
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
  let currentTaskSubject: BehaviorSubject<TaskCopy | null>;
  let mainStateSignal: WritableSignal<FocusMainUIState>;
  let isSessionRunningSignal: WritableSignal<boolean>;

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
    // Create writable signals for state that affects template rendering
    mainStateSignal = signal(FocusMainUIState.InProgress);
    isSessionRunningSignal = signal(true);

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

    const issueServiceSpy = jasmine.createSpyObj('IssueService', ['issueLink']);
    issueServiceSpy.issueLink.and.returnValue(Promise.resolve('https://example.com'));

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
      mode: signal(FocusModeMode.Pomodoro),
      mainState: mainStateSignal,
      focusModeConfig: signal({
        isSkipPreparation: false,
      }),
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
        { provide: IssueService, useValue: issueServiceSpy },
        { provide: SimpleCounterService, useValue: simpleCounterServiceSpy },
        { provide: FocusModeService, useValue: focusModeServiceMock },
        { provide: MatDialog, useValue: mockMatDialog },
      ],
    })
      .overrideComponent(FocusModeMainComponent, {
        remove: { imports: [FocusModeTaskSelectorComponent] },
        add: { imports: [MockFocusModeTaskSelectorComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FocusModeMainComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
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
      isSyncSessionWithTracking: false,
    });

    const storeSpy = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    storeSpy.select.and.returnValue(of([]));

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
    it('should return true when sync with tracking is enabled and no task selected', () => {
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      currentTaskSubject.next(null);
      fixture.detectChanges();

      expect(component.isPlayButtonDisabled()).toBe(true);
    });

    it('should return false when sync with tracking is enabled and task is selected', () => {
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      currentTaskSubject.next(mockTask);
      fixture.detectChanges();

      expect(component.isPlayButtonDisabled()).toBe(false);
    });

    it('should return false when sync with tracking is disabled and no task selected', () => {
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      currentTaskSubject.next(null);
      fixture.detectChanges();

      expect(component.isPlayButtonDisabled()).toBe(false);
    });

    it('should return false when sync with tracking is disabled and task is selected', () => {
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: false,
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

  describe('startSession with sync tracking', () => {
    it('should open task selector when sync is enabled and no task selected', () => {
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      currentTaskSubject.next(null);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).not.toHaveBeenCalled();
      expect(component.isTaskSelectorOpen()).toBe(true);
    });

    it('should dispatch startFocusPreparation when sync is enabled and task is selected', () => {
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: true,
        isSkipPreparation: false,
      });
      currentTaskSubject.next(mockTask);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.startFocusPreparation());
      expect(component.isTaskSelectorOpen()).toBe(false);
    });

    it('should dispatch startFocusPreparation when sync is disabled and no task selected', () => {
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: false,
        isSkipPreparation: false,
      });
      currentTaskSubject.next(null);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(actions.startFocusPreparation());
    });

    it('should dispatch startFocusSession when sync is enabled, task is selected, and skip preparation is enabled', () => {
      component.displayDuration.set(1500000);
      focusModeConfigSignal.set({
        isSyncSessionWithTracking: true,
        isSkipPreparation: true,
      });
      currentTaskSubject.next(mockTask);
      fixture.detectChanges();

      component.startSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        actions.startFocusSession({
          duration: 1500000,
          isManualSessionCompletion: false,
        }),
      );
    });
  });
});
