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
import { TaskCopy } from '../task.model';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { DEFAULT_LOCALE } from 'src/app/core/locale.constants';

type ProjectServiceSignals = {
  list$: Observable<Project[]>;
  listSorted$: Observable<Project[]>;
  listSortedForUI$: Observable<Project[]>;
  listSortedForUI: Signal<Project[]>;
  listSorted: Signal<Project[]>;
};

type TagServiceSignals = {
  tags$: Observable<any[]>;
  tagsNoMyDayAndNoList$: Observable<any[]>;
  tagsNoMyDayAndNoListSorted$: Observable<any[]>;
  tagsSortedForUI$: Observable<any[]>;
  tagsSorted$: Observable<any[]>;
  tagsNoMyDayAndNoListSorted: Signal<any[]>;
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
      listSortedForUI: signal(projects),
      listSorted: signal(projects),
    };
  };

  const createTagSignals = (tags: any[]): TagServiceSignals => {
    const tags$ = of(tags);
    return {
      tags$,
      tagsNoMyDayAndNoList$: tags$,
      tagsNoMyDayAndNoListSorted$: tags$,
      tagsSortedForUI$: tags$,
      tagsSorted$: tags$,
      tagsNoMyDayAndNoListSorted: signal(tags),
      tagsSorted: signal(tags),
      tagsSortedForUI: signal(tags),
    };
  };

  const mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', ['-']);

  beforeEach(async () => {
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
      lang$: new BehaviorSubject<LocalizationConfig>(mockLocalizationConfig),
      misc$: new BehaviorSubject<MiscConfig>(mockMiscConfig),
      tasks$: new BehaviorSubject({ defaultProjectId: null }),
      shortSyntax$: of({}),
      localization: () => ({ timeLocale: DEFAULT_LOCALE }),
    });
    mockStore = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockAddTaskBarIssueSearchService = jasmine.createSpyObj(
      'AddTaskBarIssueSearchService',
      ['getFilteredIssueSuggestions$', 'addTaskFromExistingTaskOrIssue'],
    );
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

  describe('defaultProject$ observable', () => {
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
});
