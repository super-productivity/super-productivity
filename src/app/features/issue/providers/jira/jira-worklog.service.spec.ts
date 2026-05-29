import { TestBed } from '@angular/core/testing';
import { JiraWorklogService } from './jira-worklog.service';
import { JiraApiService } from './jira-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../../tasks/task.service';
import { GITHUB_TYPE, JIRA_TYPE } from '../../issue.const';
import { Task } from '../../../tasks/task.model';
import { of } from 'rxjs';
import { DEFAULT_TASK } from '../../../tasks/task.model';

describe('JiraWorklogService', () => {
  let service: JiraWorklogService;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let mockJiraApiService: jasmine.SpyObj<JiraApiService>;
  let mockIssueProviderService: jasmine.SpyObj<IssueProviderService>;
  let mockTaskService: jasmine.SpyObj<TaskService>;

  const mockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task1',
      issueType: JIRA_TYPE,
      issueId: 'PROJ-123',
      issueProviderId: 'provider1',
      timeSpent: 3600000,
      issueTimeLogged: 0,
      ...overrides,
    }) as Task;

  beforeEach(() => {
    mockJiraApiService = jasmine.createSpyObj('JiraApiService', [
      'getReducedIssueById$',
      'addWorklog$',
    ]);
    mockIssueProviderService = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockTaskService = jasmine.createSpyObj('TaskService', ['update']);

    mockIssueProviderService.getCfgOnce$.and.returnValue(of({ id: 'prov1' } as any));
    mockJiraApiService.getReducedIssueById$.and.returnValue(
      of({ id: 'ISS-1', key: 'PROJ-1', summary: 'Test issue' } as any),
    );
    matDialog.open.and.returnValue({ afterClosed: () => of(null) } as any);

    TestBed.configureTestingModule({
      providers: [
        JiraWorklogService,
        { provide: JiraApiService, useValue: mockJiraApiService },
        { provide: IssueProviderService, useValue: mockIssueProviderService },
        { provide: MatDialog, useValue: matDialog },
        { provide: TaskService, useValue: mockTaskService },
      ],
    });
    service = TestBed.inject(JiraWorklogService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return early if task has no issueId', () => {
    service.openWorklogDialogForTask(mockTask({ issueId: undefined }));
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('should return early if task has no issueProviderId', () => {
    service.openWorklogDialogForTask(mockTask({ issueProviderId: undefined }));
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('should return early if task is not JIRA type', () => {
    service.openWorklogDialogForTask(mockTask({ issueType: GITHUB_TYPE }));
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  describe('openWorklogDialogForTask — success path', () => {
    it('should call TaskService.update with incremented issueTimeLogged after successful worklog', async () => {
      const task = mockTask({ issueTimeLogged: 1800000 }); // 30 min already logged
      const addedMs = 3600000; // logging 1 hour more

      mockJiraApiService.addWorklog$.and.returnValue(of({}));
      matDialog.open.and.callFake((_comp: unknown, config: any) => {
        config.data
          .onSubmit({
            timeSpent: addedMs,
            started: '2026-05-28T10:00:00.000Z',
            comment: '',
          })
          .subscribe();
        return { afterClosed: () => of(null) } as any;
      });

      service.openWorklogDialogForTask(task);
      await new Promise((r) => setTimeout(r, 50)); // flush dynamic import + async chain

      expect(mockTaskService.update).toHaveBeenCalledWith('task1', {
        issueTimeLogged: 1800000 + 3600000,
      });
    });
  });

  describe('openWorklogDialogForExternalTask', () => {
    it('should call getCfgOnce$ with the given issueProviderId', () => {
      const task = {
        ...DEFAULT_TASK,
        id: 't1',
        timeSpent: 3600000,
        projectId: 'proj1',
      } as Task;
      service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');
      expect(mockIssueProviderService.getCfgOnce$).toHaveBeenCalledWith('prov1', 'JIRA');
    });

    it('should call getReducedIssueById$ with the given issueId', () => {
      const task = {
        ...DEFAULT_TASK,
        id: 't1',
        timeSpent: 3600000,
        projectId: 'proj1',
      } as Task;
      service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');
      expect(mockJiraApiService.getReducedIssueById$).toHaveBeenCalledWith(
        'ISS-1',
        jasmine.any(Object),
      );
    });

    it('should open the worklog dialog', async () => {
      const task = {
        ...DEFAULT_TASK,
        id: 't1',
        timeSpent: 3600000,
        projectId: 'proj1',
      } as Task;
      service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');
      // Dynamic import is async — flush microtasks/macrotasks
      await new Promise((r) => setTimeout(r, 50));
      expect(matDialog.open).toHaveBeenCalled();
    });

    it('should NOT call TaskService.update (no issueTimeLogged tracking)', async () => {
      const task = {
        ...DEFAULT_TASK,
        id: 't1',
        timeSpent: 3600000,
        projectId: 'proj1',
      } as Task;
      mockJiraApiService.addWorklog$.and.returnValue(of({}));
      // Simulate onSubmit firing
      matDialog.open.and.callFake((_comp: any, config: any) => {
        config.data
          .onSubmit({ timeSpent: 3600000, started: '', comment: '' })
          .subscribe();
        return { afterClosed: () => of(null) } as any;
      });

      service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');
      await new Promise((r) => setTimeout(r, 0));
      expect(mockTaskService.update).not.toHaveBeenCalled();
    });
  });
});
