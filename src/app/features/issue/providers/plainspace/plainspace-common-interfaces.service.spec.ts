import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PlainspaceCommonInterfacesService } from './plainspace-common-interfaces.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceIssue } from './plainspace-issue.model';
import { IssueProviderService } from '../../issue-provider.service';
import { Task } from '../../../tasks/task.model';

describe('PlainspaceCommonInterfacesService', () => {
  let service: PlainspaceCommonInterfacesService;
  let api: PlainspaceApiService;

  const issue = (scheduledAt: string | null, isDone = false): PlainspaceIssue => ({
    id: 't1',
    title: 'Buy milk',
    isDone,
    updatedAt: '2026-01-02T00:00:00.000Z',
    url: 'https://plainspace.org/p/item/t1',
    projectId: 'space-1',
    scheduledAt,
    isRecurring: false,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PlainspaceCommonInterfacesService,
        // extractSyncValues is pure, so the API stub is never called here.
        { provide: PlainspaceApiService, useValue: {} },
        { provide: IssueProviderService, useValue: {} },
      ],
    });
    service = TestBed.inject(PlainspaceCommonInterfacesService);
    api = TestBed.inject(PlainspaceApiService);
  });

  // Without a seeded baseline, computePushDecisions skips every push as
  // 'no-baseline', so the done + scheduled-time write-back never fires.
  it('getAddTaskData seeds the two-way-sync baseline (done + scheduledAt)', () => {
    const data = service.getAddTaskData(issue('2026-01-02T09:00:00.000Z', true));
    expect(data.title).toBe('Buy milk');
    expect(data.isDone).toBe(true);
    expect(data.issueLastSyncedValues).toEqual({
      isDone: true,
      title: 'Buy milk',
      scheduledAt: '2026-01-02T09:00:00.000Z',
    });
  });

  it('getAddTaskData baseline carries a null scheduledAt for unscheduled tasks', () => {
    const data = service.getAddTaskData(issue(null));
    expect(data.issueLastSyncedValues).toEqual({
      isDone: false,
      title: 'Buy milk',
      scheduledAt: null,
    });
  });

  it('getAddTaskData imports scheduledAt as dueWithTime (schedule shows in the app)', () => {
    const iso = '2026-01-02T09:00:00.000Z';
    const data = service.getAddTaskData(issue(iso));
    expect(data.dueWithTime).toBe(new Date(iso).getTime());
  });

  it('getAddTaskData leaves dueWithTime unset for unscheduled tasks', () => {
    const data = service.getAddTaskData(issue(null));
    expect('dueWithTime' in data).toBe(false);
  });

  describe('getFreshDataForIssueTask (poll pulls scheduledAt → dueWithTime)', () => {
    const stubCfg = (): void => {
      spyOn(
        service as unknown as { _getCfgOnce$: (id: string) => unknown },
        '_getCfgOnce$',
      ).and.returnValue(of({}));
    };
    const setRemote = (i: PlainspaceIssue): void => {
      (api as unknown as { getById$: () => unknown }).getById$ = () => of(i);
    };

    it('pulls dueWithTime when the remote task changed', async () => {
      setRemote(issue('2026-01-02T09:00:00.000Z'));
      stubCfg();
      const task = { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 } as Task;
      const res = await service.getFreshDataForIssueTask(task);
      expect(res?.taskChanges.dueWithTime).toBe(
        new Date('2026-01-02T09:00:00.000Z').getTime(),
      );
      expect(res?.taskChanges.issueWasUpdated).toBe(true);
    });

    it('clears dueWithTime when the remote task was unscheduled', async () => {
      setRemote(issue(null));
      stubCfg();
      const task = { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 } as Task;
      const res = await service.getFreshDataForIssueTask(task);
      expect(res?.taskChanges.dueWithTime).toBeUndefined();
    });

    it('returns null when the remote task is unchanged', async () => {
      setRemote(issue('2026-01-02T09:00:00.000Z'));
      stubCfg();
      const task = {
        issueProviderId: 'p1',
        issueId: 't1',
        issueLastUpdated: new Date('2026-01-02T00:00:00.000Z').getTime(),
      } as Task;
      expect(await service.getFreshDataForIssueTask(task)).toBeNull();
    });
  });

  describe('getFreshDataForIssueTasks (bulk poll = one fetch per provider)', () => {
    it('fetches all tasks once via getMyTasks$, not one getById per task', async () => {
      spyOn(
        service as unknown as { _getCfgOnce$: (id: string) => unknown },
        '_getCfgOnce$',
      ).and.returnValue(of({}));
      const t1 = { ...issue('2026-01-02T09:00:00.000Z'), id: 't1' };
      const t2 = { ...issue('2026-01-03T09:00:00.000Z'), id: 't2' };
      const getMyTasks$ = jasmine.createSpy('getMyTasks$').and.returnValue(of([t1, t2]));
      const getById$ = jasmine.createSpy('getById$');
      (api as unknown as { getMyTasks$: unknown }).getMyTasks$ = getMyTasks$;
      (api as unknown as { getById$: unknown }).getById$ = getById$;

      const tasks = [
        { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 },
        { issueProviderId: 'p1', issueId: 't2', issueLastUpdated: 0 },
      ] as Task[];
      const updates = await service.getFreshDataForIssueTasks(tasks);

      expect(getMyTasks$).toHaveBeenCalledTimes(1);
      expect(getById$).not.toHaveBeenCalled();
      expect(updates.map((u) => u.task.issueId)).toEqual(['t1', 't2']);
    });

    it('skips tasks that are no longer returned (e.g. unassigned from me)', async () => {
      spyOn(
        service as unknown as { _getCfgOnce$: (id: string) => unknown },
        '_getCfgOnce$',
      ).and.returnValue(of({}));
      (api as unknown as { getMyTasks$: unknown }).getMyTasks$ = () =>
        of([{ ...issue('2026-01-02T09:00:00.000Z'), id: 't1' }]);
      const tasks = [
        { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 },
        { issueProviderId: 'p1', issueId: 'gone', issueLastUpdated: 0 },
      ] as Task[];
      const updates = await service.getFreshDataForIssueTasks(tasks);
      expect(updates.map((u) => u.task.issueId)).toEqual(['t1']);
    });
  });
});
