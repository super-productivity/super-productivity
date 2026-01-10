import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { IssueService } from './issue.service';
import { TaskService } from '../tasks/task.service';
import { SnackService } from '../../core/snack/snack.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { IssueProviderService } from './issue-provider.service';
import { ProjectService } from '../project/project.service';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { GlobalProgressBarService } from '../../core-ui/global-progress-bar/global-progress-bar.service';
import { NavigateToTaskService } from '../../core-ui/navigate-to-task/navigate-to-task.service';
import { Task, TaskWithSubTasks } from '../tasks/task.model';
import { of } from 'rxjs';
import { T } from '../../t.const';
import { TODAY_TAG } from '../tag/tag.const';
import { ICalIssueReduced } from './providers/calendar/calendar.model';
import { SnackParams } from '../../core/snack/snack.model';
import { JiraCommonInterfacesService } from './providers/jira/jira-common-interfaces.service';
import { GithubCommonInterfacesService } from './providers/github/github-common-interfaces.service';
import { TrelloCommonInterfacesService } from './providers/trello/trello-common-interfaces.service';
import { GitlabCommonInterfacesService } from './providers/gitlab/gitlab-common-interfaces.service';
import { CaldavCommonInterfacesService } from './providers/caldav/caldav-common-interfaces.service';
import { OpenProjectCommonInterfacesService } from './providers/open-project/open-project-common-interfaces.service';
import { GiteaCommonInterfacesService } from './providers/gitea/gitea-common-interfaces.service';
import { RedmineCommonInterfacesService } from './providers/redmine/redmine-common-interfaces.service';
import { LinearCommonInterfacesService } from './providers/linear/linear-common-interfaces.service';
import { ClickUpCommonInterfacesService } from './providers/clickup/clickup-common-interfaces.service';
import { CalendarCommonInterfacesService } from './providers/calendar/calendar-common-interfaces.service';

