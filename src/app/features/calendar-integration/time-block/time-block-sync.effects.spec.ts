import { TestBed, fakeAsync, tick, flush, flushMicrotasks } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Subject, of, Subscription } from 'rxjs';
import { TimeBlockSyncEffects, COALESCE_MS } from './time-block-sync.effects';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { TaskService } from '../../tasks/task.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { SnackService } from '../../../core/snack/snack.service';
import { TimeBlockDeleteSidecarService } from './time-block-delete-sidecar.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { DEFAULT_TASK, Task, TaskWithDueTime } from '../../tasks/task.model';
import { selectAllTasksWithDueTimeSorted } from '../../tasks/store/task.selectors';
import { IssueProviderActions } from '../../issue/store/issue-provider.actions';

interface TestProvider {
  id: string;
  issueProviderKey: string;
  pluginConfig: Record<string, unknown>;
}

describe('TimeBlockSyncEffects', () => {
  let effects: TimeBlockSyncEffects;
  let actions$: Subject<any>;
  let sub: Subscription;
  let upsertEventSpy: jasmine.Spy;
  let deleteEventSpy: jasmine.Spy;
  let getByIdOnce$Spy: jasmine.Spy;
  let store: MockStore;
  let provider: TestProvider;
  let bulkDeleteSidecarIds: string[];

  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    projectId: 'project-1',
    title: `Task ${id}`,
    dueWithTime: new Date('2026-05-14T15:00:00Z').getTime(),
    timeEstimate: 30 * 60 * 1000,
    timeSpent: 0,
    ...partial,
  });

  beforeEach(() => {
    actions$ = new Subject<any>();
    upsertEventSpy = jasmine.createSpy('upsertEvent').and.resolveTo(undefined);
    deleteEventSpy = jasmine.createSpy('deleteEvent').and.resolveTo(undefined);
    getByIdOnce$Spy = jasmine
      .createSpy('getByIdOnce$')
      .and.callFake((id: string) => of(createTask(id)));

    provider = {
      id: 'ip-1',
      issueProviderKey: 'plugin:google-calendar',
      pluginConfig: { isAutoTimeBlock: true },
    };
    bulkDeleteSidecarIds = [];

    TestBed.configureTestingModule({
      providers: [
        TimeBlockSyncEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            { selector: selectEnabledIssueProviders, value: [provider] },
            { selector: selectAllTasksWithDueTimeSorted, value: [] },
          ],
        }),
        { provide: TaskService, useValue: { getByIdOnce$: getByIdOnce$Spy } },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: {
            getProvider: () => ({
              definition: {
                getHeaders: () => ({}),
                timeBlock: {
                  upsertEvent: upsertEventSpy,
                  deleteEvent: deleteEventSpy,
                },
              },
              allowPrivateNetwork: false,
            }),
          },
        },
        {
          provide: PluginHttpService,
          useValue: { createHttpHelper: () => ({}) },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: TimeBlockDeleteSidecarService,
          useValue: {
            consume: () => bulkDeleteSidecarIds,
          },
        },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });

    effects = TestBed.inject(TimeBlockSyncEffects);
    store = TestBed.inject(MockStore);
    sub = effects.upsertOnTaskChange$.subscribe();
  });

  afterEach(() => {
    sub?.unsubscribe();
  });

  it('coalesces a burst of changes for one task into a single upsert', fakeAsync(() => {
    const task = createTask('task-1');
    actions$.next(
      TaskSharedActions.reScheduleTaskWithTime({
        task,
        dueWithTime: task.dueWithTime!,
        isMoveToBacklog: false,
      }),
    );
    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { title: 'New' } } }),
    );
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { timeEstimate: 60 * 60 * 1000 } },
      }),
    );

    tick(COALESCE_MS);

    expect(upsertEventSpy).toHaveBeenCalledTimes(1);
    expect(upsertEventSpy.calls.mostRecent().args[0]).toBe('task-1');
    flush();
  }));

  it('coalesces independently per task', fakeAsync(() => {
    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { title: 'A' } } }),
    );
    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 'task-2', changes: { title: 'B' } } }),
    );
    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { title: 'A2' } } }),
    );

    tick(COALESCE_MS);

    expect(upsertEventSpy).toHaveBeenCalledTimes(2);
    const ids = upsertEventSpy.calls.allArgs().map((a) => a[0]);
    expect(ids).toContain('task-1');
    expect(ids).toContain('task-2');
    flush();
  }));

  it('ignores updateTask without a synced field change', fakeAsync(() => {
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { notes: 'irrelevant' } },
      }),
    );

    tick(COALESCE_MS);

    expect(upsertEventSpy).not.toHaveBeenCalled();
    flush();
  }));

  it('does not debounce or replay task changes when auto time-blocking is disabled', fakeAsync(() => {
    provider.pluginConfig = { isAutoTimeBlock: false };

    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { title: 'X' } } }),
    );
    provider.pluginConfig = { isAutoTimeBlock: true };
    tick(COALESCE_MS);

    expect(getByIdOnce$Spy).not.toHaveBeenCalled();
    expect(upsertEventSpy).not.toHaveBeenCalled();
    flush();
  }));

  it('skips the upsert when the task has no dueWithTime after debounce', fakeAsync(() => {
    getByIdOnce$Spy.and.callFake((id: string) =>
      of(createTask(id, { dueWithTime: null })),
    );

    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { title: 'X' } } }),
    );

    tick(COALESCE_MS);

    expect(upsertEventSpy).not.toHaveBeenCalled();
    flush();
  }));

  it('upserts on applyShortSyntax only when it carries scheduling info', fakeAsync(() => {
    const task = createTask('task-1');

    // No schedulingInfo.dueWithTime → must not trigger an upsert.
    actions$.next(
      TaskSharedActions.applyShortSyntax({ task, taskChanges: { title: 'renamed' } }),
    );
    tick(COALESCE_MS);
    expect(upsertEventSpy).not.toHaveBeenCalled();

    // With schedulingInfo.dueWithTime → triggers an upsert.
    actions$.next(
      TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { dueWithTime: task.dueWithTime! },
      }),
    );
    tick(COALESCE_MS);
    expect(upsertEventSpy).toHaveBeenCalledTimes(1);
    expect(upsertEventSpy.calls.mostRecent().args[0]).toBe('task-1');
    flush();
  }));

  it('serializes a late change behind an in-flight upsert and writes the final state last', fakeAsync(() => {
    let currentTitle = 'first';
    let resolveFirstUpsert!: () => void;
    let upsertCallNr = 0;
    getByIdOnce$Spy.and.callFake((id: string) =>
      of(createTask(id, { title: currentTitle })),
    );
    upsertEventSpy.and.callFake(() => {
      upsertCallNr++;
      if (upsertCallNr === 1) {
        return new Promise<void>((resolve) => {
          resolveFirstUpsert = resolve;
        });
      }
      return Promise.resolve();
    });

    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { title: 'first' } },
      }),
    );
    tick(COALESCE_MS);
    expect(upsertEventSpy).toHaveBeenCalledTimes(1);
    expect(upsertEventSpy.calls.mostRecent().args[1].title).toBe('first');

    currentTitle = 'second';
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { title: 'second' } },
      }),
    );
    tick(COALESCE_MS);

    expect(upsertEventSpy).toHaveBeenCalledTimes(1);

    resolveFirstUpsert();
    flushMicrotasks();

    expect(upsertEventSpy).toHaveBeenCalledTimes(2);
    expect(upsertEventSpy.calls.mostRecent().args[1].title).toBe('second');
    flush();
  }));

  it('runs a queued delete after an in-flight upsert so unschedule wins', fakeAsync(() => {
    const deleteSub = effects.deleteOnUnschedule$.subscribe();
    let resolveFirstUpsert!: () => void;
    upsertEventSpy.and.returnValue(
      new Promise<void>((resolve) => {
        resolveFirstUpsert = resolve;
      }),
    );

    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { title: 'first' } },
      }),
    );
    tick(COALESCE_MS);
    expect(upsertEventSpy).toHaveBeenCalledTimes(1);

    actions$.next(TaskSharedActions.unscheduleTask({ id: 'task-1' }));
    expect(deleteEventSpy).not.toHaveBeenCalled();

    resolveFirstUpsert();
    flushMicrotasks();

    expect(deleteEventSpy).toHaveBeenCalledTimes(1);
    expect(deleteEventSpy.calls.mostRecent().args[0]).toBe('task-1');
    deleteSub.unsubscribe();
    flush();
  }));

  it('keeps a queued delete when a later field update is no-op because the task is unscheduled', fakeAsync(() => {
    const deleteSub = effects.deleteOnUnschedule$.subscribe();
    let currentDueWithTime: number | null = new Date('2026-05-14T15:00:00Z').getTime();
    let resolveFirstUpsert!: () => void;
    getByIdOnce$Spy.and.callFake((id: string) =>
      of(createTask(id, { dueWithTime: currentDueWithTime })),
    );
    upsertEventSpy.and.returnValue(
      new Promise<void>((resolve) => {
        resolveFirstUpsert = resolve;
      }),
    );

    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { title: 'first' } },
      }),
    );
    tick(COALESCE_MS);
    expect(upsertEventSpy).toHaveBeenCalledTimes(1);

    currentDueWithTime = null;
    actions$.next(TaskSharedActions.unscheduleTask({ id: 'task-1' }));
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { title: 'after unschedule' } },
      }),
    );
    tick(COALESCE_MS);
    expect(deleteEventSpy).not.toHaveBeenCalled();

    resolveFirstUpsert();
    flushMicrotasks();

    expect(deleteEventSpy).toHaveBeenCalledTimes(1);
    expect(upsertEventSpy).toHaveBeenCalledTimes(1);
    deleteSub.unsubscribe();
    flush();
  }));

  it('queues backfill upserts so a later unschedule delete still wins', fakeAsync(() => {
    const backfillSub = effects.backfillOnAutoTimeBlockEnabled$.subscribe();
    const deleteSub = effects.deleteOnUnschedule$.subscribe();
    const oneHourMs = 60 * 60 * 1000;
    const dueWithTime = Date.now() + oneHourMs;
    let currentDueWithTime: number | null = dueWithTime;
    let resolveBackfillUpsert!: () => void;
    store.overrideSelector(selectAllTasksWithDueTimeSorted, [
      createTask('task-1', { dueWithTime }) as TaskWithDueTime,
    ]);
    store.refreshState();
    getByIdOnce$Spy.and.callFake((id: string) =>
      of(createTask(id, { dueWithTime: currentDueWithTime })),
    );
    upsertEventSpy.and.returnValue(
      new Promise<void>((resolve) => {
        resolveBackfillUpsert = resolve;
      }),
    );

    actions$.next(
      IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id: 'ip-1',
          changes: { pluginConfig: { isAutoTimeBlock: true } },
        },
      }),
    );
    expect(upsertEventSpy).toHaveBeenCalledTimes(1);

    currentDueWithTime = null;
    actions$.next(TaskSharedActions.unscheduleTask({ id: 'task-1' }));
    expect(deleteEventSpy).not.toHaveBeenCalled();

    resolveBackfillUpsert();
    flushMicrotasks();

    expect(deleteEventSpy).toHaveBeenCalledTimes(1);
    backfillSub.unsubscribe();
    deleteSub.unsubscribe();
    flush();
  }));

  it('uses the provider config captured when a queued delete is observed', fakeAsync(() => {
    const deleteSub = effects.deleteOnUnschedule$.subscribe();
    provider.pluginConfig = {
      isAutoTimeBlock: true,
      timeBlockCalendarId: 'old-calendar',
    };
    let resolveFirstUpsert!: () => void;
    upsertEventSpy.and.returnValue(
      new Promise<void>((resolve) => {
        resolveFirstUpsert = resolve;
      }),
    );

    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { title: 'first' } },
      }),
    );
    tick(COALESCE_MS);
    expect(upsertEventSpy).toHaveBeenCalledTimes(1);

    actions$.next(TaskSharedActions.unscheduleTask({ id: 'task-1' }));
    provider.pluginConfig = {
      isAutoTimeBlock: false,
      timeBlockCalendarId: 'new-calendar',
    };
    resolveFirstUpsert();
    flushMicrotasks();

    expect(deleteEventSpy).toHaveBeenCalledTimes(1);
    expect(deleteEventSpy.calls.mostRecent().args[1].timeBlockCalendarId).toBe(
      'old-calendar',
    );
    deleteSub.unsubscribe();
    flush();
  }));

  it('caps bulk-delete HTTP fan-out so it does not burst rate limits', fakeAsync(() => {
    const bulkSub = effects.deleteOnBulkTaskDelete$.subscribe();
    const taskIds = ['t-1', 't-2', 't-3', 't-4', 't-5'];
    bulkDeleteSidecarIds = [...taskIds];

    const resolvers: Array<() => void> = [];
    deleteEventSpy.and.callFake(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    actions$.next(TaskSharedActions.deleteTasks({ taskIds }));

    // At most MAX_PARALLEL_TIME_BLOCK_HTTP (=3) HTTP calls should be in flight.
    expect(deleteEventSpy).toHaveBeenCalledTimes(3);

    resolvers[0]();
    flushMicrotasks();
    expect(deleteEventSpy).toHaveBeenCalledTimes(4);

    resolvers[1]();
    flushMicrotasks();
    expect(deleteEventSpy).toHaveBeenCalledTimes(5);

    resolvers.slice(2).forEach((r) => r());
    flushMicrotasks();
    expect(deleteEventSpy).toHaveBeenCalledTimes(5);
    bulkSub.unsubscribe();
    flush();
  }));
});
