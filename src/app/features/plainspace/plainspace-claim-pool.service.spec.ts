import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  BehaviorSubject,
  Subject,
  firstValueFrom,
  of,
  skip,
  take,
  throwError,
} from 'rxjs';
import { PlainspaceClaimPoolService } from './plainspace-claim-pool.service';
import {
  PlainspaceApiService,
  PlainspaceCreatedTask,
  PlainspaceTeamTask,
  SPTeamTasksResponse,
} from '../issue/providers/plainspace/plainspace-api.service';
import {
  PlainspaceHandedOffTask,
  PlainspaceHandoffService,
} from '../issue/providers/plainspace/plainspace-handoff.service';
import { PLAINSPACE_POLL_INTERVAL } from '../issue/providers/plainspace/plainspace.const';
import { PlainspaceIssue } from '../issue/providers/plainspace/plainspace-issue.model';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { IssueService } from '../issue/issue.service';
import { IssueProviderPlainspace } from '../issue/issue.model';
import { IssueSyncStateService } from '../issue/two-way-sync/issue-sync-state.service';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { IS_ONLINE$ } from '../../util/is-online.token';

const PLAINSPACE_PROVIDER = {
  id: 'p1',
  issueProviderKey: 'PLAINSPACE',
  isEnabled: true,
  defaultProjectId: 'proj-1',
  host: 'https://plainspace.org',
  spaceId: 'space-1',
  token: 'pat_x',
} as IssueProviderPlainspace;

const LINKED_TASK: Task = {
  ...DEFAULT_TASK,
  id: 'legacy-local-id',
  title: 'A task from Plainspace',
  projectId: 'proj-1',
  issueId: 'ps-102',
  issueType: 'PLAINSPACE',
  issueProviderId: PLAINSPACE_PROVIDER.id,
};

const issue = (id: string): PlainspaceIssue => ({
  id,
  title: id,
  isDone: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  url: `https://plainspace.org/p/item/${id}`,
  projectId: 'space-1',
  scheduledAt: null,
  isRecurring: false,
});

const teamTask = (id: string): PlainspaceTeamTask => ({
  id,
  title: id,
  isRecurring: false,
  url: `https://plainspace.org/p/item/${id}`,
  assignee: null,
});

const teamFeed = (
  tasks: PlainspaceTeamTask[],
  assignedTaskIds: string[] = [],
): SPTeamTasksResponse => ({ tasks, assignedTaskIds });