describe('IssueService', () => {
  let service: IssueService;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let workContextServiceSpy: jasmine.SpyObj<WorkContextService>;
  let issueProviderServiceSpy: jasmine.SpyObj<IssueProviderService>;
  let projectServiceSpy: jasmine.SpyObj<ProjectService>;
  let calendarIntegrationServiceSpy: jasmine.SpyObj<CalendarIntegrationService>;
  let storeSpy: jasmine.SpyObj<Store>;
  let translateServiceSpy: jasmine.SpyObj<TranslateService>;
  let globalProgressBarServiceSpy: jasmine.SpyObj<GlobalProgressBarService>;
  let navigateToTaskServiceSpy: jasmine.SpyObj<NavigateToTaskService>;

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'existing-task-123',
      title: 'Existing Calendar Event Task',
      issueId: 'cal-event-456',
      issueProviderId: 'calendar-provider-1',
      issueType: 'ICAL',
      dueWithTime: new Date('2025-01-20T14:00:00Z').getTime(),
      projectId: 'project-1',
      tagIds: [],
      ...overrides,
    }) as Task;

  const createMockCalendarEvent = (
    overrides: Partial<ICalIssueReduced> = {},
  ): ICalIssueReduced => ({
    id: 'cal-event-456',
    calProviderId: 'calendar-provider-1',
    title: 'Calendar Event',
    start: new Date('2025-01-20T14:00:00Z').getTime(),
    duration: 3600000,
    ...overrides,
  });

  beforeEach(() => {
    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'checkForTaskWithIssueEverywhere',
      'getByIdWithSubTaskData$',
      'moveToCurrentWorkContext',
      'add',
      'addAndSchedule',
      'restoreTask',
    ]);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContextId: TODAY_TAG.id,
      activeWorkContextType: WorkContextType.TAG,
    });
    issueProviderServiceSpy = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);
    projectServiceSpy = jasmine.createSpyObj('ProjectService', [
      'getByIdOnce$',
      'moveTaskToTodayList',
    ]);
    calendarIntegrationServiceSpy = jasmine.createSpyObj('CalendarIntegrationService', [
      'skipCalendarEvent',
    ]);
    storeSpy = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);
    globalProgressBarServiceSpy = jasmine.createSpyObj('GlobalProgressBarService', [
      'countUp',
      'countDown',
    ]);
    navigateToTaskServiceSpy = jasmine.createSpyObj('NavigateToTaskService', [
      'navigate',
    ]);

    // Default mock return values - use 'as any' to bypass strict type checking
    issueProviderServiceSpy.getCfgOnce$.and.returnValue(
      of({ defaultProjectId: 'project-1' } as any),
    );

    // Default mock for getByIdWithSubTaskData$ - needed when task already exists
    taskServiceSpy.getByIdWithSubTaskData$.and.returnValue(
      of({
        id: 'existing-task-123',
        title: 'Existing Task',
        subTasks: [],
      } as any),
    );

    // Default mock for projectService
    projectServiceSpy.getByIdOnce$.and.returnValue(of({ title: 'Project 1' } as any));

    // Create mock providers for all common interface services
    const mockCommonInterfaceService = jasmine.createSpyObj('CommonInterfaceService', [
      'isEnabled',
      'getAddTaskData',
    ]);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        IssueService,
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        { provide: IssueProviderService, useValue: issueProviderServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: CalendarIntegrationService, useValue: calendarIntegrationServiceSpy },
        { provide: Store, useValue: storeSpy },
        { provide: TranslateService, useValue: translateServiceSpy },
        { provide: GlobalProgressBarService, useValue: globalProgressBarServiceSpy },
        { provide: NavigateToTaskService, useValue: navigateToTaskServiceSpy },
        { provide: JiraCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: GithubCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: TrelloCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: GitlabCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: CaldavCommonInterfacesService, useValue: mockCommonInterfaceService },
        {
          provide: OpenProjectCommonInterfacesService,
          useValue: mockCommonInterfaceService,
        },
        { provide: GiteaCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: RedmineCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: LinearCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: ClickUpCommonInterfacesService, useValue: mockCommonInterfaceService },
        {
          provide: CalendarCommonInterfacesService,
          useValue: mockCommonInterfaceService,
        },
      ],
    });
    service = TestBed.inject(IssueService);
  });

  describe('addTaskFromIssue - ICAL task already exists', () => {
    it('should NOT move existing ICAL task to current context when task already exists', async () => {
      const existingTask = createMockTask();
      const calendarEvent = createMockCalendarEvent();

      // Task already exists - checkForTaskWithIssueEverywhere returns the task
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });

      await service.addTaskFromIssue({
        issueDataReduced: calendarEvent,
        issueProviderId: 'calendar-provider-1',
        issueProviderKey: 'ICAL',
      });

      // Should NOT call moveToCurrentWorkContext - this is the key assertion
      expect(taskServiceSpy.moveToCurrentWorkContext).not.toHaveBeenCalled();
    });

    it('should show snackbar with Go to Task action when ICAL task already exists', async () => {
      const existingTask = createMockTask();
      const calendarEvent = createMockCalendarEvent();

      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });

      await service.addTaskFromIssue({
        issueDataReduced: calendarEvent,
        issueProviderId: 'calendar-provider-1',
        issueProviderKey: 'ICAL',
      });

      // Should show snackbar with task title and Go to Task action
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.TASK.S.TASK_ALREADY_EXISTS,
          actionStr: T.F.TASK.S.GO_TO_TASK,
          actionFn: jasmine.any(Function),
        }),
      );
    });

    it('should navigate to task when Go to Task action is clicked', async () => {
      const existingTask = createMockTask();
      const calendarEvent = createMockCalendarEvent();

      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });

      await service.addTaskFromIssue({
        issueDataReduced: calendarEvent,
        issueProviderId: 'calendar-provider-1',
        issueProviderKey: 'ICAL',
      });

      // Get the actionFn from the snackbar call and execute it
      const snackCall = snackServiceSpy.open.calls.mostRecent();
      const snackParams = snackCall.args[0] as SnackParams;
      const actionFn = snackParams.actionFn;
      actionFn!();

      expect(navigateToTaskServiceSpy.navigate).toHaveBeenCalledWith(
        existingTask.id,
        false,
      );
    });

    it('should preserve original dueWithTime when ICAL task already exists', async () => {
      const originalDueWithTime = new Date('2025-01-25T10:00:00Z').getTime();
      const existingTask = createMockTask({ dueWithTime: originalDueWithTime });
      const calendarEvent = createMockCalendarEvent();

      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });

      await service.addTaskFromIssue({
        issueDataReduced: calendarEvent,
        issueProviderId: 'calendar-provider-1',
        issueProviderKey: 'ICAL',
      });

      // Should not modify the task at all - no moveToCurrentWorkContext
      expect(taskServiceSpy.moveToCurrentWorkContext).not.toHaveBeenCalled();
    });

    it('should return undefined when ICAL task already exists', async () => {
      const existingTask = createMockTask();
      const calendarEvent = createMockCalendarEvent();

      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });

      const result = await service.addTaskFromIssue({
        issueDataReduced: calendarEvent,
        issueProviderId: 'calendar-provider-1',
        issueProviderKey: 'ICAL',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('addTaskFromIssue - non-ICAL issue types (unchanged behavior)', () => {
    it('should still move non-ICAL tasks to current context when found', async () => {
      const existingTask = createMockTask({ issueType: 'GITHUB' });
      const githubIssue = {
        id: 'github-issue-123',
        title: 'GitHub Issue',
      };

      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });
      taskServiceSpy.getByIdWithSubTaskData$.and.returnValue(
        of(existingTask as TaskWithSubTasks),
      );

      await service.addTaskFromIssue({
        issueDataReduced: githubIssue as any,
        issueProviderId: 'github-provider-1',
        issueProviderKey: 'GITHUB',
      });

      // For non-ICAL types, should still call moveToCurrentWorkContext
      expect(taskServiceSpy.moveToCurrentWorkContext).toHaveBeenCalled();
    });
  });
});
