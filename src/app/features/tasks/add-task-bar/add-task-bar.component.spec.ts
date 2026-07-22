import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AddTaskBarComponent } from './add-task-bar.component';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { AddTaskBarIssueSearchService } from './add-task-bar-issue-search.service';
import { SnackService } from '../../../core/snack/snack.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { Project } from '../../project/project.model';
import { WorkContext } from '../../work-context/work-context.model';
import { LocalizationConfig, MiscConfig } from '../../config/global-config.model';
import { first } from 'rxjs/operators';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, Signal } from '@angular/core';
import { AddTaskSuggestion } from './add-task-suggestions.model';
import { PlannerActions } from '../../planner/store/planner.actions';
import { TaskCopy, TaskReminderOptionId } from '../task.model';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { DEFAULT_LOCALE } from 'src/app/core/locale.constants';
import { DateService } from '../../../core/date/date.service';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { SS } from '../../../core/persistence/storage-keys.const';
import { BodyClass } from '../../../app.constants';

type ProjectServiceSignals = {
  list$: Observable<Project[]>;
  listSorted$: Observable<Project[]>;
  listSortedForUI$: Observable<Project[]>;
  listInTreeOrderForUI$: Observable<Project[]>;
  listSortedForUI: Signal<Project[]>;
  listInTreeOrderForUI: Signal<Project[]>;
  listSorted: Signal<Project[]>;
};

type TagServiceSignals = {
  tags$: Observable<any[]>;
  tagsNoMyDayAndNoList$: Observable<any[]>;
  tagsNoMyDayAndNoListSorted$: Observable<any[]>;
  tagsNoMyDayAndNoListInTreeOrder$: Observable<any[]>;
  tagsSortedForUI$: Observable<any[]>;
  tagsSorted$: Observable<any[]>;
  tagsNoMyDayAndNoListSorted: Signal<any[]>;
  tagsNoMyDayAndNoListInTreeOrder: Signal<any[]>;
  tagsSorted: Signal<any[]>;
  tagsSortedForUI: Signal<any[]>;
};