describe('PlainspaceClaimPoolService', () => {
  let service: PlainspaceClaimPoolService;
  let store: MockStore;
  let apiSpy: jasmine.SpyObj<PlainspaceApiService>;
  let addTaskFromIssueSpy: jasmine.Spy;
  let snackSpy: jasmine.SpyObj<SnackService>;
  let handedOffTasks$: Subject<PlainspaceHandedOffTask>;
  let createdTasks$: Subject<PlainspaceCreatedTask>;
  let isOnline$: BehaviorSubject<boolean>;

  beforeEach(() => {
    createdTasks$ = new Subject();
    apiSpy = jasmine.createSpyObj<PlainspaceApiService>(
      'PlainspaceApiService',
      ['getUnclaimedTasks$', 'getMyTasks$', 'getTeamTasks$', 'claimTask$'],
      { createdTasks$: createdTasks$.asObservable() },
    );
    apiSpy.getUnclaimedTasks$.and.returnValue(of([issue('ps-102'), issue('ps-105')]));
    apiSpy.getMyTasks$.and.returnValue(of([issue('legacy-owned')]));
    apiSpy.getTeamTasks$.and.returnValue(
      of(teamFeed([teamTask('ps-102'), teamTask('ps-105')])),
    );
    apiSpy.claimTask$.and.returnValue(of(issue('ps-102')));
    addTaskFromIssueSpy = jasmine.createSpy('addTaskFromIssue').and.resolveTo('t1');
    snackSpy = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    handedOffTasks$ = new Subject();
    isOnline$ = new BehaviorSubject(true);

    TestBed.configureTestingModule({
      providers: [
        PlainspaceClaimPoolService,
        provideMockStore(),
        { provide: PlainspaceApiService, useValue: apiSpy },
        { provide: PlainspaceHandoffService, useValue: { handedOffTasks$ } },
        { provide: IS_ONLINE$, useValue: isOnline$ },
        { provide: IssueService, useValue: { addTaskFromIssue: addTaskFromIssueSpy } },
        { provide: SnackService, useValue: snackSpy },
      ],
    });
    service = TestBed.inject(PlainspaceClaimPoolService);
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectEnabledIssueProviders, [PLAINSPACE_PROVIDER]);
    store.overrideSelector(selectAllTasks, []);
    store.refreshState();
  });

  it('returns all previews and owned IDs without importing them', async () => {
    const assigned = {
      ...teamTask('ps-105'),
      assignee: { id: 'm-a', displayName: 'Alice' },
    };
    const unassigned = teamTask('ps-102');
    const mine = { ...teamTask('mine'), assignee: { id: 'm-me', displayName: 'Me' } };
    apiSpy.getTeamTasks$.and.returnValue(
      of(teamFeed([unassigned, assigned, mine], ['mine', 'completed'])),
    );

    const overview = await firstValueFrom(
      service.teamOverviewForProject$('proj-1').pipe(skip(1)),
    );

    expect(overview).toEqual({
      providerId: PLAINSPACE_PROVIDER.id,
      status: 'ready',
      assignedTaskIds: new Set(['mine', 'completed']),
      tasks: [
        { ...unassigned, isDone: false },
        { ...assigned, isDone: false },
        { ...mine, isDone: false },
      ],
    });
    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
    expect(apiSpy.getUnclaimedTasks$).not.toHaveBeenCalled();
  });

  it('returns null without a request for a personal project', async () => {
    const none = await firstValueFrom(service.teamOverviewForProject$('other-proj'));
    expect(none).toBeNull();
    expect(apiSpy.getTeamTasks$).not.toHaveBeenCalled();
    expect(apiSpy.getUnclaimedTasks$).not.toHaveBeenCalled();
  });

  it('distinguishes an empty team overview from a failed read', async () => {
    apiSpy.getTeamTasks$.and.returnValues(
      of(teamFeed([])),
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    const result$ = service.teamOverviewForProject$('proj-1').pipe(skip(1));

    expect(await firstValueFrom(result$)).toEqual({
      providerId: PLAINSPACE_PROVIDER.id,
      status: 'ready',
      tasks: [],
      assignedTaskIds: new Set(),
    });
    expect(await firstValueFrom(result$)).toEqual({
      providerId: PLAINSPACE_PROVIDER.id,
      status: 'unavailable',
      tasks: [],
    });
    expect(apiSpy.getUnclaimedTasks$).not.toHaveBeenCalled();
  });

  for (const error of [
    new HttpErrorResponse({ status: 404 }),
    new HttpErrorResponse({
      status: 200,
      headers: new HttpHeaders().set('Content-Type', 'text/html; charset=UTF-8'),
      error: { error: new SyntaxError(), text: '<!doctype html><html></html>' },
    }),
  ]) {
    it(`falls back to claimable tasks when the team endpoint is missing (${error.status})`, async () => {
      apiSpy.getTeamTasks$.and.returnValue(throwError(() => error));
      const overview = await firstValueFrom(
        service.teamOverviewForProject$('proj-1').pipe(skip(1)),
      );

      expect(apiSpy.getUnclaimedTasks$).toHaveBeenCalledOnceWith(PLAINSPACE_PROVIDER);
      expect(apiSpy.getMyTasks$).toHaveBeenCalledOnceWith(PLAINSPACE_PROVIDER);
      expect(overview).toEqual({
        providerId: PLAINSPACE_PROVIDER.id,
        status: 'unavailable',
        assignedTaskIds: new Set(['legacy-owned']),
        tasks: [
          jasmine.objectContaining({ id: 'ps-102' }),
          jasmine.objectContaining({ id: 'ps-105' }),
        ],
      });
      expect(overview?.tasks[0].assignee).toBeUndefined();
    });
  }

  it('keeps legacy claimable rows when the assigned feed fails', async () => {
    apiSpy.getTeamTasks$.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    apiSpy.getMyTasks$.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );

    const overview = await firstValueFrom(
      service.teamOverviewForProject$('proj-1').pipe(skip(1)),
    );

    expect(overview?.tasks.map((task) => task.id)).toEqual(['ps-102', 'ps-105']);
    expect(overview?.assignedTaskIds).toBeUndefined();
  });

  it('reports a non-HTML parse failure without a legacy request', async () => {
    apiSpy.getTeamTasks$.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 200,
            headers: new HttpHeaders().set('Content-Type', 'application/json'),
          }),
      ),
    );
    const overview = await firstValueFrom(
      service.teamOverviewForProject$('proj-1').pipe(skip(1)),
    );

    expect(overview?.status).toBe('unavailable');
    expect(apiSpy.getUnclaimedTasks$).not.toHaveBeenCalled();
  });

  it('preserves the aggregate claim pool for an unscoped provider', async () => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { ...PLAINSPACE_PROVIDER, spaceId: null },
    ]);
    store.refreshState();

    const overview = await firstValueFrom(
      service.teamOverviewForProject$('proj-1').pipe(skip(1)),
    );

    expect(overview?.status).toBe('unavailable');
    expect(overview?.tasks.map((task) => task.id)).toEqual(['ps-102', 'ps-105']);
    expect(apiSpy.getTeamTasks$).not.toHaveBeenCalled();
    expect(apiSpy.getUnclaimedTasks$).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ spaceId: null }),
    );
    expect(apiSpy.getMyTasks$).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ spaceId: null }),
    );
    expect(overview?.assignedTaskIds).toEqual(new Set(['legacy-owned']));
  });

  it('clears the previous space’s rows while the new overview is loading', () => {
    apiSpy.getTeamTasks$.and.returnValues(
      of(teamFeed([teamTask('ps-102')])),
      new Subject<SPTeamTasksResponse>(),
    );
    const pool = jasmine.createSpy('pool');
    const subscription = service.teamOverviewForProject$('proj-1').subscribe(pool);
    expect(pool.calls.mostRecent().args[0].tasks).toEqual([
      jasmine.objectContaining({ id: 'ps-102' }),
    ]);

    store.overrideSelector(selectEnabledIssueProviders, [
      { ...PLAINSPACE_PROVIDER, spaceId: 'space-2' },
    ]);
    store.refreshState();

    expect(pool.calls.mostRecent().args[0]).toEqual({
      providerId: PLAINSPACE_PROVIDER.id,
      status: 'loading',
      tasks: [],
    });
    subscription.unsubscribe();
  });

  it('refreshes only after a handoff for the bound provider', () => {
    const subscription = service.teamOverviewForProject$('proj-1').subscribe();
    const change = {
      cfg: PLAINSPACE_PROVIDER,
      providerId: PLAINSPACE_PROVIDER.id,
      taskId: 'ps-102',
    };
    handedOffTasks$.next({ ...change, providerId: 'other-provider' });
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(1);
    handedOffTasks$.next(change);
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it('marks a newly created task as mine before the scoped snapshot refresh answers', () => {
    const refreshed$ = new Subject<SPTeamTasksResponse>();
    apiSpy.getTeamTasks$.and.returnValues(of(teamFeed([], ['existing'])), refreshed$);
    const pool = jasmine.createSpy('pool');
    const subscription = service.teamOverviewForProject$('proj-1').subscribe(pool);

    createdTasks$.next({
      cfg: { ...PLAINSPACE_PROVIDER, token: 'other-token' },
      taskId: 'foreign',
    });
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(1);
    createdTasks$.next({ cfg: PLAINSPACE_PROVIDER, taskId: 'created' });

    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(2);
    expect(pool.calls.mostRecent().args[0].assignedTaskIds).toEqual(
      new Set(['existing', 'created']),
    );
    refreshed$.next(teamFeed([], ['created']));
    expect(pool.calls.mostRecent().args[0].assignedTaskIds).toEqual(new Set(['created']));
    expect(pool.calls.mostRecent().args[0].locallyAssignedTaskIds).toBeUndefined();
    subscription.unsubscribe();
  });

  it('knows only assignments confirmed by local writes when the team feed is unavailable', () => {
    apiSpy.getTeamTasks$.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    const pool = jasmine.createSpy('pool');
    const subscription = service.teamOverviewForProject$('proj-1').subscribe(pool);
    expect(pool.calls.mostRecent().args[0]).toEqual({
      providerId: PLAINSPACE_PROVIDER.id,
      status: 'unavailable',
      tasks: [],
    });

    createdTasks$.next({ cfg: PLAINSPACE_PROVIDER, taskId: 'created' });
    expect(pool.calls.mostRecent().args[0].assignedTaskIds).toBeUndefined();
    expect(pool.calls.mostRecent().args[0].locallyAssignedTaskIds).toEqual(
      new Set(['created']),
    );

    handedOffTasks$.next({
      cfg: PLAINSPACE_PROVIDER,
      providerId: PLAINSPACE_PROVIDER.id,
      taskId: 'created',
    });
    expect(pool.calls.mostRecent().args[0].locallyAssignedTaskIds).toBeUndefined();
    subscription.unsubscribe();
  });

  it('keeps previous own IDs only through a failed refresh and reconciles them on recovery', fakeAsync(() => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { ...PLAINSPACE_PROVIDER, isAutoPoll: true },
    ]);
    store.overrideSelector(selectAllTasks, [LINKED_TASK]);
    store.refreshState();
    const syncState = TestBed.inject(IssueSyncStateService);
    const setMissing = spyOn(syncState, 'setMissing').and.callThrough();
    apiSpy.getTeamTasks$.and.returnValues(
      of(
        teamFeed(
          [{ ...teamTask('other'), assignee: { id: 'other', displayName: 'Other' } }],
          ['ps-102', 'released'],
        ),
      ),
      throwError(() => new HttpErrorResponse({ status: 0 })),
      of(teamFeed([], ['different'])),
    );
    const pool = jasmine.createSpy('pool');
    const subscription = service.teamOverviewForProject$('proj-1').subscribe(pool);
    expect(setMissing).toHaveBeenCalledOnceWith([LINKED_TASK.id], []);
    setMissing.calls.reset();

    handedOffTasks$.next({
      cfg: PLAINSPACE_PROVIDER,
      providerId: PLAINSPACE_PROVIDER.id,
      taskId: 'released',
    });
    expect(pool.calls.mostRecent().args[0]).toEqual({
      providerId: PLAINSPACE_PROVIDER.id,
      status: 'unavailable',
      tasks: [],
      assignedTaskIds: new Set(['ps-102']),
    });
    expect(setMissing).not.toHaveBeenCalled();

    tick(PLAINSPACE_POLL_INTERVAL);
    expect(pool.calls.mostRecent().args[0].assignedTaskIds).toEqual(
      new Set(['different']),
    );
    expect(syncState.isMissing(LINKED_TASK.id)).toBeTrue();
    subscription.unsubscribe();
  }));

  for (const error of [
    new HttpErrorResponse({ status: 401 }),
    new HttpErrorResponse({ status: 403 }),
    new HttpErrorResponse({ status: 404, error: { error: 'Space not found' } }),
  ]) {
    it(`drops previous ownership when access is denied (${error.status})`, () => {
      apiSpy.getTeamTasks$.and.returnValues(
        of(teamFeed([], ['existing'])),
        throwError(() => error),
      );
      const pool = jasmine.createSpy('pool');
      const subscription = service.teamOverviewForProject$('proj-1').subscribe(pool);

      createdTasks$.next({ cfg: PLAINSPACE_PROVIDER, taskId: 'created' });

      expect(pool.calls.mostRecent().args[0]).toEqual({
        providerId: PLAINSPACE_PROVIDER.id,
        status: 'unavailable',
        tasks: [],
      });
      expect(apiSpy.getMyTasks$).not.toHaveBeenCalled();
      subscription.unsubscribe();
    });
  }

  it('marks only existing linked tasks from the bound provider against authoritative assignments', () => {
    const owned = { ...LINKED_TASK, id: 'owned', issueId: 'owned-remote' };
    const otherProvider = {
      ...LINKED_TASK,
      id: 'other-provider',
      issueProviderId: 'other',
    };
    const newer = { ...LINKED_TASK, id: 'newer', issueId: 'newer-remote' };
    store.overrideSelector(selectAllTasks, [LINKED_TASK, owned, otherProvider]);
    store.refreshState();
    const response$ = new Subject<SPTeamTasksResponse>();
    apiSpy.getTeamTasks$.and.returnValue(response$);
    const syncState = TestBed.inject(IssueSyncStateService);
    const setMissing = spyOn(syncState, 'setMissing').and.callThrough();
    const subscription = service.teamOverviewForProject$('proj-1').subscribe();
    expect(setMissing).not.toHaveBeenCalled();

    store.overrideSelector(selectAllTasks, [LINKED_TASK, owned, otherProvider, newer]);
    store.refreshState();
    response$.next(teamFeed([], ['owned-remote']));

    expect(setMissing).toHaveBeenCalledOnceWith(
      [LINKED_TASK.id, owned.id],
      [LINKED_TASK.id],
    );
    expect(syncState.isMissing(LINKED_TASK.id)).toBeTrue();
    subscription.unsubscribe();
  });

  it('refreshes at the Plainspace polling cadence and on reconnect while the overview is open', fakeAsync(() => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { ...PLAINSPACE_PROVIDER, isAutoPoll: true },
    ]);
    store.refreshState();
    const subscription = service.teamOverviewForProject$('proj-1').subscribe();
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(1);
    tick(PLAINSPACE_POLL_INTERVAL);
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(2);
    isOnline$.next(false);
    tick(PLAINSPACE_POLL_INTERVAL);
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(2);
    isOnline$.next(true);
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(3);
    subscription.unsubscribe();
    tick(PLAINSPACE_POLL_INTERVAL);
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(3);
  }));

  it('returns the imported local task ID and removes its preview before the claim refresh answers', async () => {
    addTaskFromIssueSpy.and.callFake(async () => {
      store.overrideSelector(selectAllTasks, [{ ...LINKED_TASK, id: 't1' }]);
      store.refreshState();
      return 't1';
    });
    const refreshed$ = new Subject<SPTeamTasksResponse>();
    apiSpy.getTeamTasks$.and.returnValues(
      of(teamFeed([teamTask('ps-102'), teamTask('ps-105')])),
      refreshed$,
    );
    const pool = jasmine.createSpy('pool');
    const subscription = service
      .teamOverviewForProject$('proj-1')
      .pipe(skip(1))
      .subscribe(pool);

    expect(await service.claim('proj-1', 'ps-102')).toBe('t1');

    expect(apiSpy.claimTask$).toHaveBeenCalledWith('ps-102', PLAINSPACE_PROVIDER);
    expect(addTaskFromIssueSpy).toHaveBeenCalledOnceWith({
      issueDataReduced: issue('ps-102'),
      issueProviderId: PLAINSPACE_PROVIDER.id,
      issueProviderKey: 'PLAINSPACE',
      isAddToBacklog: true,
    });
    expect(snackSpy.open).toHaveBeenCalledOnceWith({
      type: 'SUCCESS',
      msg: T.PLAINSPACE.CLAIM_SUCCESS,
    });
    expect(pool).toHaveBeenCalledTimes(2);
    expect(pool.calls.mostRecent().args[0].tasks).toEqual([
      jasmine.objectContaining({ id: 'ps-105' }),
    ]);
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(2);
    expect(pool.calls.mostRecent().args[0].assignedTaskIds).toEqual(new Set(['ps-102']));
    refreshed$.next(teamFeed([], ['ps-102']));
    expect(pool.calls.mostRecent().args[0].tasks).toEqual([]);
    subscription.unsubscribe();
  });

  for (const { status, msg } of [
    { status: 409, msg: T.PLAINSPACE.CLAIM_ALREADY_TAKEN },
    { status: 404, msg: T.PLAINSPACE.CLAIM_UNAVAILABLE },
  ]) {
    it(`shows the claim error and refreshes an unavailable task (${status})`, async () => {
      store.overrideSelector(selectAllTasks, [LINKED_TASK]);
      store.refreshState();
      const syncState = TestBed.inject(IssueSyncStateService);
      syncState.setMissing([LINKED_TASK.id], [LINKED_TASK.id]);
      apiSpy.claimTask$.and.returnValue(
        throwError(() => new HttpErrorResponse({ status })),
      );
      apiSpy.getTeamTasks$.and.returnValues(
        of(teamFeed([teamTask('ps-102'), teamTask('ps-105')])),
        of(teamFeed([teamTask('ps-105')])),
      );
      const pool = jasmine.createSpy('pool');
      service.teamOverviewForProject$('proj-1').pipe(skip(1), take(2)).subscribe(pool);

      expect(await service.claim('proj-1', 'ps-102')).toBeUndefined();

      expect(syncState.isMissing(LINKED_TASK.id)).toBeTrue();
      expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
      expect(snackSpy.open).toHaveBeenCalledOnceWith({ type: 'ERROR', msg });
      expect(pool).toHaveBeenCalledTimes(2);
      expect(pool.calls.mostRecent().args[0].tasks).toEqual([
        jasmine.objectContaining({ id: 'ps-105' }),
      ]);
    });
  }

  for (const status of [0, 500]) {
    it(`keeps the pool retryable when the claim request fails (${status})`, async () => {
      apiSpy.claimTask$.and.returnValue(
        throwError(() => new HttpErrorResponse({ status })),
      );
      const pool = service.teamOverviewForProject$('proj-1').subscribe();

      expect(await service.claim('proj-1', 'ps-102')).toBeUndefined();

      pool.unsubscribe();
      expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(1);
      expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
      expect(snackSpy.open).toHaveBeenCalledOnceWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.CLAIM_REQUEST_FAILED,
      });
    });
  }

  it('reports a local import error and refreshes the pool after a confirmed claim', async () => {
    addTaskFromIssueSpy.and.rejectWith(new Error('local import failed'));
    const pool = service.teamOverviewForProject$('proj-1').subscribe();

    expect(await service.claim('proj-1', 'ps-102')).toBeUndefined();

    pool.unsubscribe();
    expect(apiSpy.getTeamTasks$).toHaveBeenCalledTimes(2);
    expect(snackSpy.open).toHaveBeenCalledOnceWith({
      type: 'ERROR',
      msg: T.PLAINSPACE.CLAIM_IMPORT_FAILED,
    });
  });

  it('does not announce a new local task when the duplicate-safe import returns no ID', async () => {
    addTaskFromIssueSpy.and.resolveTo(undefined);

    expect(await service.claim('proj-1', 'ps-102')).toBeUndefined();

    expect(snackSpy.open).not.toHaveBeenCalled();
  });

  it('returns the original local ID and clears its missing state when reclaiming', async () => {
    store.overrideSelector(selectAllTasks, [
      { ...LINKED_TASK, id: 'wrong-provider', issueProviderId: 'other-provider' },
      LINKED_TASK,
    ]);
    store.refreshState();
    const syncState = TestBed.inject(IssueSyncStateService);
    const missingIds = [LINKED_TASK.id, 'wrong-provider'];
    syncState.setMissing(missingIds, missingIds);

    expect(await service.claim('proj-1', 'ps-102')).toBe(LINKED_TASK.id);

    expect(apiSpy.claimTask$).toHaveBeenCalledOnceWith('ps-102', PLAINSPACE_PROVIDER);
    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
    expect(syncState.isMissing(LINKED_TASK.id)).toBeFalse();
    expect(syncState.isMissing('wrong-provider')).toBeTrue();
  });

  it('keeps an already linked task in its other project without returning a focus target', async () => {
    store.overrideSelector(selectAllTasks, [{ ...LINKED_TASK, projectId: 'other' }]);
    store.refreshState();

    expect(await service.claim('proj-1', 'ps-102')).toBeUndefined();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  });

  it('returns the local ID when the duplicate-safe import restores an archived task', async () => {
    addTaskFromIssueSpy.and.callFake(async () => {
      store.overrideSelector(selectAllTasks, [LINKED_TASK]);
      store.refreshState();
      return undefined;
    });

    expect(await service.claim('proj-1', 'ps-102')).toBe(LINKED_TASK.id);

    expect(addTaskFromIssueSpy).toHaveBeenCalledTimes(1);
    expect(snackSpy.open).not.toHaveBeenCalled();
  });
});
