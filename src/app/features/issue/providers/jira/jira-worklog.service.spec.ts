import { TestBed } from '@angular/core/testing';
import { JiraWorklogService } from './jira-worklog.service';
import { JiraApiService } from './jira-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../../tasks/task.service';
import { JIRA_TYPE } from '../../issue.const';
import { Task } from '../../../tasks/task.model';

describe('JiraWorklogService', () => {
  let service: JiraWorklogService;
  let matDialog: jasmine.SpyObj<MatDialog>;

  const mockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task1',
      issueType: JIRA_TYPE,
      issueId: 'PROJ-123',
      issueProviderId: 'provider1',
      timeSpent: 3600000,
      timeLoggedToJira: 0,
      ...overrides,
    }) as Task;

  beforeEach(() => {
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      providers: [
        JiraWorklogService,
        {
          provide: JiraApiService,
          useValue: jasmine.createSpyObj('JiraApiService', [
            'getReducedIssueById$',
            'addWorklog$',
          ]),
        },
        {
          provide: IssueProviderService,
          useValue: jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']),
        },
        { provide: MatDialog, useValue: matDialog },
        {
          provide: TaskService,
          useValue: jasmine.createSpyObj('TaskService', ['update']),
        },
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
    service.openWorklogDialogForTask(mockTask({ issueType: 'GITHUB' as any }));
    expect(matDialog.open).not.toHaveBeenCalled();
  });
});
