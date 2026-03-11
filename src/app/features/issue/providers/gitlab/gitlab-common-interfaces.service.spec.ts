import { TestBed } from '@angular/core/testing';
import { GitlabCommonInterfacesService } from './gitlab-common-interfaces.service';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { of } from 'rxjs';
import { Task } from '../../../tasks/task.model';
import { GitlabIssue } from './gitlab-issue.model';

describe('GitlabCommonInterfacesService', () => {
  let service: GitlabCommonInterfacesService;
  let gitlabApiSpy: jasmine.SpyObj<GitlabApiService>;
  let issueProviderServiceSpy: jasmine.SpyObj<IssueProviderService>;

  beforeEach(() => {
    gitlabApiSpy = jasmine.createSpyObj('GitlabApiService', [
      'getById$',
      'searchIssueInProject$',
    ]);
    issueProviderServiceSpy = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);

    TestBed.configureTestingModule({
      providers: [
        GitlabCommonInterfacesService,
        { provide: GitlabApiService, useValue: gitlabApiSpy },
        { provide: IssueProviderService, useValue: issueProviderServiceSpy },
      ],
    });
    service = TestBed.inject(GitlabCommonInterfacesService);
  });

  const mockCfg = {
    isEnabled: true,
    project: 'test/project',
    filterUsername: '',
  };

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task-1',
      issueId: '42',
      issueProviderId: 'gitlab-1',
      issueType: 'GITLAB',
      issueLastUpdated: 1000,
      title: '#42 Original Title',
      dueDay: '2026-03-15',
      ...overrides,
    }) as Task;

  const createMockIssue = (overrides: Partial<GitlabIssue> = {}): GitlabIssue =>
    ({
      id: '42',
      number: 42,
      title: 'Original Title',
      state: 'opened',
      due_date: '2026-03-15',
      updated_at: new Date(2000).toISOString(),
      weight: 3,
      comments: [],
      ...overrides,
    }) as GitlabIssue;

  describe('getAddTaskData', () => {
    it('should include issueLastSyncedValues with dueDay', () => {
      const issue = createMockIssue({ due_date: '2026-03-20' });
      const result = service.getAddTaskData(issue);
      expect(result.issueLastSyncedValues).toEqual({ dueDay: '2026-03-20' });
    });

    it('should include issueLastSyncedValues with undefined when no due date', () => {
      const issue = createMockIssue({ due_date: '' });
      const result = service.getAddTaskData(issue);
      expect(result.issueLastSyncedValues).toEqual({ dueDay: undefined });
    });
  });

  describe('getFreshDataForIssueTask due date guard', () => {
    beforeEach(() => {
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCfg as any));
    });

    it('should NOT overwrite dueDay when provider value has not changed', async () => {
      const task = createMockTask({
        dueDay: '2026-03-11', // User changed to today
        issueLastSyncedValues: { dueDay: '2026-03-15' },
      });
      const issue = createMockIssue({ due_date: '2026-03-15' }); // Same as last synced
      gitlabApiSpy.getById$.and.returnValue(of(issue));

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.dueDay).toBeUndefined();
      expect(result!.taskChanges.issueLastSyncedValues).toEqual({
        dueDay: '2026-03-15',
      });
    });

    it('should overwrite dueDay when provider value has changed', async () => {
      const task = createMockTask({
        dueDay: '2026-03-11',
        issueLastSyncedValues: { dueDay: '2026-03-15' },
      });
      const issue = createMockIssue({ due_date: '2026-03-12' }); // Provider changed
      gitlabApiSpy.getById$.and.returnValue(of(issue));

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.dueDay).toBe('2026-03-12');
    });

    it('should overwrite dueDay on first poll when issueLastSyncedValues is missing (migration)', async () => {
      const task = createMockTask({
        dueDay: '2026-03-11',
        issueLastSyncedValues: undefined, // No previous sync data
      });
      const issue = createMockIssue({ due_date: '2026-03-15' });
      gitlabApiSpy.getById$.and.returnValue(of(issue));

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.dueDay).toBe('2026-03-15');
      // Should seed issueLastSyncedValues for future polls
      expect(result!.taskChanges.issueLastSyncedValues).toEqual({
        dueDay: '2026-03-15',
      });
    });

    it('should handle provider removing the due date', async () => {
      const task = createMockTask({
        dueDay: '2026-03-15',
        issueLastSyncedValues: { dueDay: '2026-03-15' },
      });
      const issue = createMockIssue({ due_date: '' }); // Provider removed due date
      gitlabApiSpy.getById$.and.returnValue(of(issue));

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      // Provider changed from '2026-03-15' to undefined → should update
      expect('dueDay' in result!.taskChanges).toBe(true);
      expect(result!.taskChanges.dueDay).toBeUndefined();
    });
  });
});