describe('AddTaskBarComponent', () => {
  let component: AddTaskBarComponent;
  let fixture: ComponentFixture<AddTaskBarComponent>;
  let mockTaskService: jasmine.SpyObj<TaskService>;
  let mockWorkContextService: jasmine.SpyObj<WorkContextService>;
  let mockProjectService: jasmine.SpyObj<ProjectService>;
  let mockTagService: jasmine.SpyObj<TagService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockStore: jasmine.SpyObj<Store>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockAddTaskBarIssueSearchService: jasmine.SpyObj<AddTaskBarIssueSearchService>;
  let mockDateService: jasmine.SpyObj<DateService>;

  // Mock data
  const mockProjects: Project[] = [
    {
      id: 'INBOX_PROJECT',
      title: 'Inbox',
      isArchived: false,
      isHiddenFromMenu: false,
      theme: { primary: '#3f51b5' },
      icon: 'inbox',
    } as Project,
    {
      id: 'project-1',
      title: 'Project 1',
      isArchived: false,
      isHiddenFromMenu: false,
      theme: { primary: '#4caf50' },
      icon: 'folder',
    } as Project,
    {
      id: 'project-2',
      title: 'Project 2',
      isArchived: false,
      isHiddenFromMenu: false,
      theme: { primary: '#ff9800' },
      icon: 'folder',
    } as Project,
    {
      id: 'default-project',
      title: 'Default Project',
      isArchived: false,
      isHiddenFromMenu: false,
      theme: { primary: '#9c27b0' },
      icon: 'folder',
    } as Project,
  ];

  const mockProjectWorkContext: WorkContext = {
    id: 'project-1',
    title: 'Project 1',
    type: WorkContextType.PROJECT,
  } as WorkContext;

  const mockTagWorkContext: WorkContext = {
    id: 'TODAY',
    title: 'Today',
    type: WorkContextType.TAG,
  } as WorkContext;

  const mockLocalizationConfig: LocalizationConfig = {
    firstDayOfWeek: 1,
  };

  const mockMiscConfig: MiscConfig = {
    defaultProjectId: null,
    isAutMarkParentAsDone: false,
    isConfirmBeforeExit: false,
    isConfirmBeforeExitWithoutFinishDay: false,
    isTurnOffMarkdown: false,
    isAutoAddWorkedOnToToday: false,
    isMinimizeToTray: false,
    isTrayShowCurrentTask: false,
    startOfNextDay: 4,
    taskNotesTpl: '',
    isDisableAnimations: false,
  };

  const createProjectSignals = (projects: Project[]): ProjectServiceSignals => {
    const projects$ = of(projects);
    return {
      list$: projects$,
      listSorted$: projects$,
      listSortedForUI$: projects$,
      listInTreeOrderForUI$: projects$,
      listSortedForUI: signal(projects),
      listInTreeOrderForUI: signal(projects),
      listSorted: signal(projects),
    };
  };

  const createTagSignals = (tags: any[]): TagServiceSignals => {
    const tags$ = of(tags);
    return {
      tags$,
      tagsNoMyDayAndNoList$: tags$,
      tagsNoMyDayAndNoListSorted$: tags$,
      tagsNoMyDayAndNoListInTreeOrder$: tags$,
      tagsSortedForUI$: tags$,
      tagsSorted$: tags$,
      tagsNoMyDayAndNoListSorted: signal(tags),
      tagsNoMyDayAndNoListInTreeOrder: signal(tags),
      tagsSorted: signal(tags),
      tagsSortedForUI: signal(tags),
    };
  };

  const mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', [
    'currentLocale',
    'textLocale',
  ]);
  mockDateTimeFormatService.currentLocale.and.returnValue('en-US');
  mockDateTimeFormatService.textLocale.and.returnValue('en-US');

  beforeEach(async () => {
    // The state service seeds its note draft (and thus isNoteExpanded) from
    // sessionStorage, which persists across the whole Karma run. Clear it so a
    // note left behind by another test can't make the note panel start expanded.
    sessionStorage.removeItem(SS.ADD_TASK_BAR_TXT);
    sessionStorage.removeItem(SS.ADD_TASK_BAR_NOTE);

    // Create spies
    mockTaskService = jasmine.createSpyObj('TaskService', [
      'add',
      'getByIdOnce$',
      'scheduleTask',
      'moveToCurrentWorkContext',
    ]);
    mockWorkContextService = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContext$: new BehaviorSubject<WorkContext | null>(null),
    });
    mockProjectService = jasmine.createSpyObj(
      'ProjectService',
      [],
      createProjectSignals(mockProjects),
    );
    mockTagService = jasmine.createSpyObj(
      'TagService',
      [],
      createTagSignals([
        {
          id: 'tag-1',
          title: 'Test Tag',
          theme: { primary: '#2196f3' },
          icon: 'label',
        },
      ]),
    );
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg: signal({
        reminder: { defaultTaskRemindOption: TaskReminderOptionId.AtStart },
      }),
      lang$: new BehaviorSubject<LocalizationConfig>(mockLocalizationConfig),
      misc$: new BehaviorSubject<MiscConfig>(mockMiscConfig),
      tasks$: new BehaviorSubject({ defaultProjectId: null }),
      shortSyntax$: of({}),
      localization: () => ({ timeLocale: DEFAULT_LOCALE }),
    });
    mockStore = jasmine.createSpyObj('Store', ['select', 'dispatch', 'pipe']);
    mockStore.pipe.and.returnValue(of([]));
    mockStore.select.and.returnValue(of([]));
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockAddTaskBarIssueSearchService = jasmine.createSpyObj(
      'AddTaskBarIssueSearchService',
      ['getFilteredIssueSuggestions$', 'addTaskFromExistingTaskOrIssue'],
    );
    mockDateService = jasmine.createSpyObj('DateService', [
      'todayStr',
      'getStartOfNextDayDiffMs',
      'getLogicalTodayDate',
    ]);
    mockDateService.todayStr.and.callFake(() => getDbDateStr(new Date()));
    mockDateService.getStartOfNextDayDiffMs.and.returnValue(0);
    mockDateService.getLogicalTodayDate.and.callFake(() => new Date());
    // Setup method returns
    mockAddTaskBarIssueSearchService.getFilteredIssueSuggestions$.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [AddTaskBarComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: TaskService, useValue: mockTaskService },
        { provide: WorkContextService, useValue: mockWorkContextService },
        { provide: ProjectService, useValue: mockProjectService },
        { provide: TagService, useValue: mockTagService },
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        { provide: DateService, useValue: mockDateService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: Store, useValue: mockStore },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: SnackService, useValue: mockSnackService },
        {
          provide: AddTaskBarIssueSearchService,
          useValue: mockAddTaskBarIssueSearchService,
        },
      ],
    }).compileComponents();

    // Set up translations first
    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('en', {
      F: {
        TASK: {
          ADD_TASK_BAR: {
            PLACEHOLDER_SEARCH: 'Search tasks...',
            PLACEHOLDER_CREATE: 'Add task...',
            TOOLTIP_ADD_TASK: 'Add task',
            TOOLTIP_ADD_TO_TOP: 'Add to top',
            TOOLTIP_ADD_TO_BOTTOM: 'Add to bottom',
          },
        },
      },
    });
    translateService.use('en');

    fixture = TestBed.createComponent(AddTaskBarComponent);
    component = fixture.componentInstance;
  });

  describe('highlightSegments', () => {
    it('splits the input by the ranges parsed from that exact text', () => {
      component.stateService.updateInputTxt('Buy milk #shop');
      component.stateService.updateSyntaxHighlight({
        forText: 'Buy milk #shop',
        ranges: [{ start: 9, end: 14, type: 'tag' }],
      });

      expect(component.highlightSegments()).toEqual([
        { text: 'Buy milk ', type: null },
        { text: '#shop', type: 'tag' },
      ]);
    });

    // The parse is async: the keystroke paints before its ranges exist, so
    // dropping every range on a mismatch blanks the overlay for a frame.
    it('keeps ranges inside the unchanged common prefix while the parse catches up', () => {
      component.stateService.updateSyntaxHighlight({
        forText: 'Buy milk #shop',
        ranges: [{ start: 9, end: 14, type: 'tag' }],
      });
      component.stateService.updateInputTxt('Buy milk #shop t');

      expect(component.highlightSegments()).toEqual([
        { text: 'Buy milk ', type: null },
        { text: '#shop', type: 'tag' },
        { text: ' t', type: null },
      ]);
    });

    it('drops ranges the edit could have moved', () => {
      component.stateService.updateSyntaxHighlight({
        forText: 'Buy milk #shop',
        ranges: [{ start: 9, end: 14, type: 'tag' }],
      });
      // Edit lands before the range, so its position is no longer trustworthy.
      component.stateService.updateInputTxt('Buy some milk #shop');

      expect(component.highlightSegments()).toEqual([
        { text: 'Buy some milk #shop', type: null },
      ]);
    });

    it('renders nothing in search mode', () => {
      component.stateService.updateInputTxt('Buy milk #shop');
      component.stateService.updateSyntaxHighlight({
        forText: 'Buy milk #shop',
        ranges: [{ start: 9, end: 14, type: 'tag' }],
      });
      component.isSearchMode.set(true);

      expect(component.highlightSegments()).toEqual([]);
    });
  });

  describe('mobile keyboard positioning', () => {
    let hadTouchOnlyClass: boolean;
    let hadIOSClass: boolean;

    beforeEach(() => {
      hadTouchOnlyClass = document.body.classList.contains(BodyClass.isTouchOnly);
      hadIOSClass = document.body.classList.contains(BodyClass.isIOS);
      document.body.classList.add(BodyClass.isTouchOnly);
      document.body.classList.remove(BodyClass.isIOS);
      fixture.nativeElement.classList.add('global');
      fixture.nativeElement.style.setProperty('--keyboard-height', '336px');
      fixture.nativeElement.style.setProperty('--keyboard-overlay-offset', '0px');
      fixture.nativeElement.style.setProperty('--s', '8px');
      fixture.nativeElement.style.setProperty('--s2', '16px');
      fixture.nativeElement.style.setProperty('--transition-duration-m', '0ms');
      fixture.detectChanges();
    });

    afterEach(() => {
      document.body.classList.toggle(BodyClass.isTouchOnly, hadTouchOnlyClass);
      document.body.classList.toggle(BodyClass.isIOS, hadIOSClass);
    });

    it('uses the overlay-only keyboard offset for the iOS global bar', () => {
      document.body.classList.add(BodyClass.isIOS);

      expect(getComputedStyle(fixture.nativeElement).bottom).toBe('16px');
    });

    it('keeps the global bar above an iOS keyboard that still overlays the viewport', () => {
      document.body.classList.add(BodyClass.isIOS);
      fixture.nativeElement.style.setProperty('--keyboard-overlay-offset', '40px');

      expect(getComputedStyle(fixture.nativeElement).bottom).toBe('56px');
    });

    it('keeps the measured keyboard offset for non-iOS touch builds', () => {
      expect(getComputedStyle(fixture.nativeElement).bottom).toBe('352px');
    });

    it('keeps the top-positioned layout for hybrid iOS devices', () => {
      document.body.classList.remove(BodyClass.isTouchOnly);
      const layoutBeforeIOSClass = fixture.nativeElement.getBoundingClientRect();

      document.body.classList.add(BodyClass.isIOS);
      const layoutAfterIOSClass = fixture.nativeElement.getBoundingClientRect();

      expect(layoutAfterIOSClass.top).toBe(layoutBeforeIOSClass.top);
      expect(layoutAfterIOSClass.height).toBe(layoutBeforeIOSClass.height);
    });
  });

  describe('onTaskSuggestionSelected', () => {
    it('plans existing tasks for the provided planner day instead of moving them to today', async () => {
      // Set component input using fixture.componentRef.setInput for planForDay
      fixture.componentRef.setInput('planForDay', '2024-05-20');
      // Set local signal directly for isAddToBottom
      component.isAddToBottom.set(true);
      fixture.detectChanges();

      const task: TaskCopy = {
        id: 'task-1',
        title: 'Test task',
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      mockTaskService.getByIdOnce$.and.returnValue(of(task));
      const suggestion: AddTaskSuggestion = {
        title: 'Test task',
        taskId: 'task-1',
        projectId: 'project-1',
      } as AddTaskSuggestion;

      await component.onTaskSuggestionSelected(suggestion);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task,
          day: '2024-05-20',
          isAddToTop: false,
        }),
      );
      expect(mockTaskService.moveToCurrentWorkContext).not.toHaveBeenCalled();
    });
  });

  describe('addTask', () => {
    it('should not add a task when the visible input is empty', async () => {
      component.stateService.updateCleanText('Stale task');
      component.stateService.updateInputTxt('   ');

      await component.addTask();

      expect(mockTaskService.add).not.toHaveBeenCalled();
    });

    it('should keep the active tag selected for subsequent tasks in tag context', async () => {
      const tagWorkContext: WorkContext = {
        id: 'tag-1',
        title: 'Test Tag',
        type: WorkContextType.TAG,
      } as WorkContext;
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(tagWorkContext);
      mockTaskService.add.and.returnValues('task-1', 'task-2');

      fixture.detectChanges();

      component.stateService.updateInputTxt('First task');
      component.stateService.updateCleanText('First task');
      await component.addTask();

      expect(component.stateService.state().tagIds).toEqual(['tag-1']);

      component.stateService.updateInputTxt('Second task');
      component.stateService.updateCleanText('Second task');
      await component.addTask();

      const secondCall = mockTaskService.add.calls.mostRecent();
      const secondTaskData = secondCall.args[2] as Partial<TaskCopy>;
      expect(secondTaskData.tagIds).toEqual(['tag-1']);
    });

    // #5461: a repeat-preset task with no explicit date must default to the
    // logical "today" (offset-aware), not the calendar date. These assert the
    // component reads DateService.todayStr() — a regression to getDbDateStr()
    // would yield the real wall-clock date instead of the mocked '2024-05-19'.
    it('should use logical today for the dueDay of a repeat-preset task without a date', async () => {
      mockDateService.todayStr.and.returnValue('2024-05-19');
      mockTaskService.add.and.returnValue('task-1');

      component.stateService.updateInputTxt('Daily standup');
      component.stateService.updateCleanText('Daily standup');
      component.stateService.updateRepeatSetting('DAILY');

      await component.addTask();

      const taskData = mockTaskService.add.calls.mostRecent()
        .args[2] as Partial<TaskCopy>;
      expect(taskData.dueDay).toBe('2024-05-19');
    });

    it('should use logical today for the repeat-config startDate when no date is set', async () => {
      mockDateService.todayStr.and.returnValue('2024-05-19');
      mockTaskService.add.and.returnValue('task-1');
      const addRepeatCfgSpy = spyOn(
        TestBed.inject(TaskRepeatCfgService),
        'addTaskRepeatCfgToTask',
      );

      component.stateService.updateInputTxt('Daily standup');
      component.stateService.updateCleanText('Daily standup');
      component.stateService.updateRepeatSetting('DAILY');

      await component.addTask();

      expect(addRepeatCfgSpy).toHaveBeenCalled();
      const repeatCfg = addRepeatCfgSpy.calls.mostRecent().args[2];
      expect(repeatCfg.startDate).toBe('2024-05-19');
    });

    it('seeds skipOverdue ON for an inline Daily repeat (#8644)', async () => {
      mockTaskService.add.and.returnValue('task-1');
      const addRepeatCfgSpy = spyOn(
        TestBed.inject(TaskRepeatCfgService),
        'addTaskRepeatCfgToTask',
      );

      component.stateService.updateInputTxt('Daily standup');
      component.stateService.updateCleanText('Daily standup');
      component.stateService.updateRepeatSetting('DAILY');

      await component.addTask();

      expect(addRepeatCfgSpy.calls.mostRecent().args[2].skipOverdue).toBe(true);
    });

    it('keeps skipOverdue OFF for an inline Monthly repeat (#8644)', async () => {
      mockTaskService.add.and.returnValue('task-1');
      const addRepeatCfgSpy = spyOn(
        TestBed.inject(TaskRepeatCfgService),
        'addTaskRepeatCfgToTask',
      );

      component.stateService.updateInputTxt('Pay rent');
      component.stateService.updateCleanText('Pay rent');
      component.stateService.updateRepeatSetting('MONTHLY_CURRENT_DATE');

      await component.addTask();

      expect(addRepeatCfgSpy.calls.mostRecent().args[2].skipOverdue).toBe(false);
    });

    it('should pass deadlineDay when a deadline date is set without a time', async () => {
      mockTaskService.add.and.returnValue('task-1');

      component.stateService.updateInputTxt('Buy milk');
      component.stateService.updateCleanText('Buy milk');
      component.stateService.updateDeadline('2026-06-15', null);

      await component.addTask();

      const taskData = mockTaskService.add.calls.mostRecent()
        .args[2] as Partial<TaskCopy>;
      expect(taskData.deadlineDay).toBe('2026-06-15');
      expect(taskData.deadlineWithTime).toBeUndefined();
    });

    it('should pass deadlineWithTime and deadlineRemindAt when a deadline is set with a time and reminder', async () => {
      mockTaskService.add.and.returnValue('task-1');

      component.stateService.updateInputTxt('Dentist appointment');
      component.stateService.updateCleanText('Dentist appointment');
      component.stateService.updateDeadline('2026-06-15', '14:30');
      component.stateService.updateDeadlineRemindOption(TaskReminderOptionId.AtStart);

      await component.addTask();

      const taskData = mockTaskService.add.calls.mostRecent()
        .args[2] as Partial<TaskCopy>;
      const expectedTimestamp = new Date(2026, 5, 15, 14, 30, 0, 0).getTime();
      expect(taskData.deadlineWithTime).toBe(expectedTimestamp);
      expect(taskData.deadlineRemindAt).toBe(expectedTimestamp);
    });

    it('should pass the trimmed note text as notes when a note is entered', async () => {
      mockTaskService.add.and.returnValue('task-1');

      component.stateService.updateInputTxt('Buy milk');
      component.stateService.updateCleanText('Buy milk');
      component.stateService.noteTxt.set('  remember the oat milk  ');

      await component.addTask();

      const taskData = mockTaskService.add.calls.mostRecent()
        .args[2] as Partial<TaskCopy>;
      expect(taskData.notes).toBe('remember the oat milk');
    });

    it('should not set notes when the note is empty or whitespace', async () => {
      mockTaskService.add.and.returnValue('task-1');

      component.stateService.updateInputTxt('Buy milk');
      component.stateService.updateCleanText('Buy milk');
      component.stateService.noteTxt.set('   ');

      await component.addTask();

      const taskData = mockTaskService.add.calls.mostRecent()
        .args[2] as Partial<TaskCopy>;
      expect(taskData.notes).toBeUndefined();
    });
  });

  describe('onSubmitBtnClick', () => {
    it('should add the task and refocus the input for rapid entry', async () => {
      mockTaskService.add.and.returnValue('task-1');
      const focusSpy = spyOn(component, 'focusInput');
      component.stateService.updateInputTxt('Buy milk');
      component.stateService.updateCleanText('Buy milk');

      component.onSubmitBtnClick();
      // Wait for the addTask promise (and its .finally) to settle.
      await Promise.resolve();

      expect(mockTaskService.add).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('should refocus the input even when nothing is added', async () => {
      const focusSpy = spyOn(component, 'focusInput');
      component.stateService.updateInputTxt('   ');

      component.onSubmitBtnClick();
      await Promise.resolve();

      expect(mockTaskService.add).not.toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('should NOT refocus for CUSTOM repeat (it opens a dialog)', async () => {
      mockTaskService.add.and.returnValue('task-1');
      const focusSpy = spyOn(component, 'focusInput');
      component.stateService.updateInputTxt('Buy milk');
      component.stateService.updateCleanText('Buy milk');
      component.stateService.updateRepeatSetting('CUSTOM');

      component.onSubmitBtnClick();
      await Promise.resolve();

      expect(mockTaskService.add).toHaveBeenCalled();
      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('note panel', () => {
    it('toggleNote should flip the expanded state', () => {
      // focusInput re-focuses the title input, which tries to open the
      // autocomplete in the test harness — irrelevant to this assertion.
      spyOn(component, 'focusInput');
      expect(component.stateService.isNoteExpanded()).toBe(false);

      component.toggleNote();
      expect(component.stateService.isNoteExpanded()).toBe(true);

      component.toggleNote();
      expect(component.stateService.isNoteExpanded()).toBe(false);
    });

    it('Ctrl+2 on the title input toggles the note', () => {
      // _focusNote runs on expand; focusInput on collapse — both irrelevant here.
      spyOn(component, 'focusInput');
      expect(component.stateService.isNoteExpanded()).toBe(false);

      component.onInputKeydown(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }));

      expect(component.stateService.isNoteExpanded()).toBe(true);
    });

    it('toggleNote is a no-op in search mode (note field is create-mode only)', () => {
      component.isSearchMode.set(true);

      component.toggleNote();

      expect(component.stateService.isNoteExpanded()).toBe(false);
    });

    it('expandNote is a no-op in search mode (Ctrl+Enter cannot strand the flag)', () => {
      component.isSearchMode.set(true);

      component.expandNote();

      expect(component.stateService.isNoteExpanded()).toBe(false);
    });

    it('Ctrl+Enter on the title input expands the note without adding a task', () => {
      const addTaskSpy = spyOn(component, 'addTask');

      component.onInputKeydown(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }),
      );

      expect(component.stateService.isNoteExpanded()).toBe(true);
      expect(addTaskSpy).not.toHaveBeenCalled();
    });

    it('Ctrl+Enter inside the note submits the task', () => {
      const addTaskSpy = spyOn(component, 'addTask');

      component.onNoteKeydown(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }),
      );

      expect(addTaskSpy).toHaveBeenCalled();
    });

    it('Escape inside the note collapses it instead of submitting', () => {
      const addTaskSpy = spyOn(component, 'addTask');
      spyOn(component, 'focusInput');
      component.stateService.isNoteExpanded.set(true);

      component.onNoteKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(component.stateService.isNoteExpanded()).toBe(false);
      expect(addTaskSpy).not.toHaveBeenCalled();
    });

    it('typing in the note textarea writes back to noteTxt (two-way bind)', () => {
      component.stateService.isNoteExpanded.set(true);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector(
        'textarea.note-input',
      ) as HTMLTextAreaElement;
      expect(textarea).toBeTruthy();

      textarea.value = 'a multi\nline note';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component.stateService.noteTxt()).toBe('a multi\nline note');
    });
  });

  describe('defaultProject$ observable', () => {
    it('should use logical today for the default date in TODAY context', () => {
      mockDateService.todayStr.and.returnValue('2024-05-19');
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      fixture.detectChanges();

      expect(component.stateService.state().date).toBe('2024-05-19');
    });

    it('should return current project when in project work context', async () => {
      // Set project work context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockProjectWorkContext);

      const defaultProject = await component.defaultProject$.pipe(first()).toPromise();

      expect(defaultProject?.id).toBe('project-1');
      expect(defaultProject?.title).toBe('Project 1');
    });

    it('should return configured default project when in tag context and defaultProjectId is set', async () => {
      // Set tag work context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      // Set default project in tasks config
      (mockGlobalConfigService.tasks$ as BehaviorSubject<any>).next({
        defaultProjectId: 'default-project',
      });

      const defaultProject = await component.defaultProject$.pipe(first()).toPromise();

      expect(defaultProject?.id).toBe('default-project');
      expect(defaultProject?.title).toBe('Default Project');
    });

    it('should return INBOX_PROJECT when in tag context and no defaultProjectId configured', async () => {
      // Set tag work context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      // Ensure no default project is configured
      const configWithoutDefault: MiscConfig = {
        ...mockLocalizationConfig,
        ...mockMiscConfig,
        defaultProjectId: null,
      };
      (mockGlobalConfigService.misc$ as BehaviorSubject<MiscConfig>).next(
        configWithoutDefault,
      );

      const defaultProject = await component.defaultProject$.pipe(first()).toPromise();

      expect(defaultProject?.id).toBe('INBOX_PROJECT');
      expect(defaultProject?.title).toBe('Inbox');
    });

    it('should return INBOX_PROJECT when in tag context and defaultProjectId is false', async () => {
      // Set tag work context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      // Set defaultProjectId to false
      const configWithFalseDefault: MiscConfig = {
        ...mockLocalizationConfig,
        ...mockMiscConfig,
        defaultProjectId: false,
      };
      (mockGlobalConfigService.misc$ as BehaviorSubject<MiscConfig>).next(
        configWithFalseDefault,
      );

      const defaultProject = await component.defaultProject$.pipe(first()).toPromise();

      expect(defaultProject?.id).toBe('INBOX_PROJECT');
      expect(defaultProject?.title).toBe('Inbox');
    });

    it('should return INBOX_PROJECT when configured defaultProjectId does not exist in projects', async () => {
      // Set tag work context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      // Set a non-existent default project
      const configWithNonExistentDefault: MiscConfig = {
        ...mockLocalizationConfig,
        ...mockMiscConfig,
        defaultProjectId: 'non-existent-project',
      };
      (mockGlobalConfigService.misc$ as BehaviorSubject<MiscConfig>).next(
        configWithNonExistentDefault,
      );

      const defaultProject = await component.defaultProject$.pipe(first()).toPromise();

      expect(defaultProject?.id).toBe('INBOX_PROJECT');
      expect(defaultProject?.title).toBe('Inbox');
    });

    it('should prioritize project context over default project setting', async () => {
      // Set project work context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockProjectWorkContext);

      // Set a different default project in config
      const configWithDefault: MiscConfig = {
        ...mockLocalizationConfig,
        ...mockMiscConfig,
        defaultProjectId: 'default-project',
      };
      (mockGlobalConfigService.misc$ as BehaviorSubject<MiscConfig>).next(
        configWithDefault,
      );

      const defaultProject = await component.defaultProject$.pipe(first()).toPromise();

      // Should return the project from context, not the configured default
      expect(defaultProject?.id).toBe('project-1');
      expect(defaultProject?.title).toBe('Project 1');
    });

    it('should react to changes in work context', async () => {
      // Start with tag context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      // Set default project in tasks config
      (mockGlobalConfigService.tasks$ as BehaviorSubject<any>).next({
        defaultProjectId: 'default-project',
      });

      let defaultProject = await component.defaultProject$.pipe(first()).toPromise();
      expect(defaultProject?.id).toBe('default-project');

      // Switch to project context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockProjectWorkContext);

      defaultProject = await component.defaultProject$.pipe(first()).toPromise();
      expect(defaultProject?.id).toBe('project-1');
    });

    it('should react to changes in default project configuration', async () => {
      // Set tag context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      // Start with no default project
      (mockGlobalConfigService.tasks$ as BehaviorSubject<any>).next({
        defaultProjectId: null,
      });

      let defaultProject = await component.defaultProject$.pipe(first()).toPromise();
      expect(defaultProject?.id).toBe('INBOX_PROJECT');

      // Change to configured default project
      (mockGlobalConfigService.tasks$ as BehaviorSubject<any>).next({
        defaultProjectId: 'default-project',
      });

      defaultProject = await component.defaultProject$.pipe(first()).toPromise();
      expect(defaultProject?.id).toBe('default-project');
    });

    it('should handle null work context gracefully', async () => {
      // Set null work context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(null);

      // Set default project in tasks config
      (mockGlobalConfigService.tasks$ as BehaviorSubject<any>).next({
        defaultProjectId: 'default-project',
      });

      const defaultProject = await component.defaultProject$.pipe(first()).toPromise();

      expect(defaultProject?.id).toBe('default-project');
    });
  });

  describe('defaultProject$ with empty projects', () => {
    let componentEmptyProjects: AddTaskBarComponent;
    let fixtureEmptyProjects: ComponentFixture<AddTaskBarComponent>;
    let mockProjectServiceEmpty: jasmine.SpyObj<ProjectService>;

    beforeEach(async () => {
      // Reset TestBed to allow reconfiguration
      TestBed.resetTestingModule();

      // Create a separate mock for empty projects list
      mockProjectServiceEmpty = jasmine.createSpyObj(
        'ProjectService',
        [],
        createProjectSignals([]),
      );

      await TestBed.configureTestingModule({
        imports: [AddTaskBarComponent, NoopAnimationsModule, TranslateModule.forRoot()],
        providers: [
          { provide: TaskService, useValue: mockTaskService },
          { provide: WorkContextService, useValue: mockWorkContextService },
          { provide: ProjectService, useValue: mockProjectServiceEmpty },
          { provide: TagService, useValue: mockTagService },
          { provide: GlobalConfigService, useValue: mockGlobalConfigService },
          { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
          { provide: DateService, useValue: mockDateService },
          { provide: Store, useValue: mockStore },
          { provide: MatDialog, useValue: mockMatDialog },
          { provide: SnackService, useValue: mockSnackService },
          {
            provide: AddTaskBarIssueSearchService,
            useValue: mockAddTaskBarIssueSearchService,
          },
        ],
      }).compileComponents();

      // Set up translations first
      const translateService = TestBed.inject(TranslateService);
      translateService.setTranslation('en', {
        F: {
          TASK: {
            ADD_TASK_BAR: {
              PLACEHOLDER_SEARCH: 'Search tasks...',
              PLACEHOLDER_CREATE: 'Add task...',
              TOOLTIP_ADD_TASK: 'Add task',
              TOOLTIP_ADD_TO_TOP: 'Add to top',
              TOOLTIP_ADD_TO_BOTTOM: 'Add to bottom',
            },
          },
        },
      });
      translateService.use('en');

      fixtureEmptyProjects = TestBed.createComponent(AddTaskBarComponent);
      componentEmptyProjects = fixtureEmptyProjects.componentInstance;
    });

    it('should handle empty projects list gracefully', async () => {
      // Set tag context
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      const configWithDefault: MiscConfig = {
        ...mockLocalizationConfig,
        ...mockMiscConfig,
        defaultProjectId: 'default-project',
      };
      (mockGlobalConfigService.misc$ as BehaviorSubject<MiscConfig>).next(
        configWithDefault,
      );

      const defaultProject = await componentEmptyProjects.defaultProject$
        .pipe(first())
        .toPromise();

      expect(defaultProject).toBeUndefined();
    });
  });

  describe('_setProjectInitially', () => {
    it('should use projectId from additionalFields instead of defaultProject$', () => {
      // Set tag work context (would normally fall back to INBOX_PROJECT)
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      fixture.componentRef.setInput('additionalFields', { projectId: 'project-2' });
      fixture.detectChanges();

      expect(component.stateService.state().projectId).toBe('project-2');
    });

    it('should fall back to defaultProject$ when additionalFields has no projectId', () => {
      (
        mockWorkContextService.activeWorkContext$ as BehaviorSubject<WorkContext | null>
      ).next(mockTagWorkContext);

      fixture.componentRef.setInput('additionalFields', { isDone: false });
      fixture.detectChanges();

      expect(component.stateService.state().projectId).toBe('INBOX_PROJECT');
    });
  });

  describe('document click handling', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should emit done when clicking outside and no dialog is open', () => {
      const doneSpy = spyOn(component.done, 'emit');
      const event = {
        target: document.createElement('div'),
      } as unknown as MouseEvent;

      component.onDocumentClick(event);

      expect(doneSpy).toHaveBeenCalled();
    });

    it('should not emit done when schedule dialog is open', () => {
      const doneSpy = spyOn(component.done, 'emit');
      component.onScheduleDialogOpenChange(true);
      const event = {
        target: document.createElement('div'),
      } as unknown as MouseEvent;

      component.onDocumentClick(event);

      expect(doneSpy).not.toHaveBeenCalled();
    });
  });

  describe('IME handling (Integration)', () => {
    let inputEl: HTMLTextAreaElement;

    beforeEach(() => {
      component.stateService.updateInputTxt('New Task');
      fixture.detectChanges();
      inputEl = fixture.debugElement.nativeElement.querySelector('.main-input');
    });

    const dispatchEnterKeydown = (options: {
      isComposing: boolean;
      keyCode?: number;
    }): void => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: options.isComposing,
      });

      if (options.keyCode) {
        Object.defineProperty(event, 'keyCode', { value: options.keyCode });
      }

      inputEl.dispatchEvent(event);
      fixture.detectChanges();
    };

    it('should not add a task when Enter is pressed during IME composition', () => {
      dispatchEnterKeydown({ isComposing: true });
      expect(mockTaskService.add).not.toHaveBeenCalled();
    });

    it('should not add a task when Enter is pressed with keyCode 229 even if isComposing is false', () => {
      dispatchEnterKeydown({ isComposing: false, keyCode: 229 });
      expect(mockTaskService.add).not.toHaveBeenCalled();
    });

    it('should add a task when Enter is pressed and NOT in IME composition', () => {
      dispatchEnterKeydown({ isComposing: false });
      expect(mockTaskService.add).toHaveBeenCalled();
    });
  });

  describe('single-line title (auto-growing textarea)', () => {
    let inputEl: HTMLTextAreaElement;

    beforeEach(() => {
      fixture.detectChanges();
      inputEl = fixture.debugElement.nativeElement.querySelector('.main-input');
    });

    it('collapses newlines from a pasted title so it stays single-line', () => {
      inputEl.value = 'first line\nsecond\r\nthird';
      inputEl.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component.stateService.inputTxt()).toBe('first line second third');
      expect(inputEl.value).toBe('first line second third');
    });
  });
});
