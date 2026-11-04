import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { PlainspaceCommonInterfacesService } from './plainspace-common-interfaces.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceIssue } from './plainspace-issue.model';
import { IssueProviderService } from '../../issue-provider.service';
import { Task } from '../../../tasks/task.model';
import { PlainspaceConnectionStateService } from './plainspace-connection-state.service';
import { IssueSyncStateService } from '../../two-way-sync/issue-sync-state.service';

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

  // Without a seeded baseline, computePushDecisions skips completion write-back
  // as 'no-baseline'. The provider-owned pulled fields remain alongside it.
  it('getAddTaskData seeds completion and pulled field baselines', () => {
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
      expect(res?.taskChanges.dueWithTime).toBeNull();
      // The op's JSON keeps the clear, so other devices apply it (#9776); an
      // undefined was dropped and they kept the old time for good.
      expect(JSON.parse(JSON.stringify(res!.taskChanges)).dueWithTime).toBeNull();
    });

    // Plainspace → SP completion sync: when a task is completed in Plainspace, the
    // poll must carry isDone:true into the task changes so SP marks it done.
    it('pulls isDone:true when the remote task was completed', async () => {
      setRemote(issue(null, true));
      stubCfg();
      const task = { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 } as Task;
      const res = await service.getFreshDataForIssueTask(task);
      expect(res?.taskChanges.isDone).toBe(true);
    });

    it('pulls isDone:false when the remote task was reopened', async () => {
      setRemote(issue(null, false));
      stubCfg();
      const task = { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 } as Task;
      const res = await service.getFreshDataForIssueTask(task);
      expect(res?.taskChanges.isDone).toBe(false);
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

    // Plainspace → SP completion sync via the bulk poll path (the one the
    // auto-poll actually uses): a remotely-completed task must carry isDone:true.
    it('carries isDone:true for a task completed remotely', async () => {
      spyOn(
        service as unknown as { _getCfgOnce$: (id: string) => unknown },
        '_getCfgOnce$',
      ).and.returnValue(of({}));
      (api as unknown as { getMyTasks$: unknown }).getMyTasks$ = () =>
        of([{ ...issue(null, true), id: 't1' }]);
      const tasks = [
        { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 },
      ] as Task[];
      const updates = await service.getFreshDataForIssueTasks(tasks);
      expect(updates[0]?.taskChanges.isDone).toBe(true);
    });
  });

  // Release 1, Gap 1 + 2: per-field pull against the baseline, and a quiet
  // push of local edits the remote has not changed.
  describe('per-field pull and pending pushes (bulk poll)', () => {
    const UPDATED_AT = '2026-01-02T00:00:00.000Z';
    const baseline = { isDone: false, title: 'Buy milk', scheduledAt: null };
    let syncState: IssueSyncStateService;

    beforeEach(() => {
      syncState = TestBed.inject(IssueSyncStateService);
      spyOn(
        service as unknown as { _getCfgOnce$: (id: string) => unknown },
        '_getCfgOnce$',
      ).and.returnValue(of({ id: 'p1' }));
      spyOn(syncState, 'requestPush');
    });
    const remote = (changes: Partial<PlainspaceIssue>): void => {
      (api as unknown as { getMyTasks$: unknown }).getMyTasks$ = () =>
        of([{ ...issue(null), ...changes }]);
    };
    const localTask = (changes: Partial<Task> = {}): Task =>
      ({
        id: 'sp-1',
        issueProviderId: 'p1',
        issueId: 't1',
        title: 'Buy milk',
        isDone: false,
        issueLastUpdated: new Date(UPDATED_AT).getTime(),
        issueLastSyncedValues: baseline,
        ...changes,
      }) as Task;

    it('keeps a local rename when only completion changed remotely, and queues its push', async () => {
      remote({ isDone: true, updatedAt: '2026-01-03T00:00:00.000Z' });
      const updates = await service.getFreshDataForIssueTasks([
        localTask({ title: 'Buy oat milk' }),
      ]);
      expect(updates[0].taskChanges.isDone).toBeTrue();
      expect('title' in updates[0].taskChanges).toBeFalse();
      expect(updates[0].taskChanges.issueLastSyncedValues).toEqual({
        ...baseline,
        isDone: true,
      });
      // Queued after the caller applied the pulls.
      expect(syncState.requestPush).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).toHaveBeenCalledOnceWith('sp-1', true);
    });

    it('pulls a remote rename when the local title is unchanged', async () => {
      remote({ title: 'Buy almond milk', updatedAt: '2026-01-03T00:00:00.000Z' });
      const updates = await service.getFreshDataForIssueTasks([localTask()]);
      expect(updates[0].taskChanges.title).toBe('Buy almond milk');
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).not.toHaveBeenCalled();
    });

    it('lets the remote win when both sides renamed, without pushing', async () => {
      remote({ title: 'Remote name', updatedAt: '2026-01-03T00:00:00.000Z' });
      const updates = await service.getFreshDataForIssueTasks([
        localTask({ title: 'Local name' }),
      ]);
      expect(updates[0].taskChanges.title).toBe('Remote name');
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).not.toHaveBeenCalled();
    });

    it('converges when another device already sent the same rename', async () => {
      remote({ title: 'Buy oat milk', updatedAt: '2026-01-03T00:00:00.000Z' });
      const updates = await service.getFreshDataForIssueTasks([
        localTask({ title: 'Buy oat milk' }),
      ]);
      expect(updates[0].taskChanges.title).toBe('Buy oat milk');
      expect(updates[0].taskChanges.issueLastSyncedValues).toEqual({
        ...baseline,
        title: 'Buy oat milk',
      });
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).not.toHaveBeenCalled();
    });

    it('keeps a local reschedule while the remote time is unchanged, and queues its push', async () => {
      remote({ title: 'Renamed', updatedAt: '2026-01-03T00:00:00.000Z' });
      const local = Date.UTC(2026, 0, 5, 9);
      const updates = await service.getFreshDataForIssueTasks([
        localTask({ dueWithTime: local }),
      ]);
      expect('dueWithTime' in updates[0].taskChanges).toBeFalse();
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).toHaveBeenCalledOnceWith('sp-1', true);
    });

    it("keeps a repeating item's local reschedule without queueing a push", async () => {
      remote({ isRecurring: true });
      const updates = await service.getFreshDataForIssueTasks([
        localTask({ dueWithTime: Date.UTC(2026, 0, 5, 9) }),
      ]);
      expect(updates).toEqual([]);
      // Its time is set in Plainspace: the next occurrence moves it.
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).not.toHaveBeenCalled();
    });

    it('queues a pending push even when the remote is unchanged', async () => {
      remote({});
      const updates = await service.getFreshDataForIssueTasks([
        localTask({ isDone: true }),
      ]);
      expect(updates).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).toHaveBeenCalledOnceWith('sp-1', true);
    });

    // The marker can be "seen" while a field still differs from its baseline:
    // our own PATCH's answer carries the server's side effects (completing a
    // recurring item moves scheduledAt to the next occurrence) and any
    // collaborator change that landed before it.
    it('pulls a field that left its baseline even when the marker is unchanged (recurring completion)', async () => {
      const next = '2026-01-03T09:00:00.000Z';
      remote({ isDone: true, scheduledAt: next, isRecurring: true });
      const updates = await service.getFreshDataForIssueTasks([
        localTask({
          isDone: true,
          dueWithTime: Date.UTC(2026, 0, 2, 9),
          issueLastSyncedValues: {
            ...baseline,
            isDone: true,
            scheduledAt: '2026-01-02T09:00:00.000Z',
          },
        }),
      ]);
      expect(updates[0]?.taskChanges.dueWithTime).toBe(new Date(next).getTime());
    });

    it('pulls a collaborator rename carried by our own PATCH answer', async () => {
      remote({ isDone: true, title: 'Renamed by Ann' });
      const updates = await service.getFreshDataForIssueTasks([
        localTask({
          isDone: true,
          issueLastSyncedValues: { ...baseline, isDone: true },
        }),
      ]);
      expect(updates[0]?.taskChanges.title).toBe('Renamed by Ann');
      expect(syncState.requestPush).not.toHaveBeenCalled();
    });

    it('stays quiet when the marker and every field match the baseline', async () => {
      remote({});
      expect(await service.getFreshDataForIssueTasks([localTask()])).toEqual([]);
    });

    it('marks a task the response lacks as no longer in my list, and clears it when it is back', async () => {
      remote({ id: 'other' });
      await service.getFreshDataForIssueTasks([localTask({ isDone: true })]);
      expect(syncState.isMissing('sp-1')).toBeTrue();
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.requestPush).not.toHaveBeenCalled();

      remote({});
      await service.getFreshDataForIssueTasks([localTask()]);
      expect(syncState.isMissing('sp-1')).toBeFalse();
    });

    it('never marks tasks missing or pushes from a failed poll', async () => {
      (api as unknown as { getMyTasks$: unknown }).getMyTasks$ = () =>
        throwError(() => new HttpErrorResponse({ status: 0 }));
      spyOn(syncState, 'setMissing');
      await expectAsync(
        service.getFreshDataForIssueTasks([localTask({ title: 'Pending rename' })]),
      ).toBeRejected();
      await new Promise((resolve) => setTimeout(resolve));
      expect(syncState.setMissing).not.toHaveBeenCalled();
      expect(syncState.missingTaskIds().size).toBe(0);
      expect(syncState.requestPush).not.toHaveBeenCalled();
    });

    it('clears an old failure once nothing is pending', async () => {
      syncState.reportFailure('sp-1', { text: 'offline' });
      remote({});
      await service.getFreshDataForIssueTasks([localTask()]);
      expect(syncState.failures().has('sp-1')).toBeFalse();
    });
  });

  // Gap 3: a failed poll is never read as "no tasks", and only a rejected token
  // (not being offline) asks the user to reconnect.
  describe('failed polls', () => {
    const httpError = (status: number): HttpErrorResponse =>
      new HttpErrorResponse({ status, url: 'https://plainspace.org/api/integration' });
    let state: PlainspaceConnectionStateService;

    beforeEach(() => {
      state = TestBed.inject(PlainspaceConnectionStateService);
      spyOn(
        service as unknown as { _getCfgOnce$: (id: string) => unknown },
        '_getCfgOnce$',
      ).and.returnValue(of({}));
    });
    const failMyTasks = (status: number): void => {
      (api as unknown as { getMyTasks$: unknown }).getMyTasks$ = () =>
        throwError(() => httpError(status));
    };
    const tasks = [
      { issueProviderId: 'p1', issueId: 't1', issueLastUpdated: 0 },
    ] as Task[];

    it('bulk poll rejects instead of returning no updates', async () => {
      failMyTasks(0);
      await expectAsync(service.getFreshDataForIssueTasks(tasks)).toBeRejected();
      expect(state.rejectedProviderIds().size).toBe(0);
    });

    it('marks the provider for reconnect on a 401 and clears it on success', async () => {
      failMyTasks(401);
      await expectAsync(service.getFreshDataForIssueTasks(tasks)).toBeRejected();
      expect(state.rejectedProviderIds().has('p1')).toBe(true);

      (api as unknown as { getMyTasks$: unknown }).getMyTasks$ = () => of([]);
      await service.getFreshDataForIssueTasks(tasks);
      expect(state.rejectedProviderIds().has('p1')).toBe(false);
    });

    it('single-task poll rejects on an offline fetch', async () => {
      (api as unknown as { getById$: unknown }).getById$ = () =>
        throwError(() => httpError(0));
      await expectAsync(service.getFreshDataForIssueTask(tasks[0])).toBeRejected();
    });

    [0, 503, 401, 403].forEach((status) => {
      it(`backlog import adds nothing and stays quiet on a ${status}`, async () => {
        failMyTasks(status);
        expect(await service.getNewIssuesToAddToBacklog('p1', [])).toEqual([]);
        expect(state.rejectedProviderIds().has('p1')).toBe(status === 401);
      });
    });

    it('backlog import keeps the failure snack for an unexpected error', async () => {
      failMyTasks(400);
      await expectAsync(service.getNewIssuesToAddToBacklog('p1', [])).toBeRejected();
    });

    // The add-task bar searches all providers in one forkJoin: a throw here
    // would snack on every search and drop the other providers' results.
    it('search answers a rejected token with no results and marks reconnect', async () => {
      (service as unknown as { _getCfgOnce$: jasmine.Spy })._getCfgOnce$.and.returnValue(
        of({ isEnabled: true, host: 'https://plainspace.org', spaceId: 's', token: 't' }),
      );
      (api as unknown as { searchIssues$: unknown }).searchIssues$ = () =>
        throwError(() => httpError(401));
      expect(await service.searchIssues('milk', 'p1')).toEqual([]);
      expect(state.rejectedProviderIds().has('p1')).toBe(true);
    });

    // Offline, a server outage or a proxy answer quietly (no reconnect mark);
    // an unexpected error still reaches the caller.
    [0, 403, 503, 400].forEach((status) => {
      it(`search on a ${status}: ${status === 400 ? 'rejects' : 'no results'}`, async () => {
        (
          service as unknown as { _getCfgOnce$: jasmine.Spy }
        )._getCfgOnce$.and.returnValue(
          of({
            isEnabled: true,
            host: 'https://plainspace.org',
            spaceId: 's',
            token: 't',
          }),
        );
        (api as unknown as { searchIssues$: unknown }).searchIssues$ = () =>
          throwError(() => httpError(status));
        if (status === 400) {
          await expectAsync(service.searchIssues('milk', 'p1')).toBeRejected();
        } else {
          expect(await service.searchIssues('milk', 'p1')).toEqual([]);
        }
        expect(state.rejectedProviderIds().has('p1')).toBe(false);
      });
    });

    it('issueLink falls back to the host when the task cannot be fetched', async () => {
      (service as unknown as { _getCfgOnce$: jasmine.Spy })._getCfgOnce$.and.returnValue(
        of({ host: 'https://plainspace.org' }),
      );
      (api as unknown as { getById$: unknown }).getById$ = () =>
        throwError(() => httpError(0));
      expect(await service.issueLink('t1', 'p1')).toBe('https://plainspace.org');
    });
  });
});
