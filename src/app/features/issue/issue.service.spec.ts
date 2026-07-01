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
import { GitlabCommonInterfacesService } from './providers/gitlab/gitlab-common-interfaces.service';
import { CaldavCommonInterfacesService } from './providers/caldav/caldav-common-interfaces.service';
import { OpenProjectCommonInterfacesService } from './providers/open-project/open-project-common-interfaces.service';
import { RedmineCommonInterfacesService } from './providers/redmine/redmine-common-interfaces.service';
import { CalendarCommonInterfacesService } from './providers/calendar/calendar-common-interfaces.service';
import { PluginIssueProviderAdapterService } from '../../plugins/issue-provider/plugin-issue-provider-adapter.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';

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
  let pluginAdapterSpy: jasmine.SpyObj<PluginIssueProviderAdapterService>;
  let pluginRegistrySpy: jasmine.SpyObj<PluginIssueProviderRegistryService>;

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
    issueProviderKey: 'ICAL',
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
      'addSubTaskTo',
      'restoreTask',
      'update',
      'remove',
      'removeMultipleTasks',
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
    storeSpy = jasmine.createSpyObj('Store', ['select', 'dispatch', 'pipe']);
    storeSpy.pipe.and.returnValue(of([]));
    translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);
    globalProgressBarServiceSpy = jasmine.createSpyObj('GlobalProgressBarService', [
      'countUp',
      'countDown',
    ]);
    navigateToTaskServiceSpy = jasmine.createSpyObj('NavigateToTaskService', [
      'navigate',
    ]);
    pluginAdapterSpy = jasmine.createSpyObj('PluginIssueProviderAdapterService', [
      'getAddTaskData',
      'getAddTaskDataForCfg',
    ]);
    pluginRegistrySpy = jasmine.createSpyObj('PluginIssueProviderRegistryService', [
      'hasProvider',
      'getIcon',
      'getName',
      'getIssueStrings',
      'getPollIntervalMs',
    ]);
    pluginRegistrySpy.hasProvider.and.returnValue(false);

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
        { provide: GitlabCommonInterfacesService, useValue: mockCommonInterfaceService },
        { provide: CaldavCommonInterfacesService, useValue: mockCommonInterfaceService },
        {
          provide: OpenProjectCommonInterfacesService,
          useValue: mockCommonInterfaceService,
        },
        { provide: RedmineCommonInterfacesService, useValue: mockCommonInterfaceService },
        {
          provide: CalendarCommonInterfacesService,
          useValue: mockCommonInterfaceService,
        },
        { provide: PluginIssueProviderAdapterService, useValue: pluginAdapterSpy },
        { provide: PluginIssueProviderRegistryService, useValue: pluginRegistrySpy },
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

  describe('addTaskFromIssue - getTaskDefaults', () => {
    const jiraIssue = { id: 'JIRA-1', title: 'Test Jira Issue' };

    const setupForNewTask = (): void => {
      // No existing task found
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo(null);
      taskServiceSpy.add.and.returnValue('new-task-id');

      // Mock getAddTaskData
      (service.ISSUE_SERVICE_MAP['JIRA'] as any).getAddTaskData = () => ({
        title: 'Test Jira Issue',
      });
    };

    it('should filter out TODAY_TAG.id from defaultTagIds', async () => {
      setupForNewTask();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({
          defaultProjectId: 'proj-1',
          defaultTagIds: ['tag-1', TODAY_TAG.id, 'tag-2'],
        } as any),
      );
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.PROJECT,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'proj-1',
      });

      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
      });

      const addCall = taskServiceSpy.add.calls.mostRecent();
      const taskData = addCall.args[2] as Partial<Task>;
      expect(taskData.tagIds).toEqual(['tag-1', 'tag-2']);
    });

    it('should merge provider tagIds with default tags', async () => {
      setupForNewTask();
      (service.ISSUE_SERVICE_MAP['JIRA'] as any).getAddTaskData = () => ({
        title: 'Test Jira Issue',
        tagIds: ['remote-tag'],
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({
          defaultProjectId: 'proj-1',
          defaultTagIds: ['default-tag'],
        } as any),
      );
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.PROJECT,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'proj-1',
      });

      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
      });

      const addCall = taskServiceSpy.add.calls.mostRecent();
      const taskData = addCall.args[2] as Partial<Task>;
      expect(taskData.tagIds).toEqual(['default-tag', 'remote-tag']);
    });

    it('should use plugin add task data with cfg so mapped tags are imported', async () => {
      const pluginIssue = {
        id: 'PLUGIN-1',
        title: 'Plugin Issue',
        labels: ['bug'],
      };
      pluginRegistrySpy.hasProvider.and.callFake((key) => key === 'plugin:test');
      pluginAdapterSpy.getAddTaskDataForCfg.and.returnValue({
        title: 'Plugin Issue',
        tagIds: ['remote-tag'],
        issueLastSyncedValues: { labels: ['bug'] },
      });
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo(null);
      taskServiceSpy.add.and.returnValue('new-task-id');
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({
          id: 'plugin-provider-1',
          issueProviderKey: 'plugin:test',
          defaultProjectId: 'proj-1',
          defaultTagIds: ['default-tag'],
          pluginConfig: { twoWaySync: { tagIds: 'both' } },
        } as any),
      );
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.PROJECT,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'proj-1',
      });

      await service.addTaskFromIssue({
        issueDataReduced: pluginIssue as any,
        issueProviderId: 'plugin-provider-1',
        issueProviderKey: 'plugin:test' as any,
      });

      expect(pluginAdapterSpy.getAddTaskDataForCfg).toHaveBeenCalledWith(
        pluginIssue as any,
        jasmine.objectContaining({ issueProviderKey: 'plugin:test' }),
      );
      const addCall = taskServiceSpy.add.calls.mostRecent();
      const taskData = addCall.args[2] as Partial<Task>;
      expect(taskData.tagIds).toEqual(['default-tag', 'remote-tag']);
      expect(taskData.issueLastSyncedValues).toEqual({ labels: ['bug'] });
    });

    it('should set defaultNote when provider adapter does not set notes', async () => {
      setupForNewTask();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({
          defaultProjectId: 'proj-1',
          defaultTagIds: [],
          defaultNote: 'Default note text',
        } as any),
      );
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.PROJECT,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'proj-1',
      });

      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
      });

      const addCall = taskServiceSpy.add.calls.mostRecent();
      const taskData = addCall.args[2] as Partial<Task>;
      expect(taskData.notes).toBe('Default note text');
    });

    it('should NOT override notes when provider adapter already sets notes', async () => {
      setupForNewTask();
      (service.ISSUE_SERVICE_MAP['JIRA'] as any).getAddTaskData = () => ({
        title: 'Test Jira Issue',
        notes: 'Provider-set notes',
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({
          defaultProjectId: 'proj-1',
          defaultTagIds: [],
          defaultNote: 'Default note text',
        } as any),
      );
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.PROJECT,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'proj-1',
      });

      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
      });

      const addCall = taskServiceSpy.add.calls.mostRecent();
      const taskData = addCall.args[2] as Partial<Task>;
      expect(taskData.notes).toBe('Provider-set notes');
    });
  });

  describe('addTaskFromIssue - auto-import tag inheritance (#8673)', () => {
    const jiraIssue = { id: 'JIRA-8673', title: 'Auto Import' };

    const setActiveTag = (tagId: string): void => {
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.TAG,
        configurable: true,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => tagId,
        configurable: true,
      });
    };

    beforeEach(() => {
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo(null);
      taskServiceSpy.add.and.returnValue('new-task-id');
      (service.ISSUE_SERVICE_MAP['JIRA'] as any).getAddTaskData = () => ({
        title: 'Auto Import',
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({
          defaultProjectId: 'proj-1',
          defaultTagIds: ['default-tag'],
        } as any),
      );
      // Auto-imports always target the backlog; the leak only surfaces via the
      // non-PROJECT branch, i.e. while a non-Today tag is the active context.
      setActiveTag('errands-tag');
    });

    it('inherits the ambient tag for a foreground import (isAutoImport unset)', async () => {
      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
        isAddToBacklog: true,
      });

      const taskData = taskServiceSpy.add.calls.mostRecent().args[2] as Partial<Task>;
      expect(taskData.tagIds).toEqual(['errands-tag', 'default-tag']);
      expect(taskData.projectId).toBe('proj-1');
    });

    it('does NOT inherit the ambient tag for an automatic import', async () => {
      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
        isAddToBacklog: true,
        isAutoImport: true,
      });

      const taskData = taskServiceSpy.add.calls.mostRecent().args[2] as Partial<Task>;
      expect(taskData.tagIds).toEqual(['default-tag']);
      expect(taskData.projectId).toBe('proj-1');
    });
  });

  describe('addTaskFromIssue - CalDAV sub-task / archived-parent path', () => {
    const caldavIssue = {
      id: 'child-uid',
      title: 'Child Task',
      related_to: 'parent-uid',
    };
    let caldavServiceMock: jasmine.SpyObj<CaldavCommonInterfacesService>;

    beforeEach(() => {
      caldavServiceMock = service.ISSUE_SERVICE_MAP[
        'CALDAV'
      ] as jasmine.SpyObj<CaldavCommonInterfacesService>;
      (caldavServiceMock as any).getAddTaskData = () => ({
        title: 'Child Task',
        related_to: 'parent-uid',
      });
      (caldavServiceMock as any).getSubTasks = jasmine
        .createSpy('getSubTasks')
        .and.resolveTo([]);
      taskServiceSpy.add.and.returnValue('new-task-id');
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({ defaultProjectId: 'proj-1', defaultTagIds: [] } as any),
      );
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.PROJECT,
        configurable: true,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'proj-1',
        configurable: true,
      });
    });

    it('should add child as a top-level task when parent is archived', async () => {
      // child-uid: not in SP → returns null (so it gets added fresh)
      // parent-uid: in archive → _tryAddSubTask returns undefined → fallback to top-level
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.callFake(async (id: string) => {
        if (id === 'parent-uid') {
          return {
            task: { id: 'parent-task-id', parentId: null } as any,
            subTasks: null,
            isFromArchive: true,
          };
        }
        return null;
      });

      await service.addTaskFromIssue({
        issueDataReduced: caldavIssue as any,
        issueProviderId: 'caldav-provider-1',
        issueProviderKey: 'CALDAV',
      });

      expect(taskServiceSpy.add).toHaveBeenCalled();
      expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    });

    it('should add child as top-level task when parent is not in SP yet', async () => {
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo(null);

      await service.addTaskFromIssue({
        issueDataReduced: caldavIssue as any,
        issueProviderId: 'caldav-provider-1',
        issueProviderKey: 'CALDAV',
      });

      expect(taskServiceSpy.add).toHaveBeenCalled();
      expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    });

    it('should call addSubTaskTo once per child even when provider returns duplicates', async () => {
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo(null);
      taskServiceSpy.add.and.returnValue('parent-task-id');
      taskServiceSpy.addSubTaskTo.and.returnValue('sub-id');

      // Provider returns the same child twice (malformed data).
      // _addSubTasks iterates the list verbatim, so addSubTaskTo fires once per entry.
      // The duplicate-prevention guard is at the addTaskFromIssue level (checkForTaskWithIssueEverywhere),
      // not inside _addSubTasks — this test documents the current expected call count.
      const duplicate = { id: 'child-uid', title: 'Child Task' };
      (caldavServiceMock as any).getSubTasks = jasmine
        .createSpy('getSubTasks')
        .and.resolveTo([duplicate, duplicate]);

      await service.addTaskFromIssue({
        issueDataReduced: { id: 'parent-uid', title: 'Parent Task' } as any,
        issueProviderId: 'caldav-provider-1',
        issueProviderKey: 'CALDAV',
      });

      expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledTimes(2);
    });
  });

  describe('addTaskFromIssue - isAddToBacklog skips default dueDay', () => {
    const jiraIssue = { id: 'JIRA-1', title: 'Test Jira Issue' };

    const setupForNewTask = (): void => {
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo(null);
      taskServiceSpy.add.and.returnValue('new-task-id');
      (service.ISSUE_SERVICE_MAP['JIRA'] as any).getAddTaskData = () => ({
        title: 'Test Jira Issue',
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of({ defaultProjectId: 'proj-1', defaultTagIds: [] } as any),
      );
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextType', {
        get: () => WorkContextType.PROJECT,
      });
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'proj-1',
      });
    };

    it('should NOT set dueDay when isAddToBacklog=true', async () => {
      setupForNewTask();

      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
        isAddToBacklog: true,
      });

      const addCall = taskServiceSpy.add.calls.mostRecent();
      const taskData = addCall.args[2] as Partial<Task>;
      expect(taskData.dueDay).toBeUndefined();
    });

    it('should set dueDay to today when isAddToBacklog is not set', async () => {
      setupForNewTask();

      await service.addTaskFromIssue({
        issueDataReduced: jiraIssue as any,
        issueProviderId: 'jira-provider-1',
        issueProviderKey: 'JIRA',
      });

      const addCall = taskServiceSpy.add.calls.mostRecent();
      const taskData = addCall.args[2] as Partial<Task>;
      expect(taskData.dueDay).toBeDefined();
    });
  });

  describe('addTaskFromIssue - existing task already in project backlog', () => {
    const githubIssue = { id: 'github-issue-123', title: 'GitHub Issue' };

    beforeEach(() => {
      Object.defineProperty(workContextServiceSpy, 'activeWorkContextId', {
        get: () => 'project-1',
      });
    });

    it('should NOT move backlog task to Today list on re-import', async () => {
      const existingTask = createMockTask({
        issueType: 'GITHUB',
        projectId: 'project-1',
      });
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });
      projectServiceSpy.getByIdOnce$.and.returnValue(
        of({ backlogTaskIds: [existingTask.id] } as any),
      );

      await service.addTaskFromIssue({
        issueDataReduced: githubIssue as any,
        issueProviderId: 'github-provider-1',
        issueProviderKey: 'GITHUB',
      });

      expect(projectServiceSpy.moveTaskToTodayList).not.toHaveBeenCalled();
    });

    it('should show "already exists" snack with Go to Task action for backlog tasks', async () => {
      const existingTask = createMockTask({
        issueType: 'GITHUB',
        projectId: 'project-1',
      });
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });
      projectServiceSpy.getByIdOnce$.and.returnValue(
        of({ backlogTaskIds: [existingTask.id] } as any),
      );

      await service.addTaskFromIssue({
        issueDataReduced: githubIssue as any,
        issueProviderId: 'github-provider-1',
        issueProviderKey: 'GITHUB',
      });

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.TASK.S.TASK_ALREADY_EXISTS,
          actionStr: T.F.TASK.S.GO_TO_TASK,
          actionFn: jasmine.any(Function),
        }),
      );
    });

    it('should still move task from Today-side to context when not in backlog', async () => {
      const existingTask = createMockTask({
        issueType: 'GITHUB',
        projectId: 'project-1',
      });
      taskServiceSpy.checkForTaskWithIssueEverywhere.and.resolveTo({
        task: existingTask,
        subTasks: null,
        isFromArchive: false,
      });
      projectServiceSpy.getByIdOnce$.and.returnValue(of({ backlogTaskIds: [] } as any));

      await service.addTaskFromIssue({
        issueDataReduced: githubIssue as any,
        issueProviderId: 'github-provider-1',
        issueProviderKey: 'GITHUB',
      });

      expect(projectServiceSpy.moveTaskToTodayList).toHaveBeenCalledWith(
        existingTask.id,
        'project-1',
      );
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.TASK.S.FOUND_MOVE_FROM_BACKLOG,
        }),
      );
    });
  });

  describe('refreshIssueTasks - orphaned task auto-removal', () => {
    const provider = { id: 'p1', issueProviderKey: 'PLAINSPACE' } as any;

    const mkTask = (overrides: Partial<Task> = {}): Task =>
      ({
        id: `task-${overrides.issueId ?? 'x'}`,
        title: 'Imported',
        issueId: 'i1',
        issueType: 'PLAINSPACE',
        issueProviderId: 'p1',
        timeSpent: 0,
        timeSpentOnDay: {},
        subTaskIds: [],
        attachments: [],
        tagIds: [],
        projectId: 'project-1',
        ...overrides,
      }) as Task;

    let plainspaceMock: any;

    beforeEach(() => {
      plainspaceMock = service.ISSUE_SERVICE_MAP['PLAINSPACE'];
      plainspaceMock.getFreshDataForIssueTasks = jasmine
        .createSpy('getFreshDataForIssueTasks')
        .and.resolveTo([]);
    });

    it('removes a deleted task that has no local content', async () => {
      const gone = mkTask({ issueId: 'gone', id: 'task-gone' });
      plainspaceMock.getRemovedRemoteTasks = jasmine
        .createSpy('getRemovedRemoteTasks')
        .and.resolveTo([gone]);

      await service.refreshIssueTasks([gone], provider);

      expect(taskServiceSpy.remove).toHaveBeenCalledTimes(1);
      const removed = taskServiceSpy.remove.calls.mostRecent().args[0];
      expect(removed.id).toBe('task-gone');
      expect(removed.subTasks).toEqual([]);
    });

    it('keeps a deleted task that has tracked time', async () => {
      const tracked = mkTask({
        issueId: 'tracked',
        id: 'task-tracked',
        timeSpent: 60000,
      });
      plainspaceMock.getRemovedRemoteTasks = jasmine
        .createSpy('getRemovedRemoteTasks')
        .and.resolveTo([tracked]);

      await service.refreshIssueTasks([tracked], provider);

      expect(taskServiceSpy.remove).not.toHaveBeenCalled();
    });

    (
      [
        ['notes', { notes: 'a thought' }],
        ['sub-tasks', { subTaskIds: ['sub-1'] }],
        ['attachments', { attachments: [{ id: 'a' } as any] }],
        ['a repeat config', { repeatCfgId: 'repeat-1' }],
        ['a done state', { isDone: true }],
      ] as [string, Partial<Task>][]
    ).forEach(([label, extra]) => {
      it(`keeps a deleted task that has local ${label}`, async () => {
        const task = mkTask({ issueId: 'kept', id: 'task-kept', ...extra });
        plainspaceMock.getRemovedRemoteTasks = jasmine
          .createSpy('getRemovedRemoteTasks')
          .and.resolveTo([task]);

        await service.refreshIssueTasks([task], provider);

        expect(taskServiceSpy.remove).not.toHaveBeenCalled();
      });
    });

    it('does not remove anything when the provider reports no deletions', async () => {
      const alive = mkTask({ issueId: 'alive', id: 'task-alive' });
      plainspaceMock.getRemovedRemoteTasks = jasmine
        .createSpy('getRemovedRemoteTasks')
        .and.resolveTo([]);

      await service.refreshIssueTasks([alive], provider);

      expect(taskServiceSpy.remove).not.toHaveBeenCalled();
    });

    it('does not throw if detection fails (poll stays alive)', async () => {
      const gone = mkTask({ issueId: 'gone', id: 'task-gone' });
      plainspaceMock.getRemovedRemoteTasks = jasmine
        .createSpy('getRemovedRemoteTasks')
        .and.rejectWith(new Error('network down'));

      await expectAsync(service.refreshIssueTasks([gone], provider)).toBeResolved();
      expect(taskServiceSpy.remove).not.toHaveBeenCalled();
    });

    it('removes several orphans in ONE bulk op (not N deleteTask dispatches)', async () => {
      const a = mkTask({ issueId: 'a', id: 'task-a' });
      const b = mkTask({ issueId: 'b', id: 'task-b' });
      plainspaceMock.getRemovedRemoteTasks = jasmine
        .createSpy('getRemovedRemoteTasks')
        .and.resolveTo([a, b]);

      await service.refreshIssueTasks([a, b], provider);

      expect(taskServiceSpy.remove).not.toHaveBeenCalled();
      expect(taskServiceSpy.removeMultipleTasks).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.removeMultipleTasks).toHaveBeenCalledWith([
        'task-a',
        'task-b',
      ]);
    });
  });
});
