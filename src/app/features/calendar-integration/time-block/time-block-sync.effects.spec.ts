import { MatDialog } from '@angular/material/dialog';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { DialogEditIssueProviderComponent } from '../../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component';
import { T } from '../../../t.const';
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
import {
  DEFAULT_TASK,
  Task,
  TaskWithDueDay,
  TaskWithDueTime,
} from '../../tasks/task.model';
import {
  selectAllTasksWithDueTimeSorted,
  selectAllUndoneTasksWithDueDay,
} from '../../tasks/store/task.selectors';
import { IssueProviderActions } from '../../issue/store/issue-provider.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DateService } from '../../../core/date/date.service';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { WorkContextType } from '../../work-context/work-context.model';

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
  let upsertAllDayEventSpy: jasmine.Spy;
  let timeBlockDef: Record<string, jasmine.Spy>;
  let bulkDeleteSidecarDayOnlyIds: string[];
  let getByIdOnce$Spy: jasmine.Spy;
  let store: MockStore;
  let provider: TestProvider;
  let bulkDeleteSidecarIds: string[];
  let oauthTokensSpy: jasmine.Spy;
  let configFields: Array<{ type: string }>;

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
    upsertAllDayEventSpy = jasmine
      .createSpy('upsertAllDayEvent')
      .and.resolveTo(undefined);
    timeBlockDef = {
      upsertEvent: upsertEventSpy,
      upsertAllDayEvent: upsertAllDayEventSpy,
      deleteEvent: deleteEventSpy,
    };
    bulkDeleteSidecarDayOnlyIds = [];
    getByIdOnce$Spy = jasmine
      .createSpy('getByIdOnce$')
      .and.callFake((id: string) => of(createTask(id)));

    provider = {
      id: 'ip-1',
      issueProviderKey: 'plugin:google-calendar',
      pluginConfig: { isAutoTimeBlock: true },
    };
    bulkDeleteSidecarIds = [];
    oauthTokensSpy = jasmine.createSpy('restoreAndCheckOAuthTokens').and.resolveTo(true);
    configFields = [{ type: 'oauthButton' }];

    TestBed.configureTestingModule({
      providers: [
        TimeBlockSyncEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            { selector: selectEnabledIssueProviders, value: [provider] },
            { selector: selectAllTasksWithDueTimeSorted, value: [] },
            { selector: selectAllUndoneTasksWithDueDay, value: [] },
          ],
        }),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: PluginBridgeService,
          useValue: { restoreAndCheckOAuthTokens: oauthTokensSpy },
        },
        { provide: TaskService, useValue: { getByIdOnce$: getByIdOnce$Spy } },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: {
            getConfigFields: () => configFields,
            getProvider: () => ({
              pluginId: 'google-calendar-provider',
              definition: {
                getHeaders: () => ({}),
                timeBlock: timeBlockDef,
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
            consumeDayOnly: () => bulkDeleteSidecarDayOnlyIds,
          },
        },
        {
          provide: DateService,
          useValue: { todayStr: () => getDbDateStr() },
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

  it('offers Connect for missing provider credentials and opens that provider settings', async () => {
    let actionFn: () => Promise<void> = async () => undefined;
    // The dialog is imported lazily, and a dynamic import() does not resolve
    // under fakeAsync, so only the debounced part runs in the fake zone.
    fakeAsync(() => {
      oauthTokensSpy.and.resolveTo(false);
      upsertEventSpy.and.rejectWith(new Error('Not authenticated'));
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New' } },
        }),
      );
      tick(COALESCE_MS);

      const snack = (TestBed.inject(SnackService).open as jasmine.Spy).calls.mostRecent()
        .args[0];
      expect(snack.actionStr).toEqual(jasmine.any(String));
      expect(oauthTokensSpy).toHaveBeenCalledOnceWith(
        'google-calendar-provider',
        provider.id,
      );
      actionFn = snack.actionFn;
      flush();
    })();

    await actionFn();
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledOnceWith(
      DialogEditIssueProviderComponent,
      {
        restoreFocus: true,
        data: { issueProvider: provider },
      },
    );
  });

  for (const hasOAuth of [true, false]) {
    it(`keeps the plain error for ${hasOAuth ? 'an authenticated' : 'a non-OAuth'} provider`, fakeAsync(() => {
      if (!hasOAuth) configFields = [];
      upsertEventSpy.and.rejectWith(new Error('API failure'));
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New' } },
        }),
      );
      tick(COALESCE_MS);

      expect(TestBed.inject(SnackService).open).toHaveBeenCalledOnceWith({
        type: 'ERROR',
        msg: T.F.CALENDARS.S.TIME_BLOCK_ERROR,
        translateParams: { errTxt: 'API failure' },
      });
      expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
      if (!hasOAuth) expect(oauthTokensSpy).not.toHaveBeenCalled();
      flush();
    }));
  }

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

  it('does not create a time-block mirror for a task imported from the same provider (#9206)', fakeAsync(() => {
    const task = createTask('task-1', {
      issueId: 'primary::event-1',
      issueProviderId: provider.id,
      issueType: 'plugin:google-calendar',
    });
    getByIdOnce$Spy.and.returnValue(of(task));

    actions$.next(
      TaskSharedActions.scheduleTaskWithTime({
        task,
        dueWithTime: task.dueWithTime!,
        isMoveToBacklog: false,
      }),
    );
    tick(COALESCE_MS);

    expect(upsertEventSpy).not.toHaveBeenCalled();
    expect(deleteEventSpy).not.toHaveBeenCalled();
    flush();
  }));

  it('still creates a time block for a task imported from a different provider', fakeAsync(() => {
    const task = createTask('task-1', {
      issueId: 'other-calendar::event-1',
      issueProviderId: 'ip-2',
      issueType: 'plugin:google-calendar',
    });
    getByIdOnce$Spy.and.returnValue(of(task));

    actions$.next(
      TaskSharedActions.scheduleTaskWithTime({
        task,
        dueWithTime: task.dueWithTime!,
        isMoveToBacklog: false,
      }),
    );
    tick(COALESCE_MS);

    expect(upsertEventSpy).toHaveBeenCalledTimes(1);
    flush();
  }));

  it('still deletes a legacy mirror when a same-provider task is deleted', fakeAsync(() => {
    const deleteSub = effects.deleteOnTaskDelete$.subscribe();
    const task = {
      ...createTask('task-1', {
        issueId: 'primary::event-1',
        issueProviderId: provider.id,
        issueType: 'plugin:google-calendar',
      }),
      subTasks: [],
    };

    actions$.next(TaskSharedActions.deleteTask({ task }));
    flushMicrotasks();

    expect(deleteEventSpy).toHaveBeenCalledTimes(1);
    expect(deleteEventSpy.calls.mostRecent().args[0]).toBe(task.id);
    deleteSub.unsubscribe();
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

  it('does not backfill a time-block mirror for a same-provider task', fakeAsync(() => {
    const backfillSub = effects.backfillOnAutoTimeBlockEnabled$.subscribe();
    const oneHourMs = 60 * 60 * 1000;
    const dueWithTime = Date.now() + oneHourMs;
    const task = createTask('task-1', {
      dueWithTime,
      issueId: 'primary::event-1',
      issueProviderId: provider.id,
      issueType: 'plugin:google-calendar',
    }) as TaskWithDueTime;
    store.overrideSelector(selectAllTasksWithDueTimeSorted, [task]);
    store.refreshState();
    getByIdOnce$Spy.and.returnValue(of(task));

    actions$.next(
      IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id: provider.id,
          changes: { pluginConfig: { isAutoTimeBlock: true } },
        },
      }),
    );
    flushMicrotasks();

    expect(getByIdOnce$Spy).toHaveBeenCalledWith(task.id);
    expect(upsertEventSpy).not.toHaveBeenCalled();
    backfillSub.unsubscribe();
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

  describe('event duration', () => {
    const triggerUpsertForTask = (task: Task): void => {
      getByIdOnce$Spy.and.callFake(() => of(task));
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: task.id, changes: { isDone: task.isDone } },
        }),
      );
      tick(COALESCE_MS);
    };

    const lastDurationMs = (): number =>
      upsertEventSpy.calls.mostRecent().args[1].durationMs;

    it('uses the remaining estimate (estimate - spent) for an active task', fakeAsync(() => {
      triggerUpsertForTask(
        createTask('task-1', {
          timeEstimate: 60 * 60 * 1000,
          timeSpent: 51 * 60 * 1000,
          isDone: false,
        }),
      );
      expect(lastDurationMs()).toBe(9 * 60 * 1000);
      flush();
    }));

    it('reflects the actual time spent when a task is done (estimate > spent)', fakeAsync(() => {
      // Regression for #7949 scenario A: must not shrink to estimate - spent.
      triggerUpsertForTask(
        createTask('task-1', {
          timeEstimate: 60 * 60 * 1000,
          timeSpent: 51 * 60 * 1000,
          isDone: true,
        }),
      );
      expect(lastDurationMs()).toBe(51 * 60 * 1000);
      flush();
    }));

    it('reflects the actual time spent when a done task overran its estimate (spent > estimate)', fakeAsync(() => {
      // Regression for #7949 scenario B: must not collapse to the 30min default.
      triggerUpsertForTask(
        createTask('task-1', {
          timeEstimate: 30 * 60 * 1000,
          timeSpent: 50 * 60 * 1000,
          isDone: true,
        }),
      );
      expect(lastDurationMs()).toBe(50 * 60 * 1000);
      flush();
    }));

    it('falls back to the estimate for a done task with no tracked time', fakeAsync(() => {
      triggerUpsertForTask(
        createTask('task-1', {
          timeEstimate: 45 * 60 * 1000,
          timeSpent: 0,
          isDone: true,
        }),
      );
      expect(lastDurationMs()).toBe(45 * 60 * 1000);
      flush();
    }));

    it('falls back to the 30min default for a done task with no estimate and no tracked time', fakeAsync(() => {
      triggerUpsertForTask(
        createTask('task-1', { timeEstimate: 0, timeSpent: 0, isDone: true }),
      );
      expect(lastDurationMs()).toBe(30 * 60 * 1000);
      flush();
    }));
  });

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

  describe('all-day blocks (isAutoTimeBlockAllDay)', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const dayStr = (offsetDays: number): string => {
      const offsetMs = offsetDays * dayMs;
      return getDbDateStr(Date.now() + offsetMs);
    };
    const createDayTask = (
      id: string,
      dueDay: string,
      partial: Partial<Task> = {},
    ): Task => createTask(id, { dueWithTime: undefined, dueDay, ...partial });
    const planForDay = (task: Task, day: string): void => {
      actions$.next(PlannerActions.planTaskForDay({ task, day }));
    };

    beforeEach(() => {
      provider.pluginConfig = { isAutoTimeBlock: true, isAutoTimeBlockAllDay: true };
    });

    it('writes nothing for a day task while the option is off (default)', fakeAsync(() => {
      provider.pluginConfig = { isAutoTimeBlock: true };
      const task = createDayTask('task-1', '2026-05-14');
      getByIdOnce$Spy.and.returnValue(of(task));

      planForDay(task, '2026-05-14');
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-2', changes: { dueDay: undefined } },
        }),
      );
      tick(COALESCE_MS);

      expect(upsertAllDayEventSpy).not.toHaveBeenCalled();
      expect(upsertEventSpy).not.toHaveBeenCalled();
      expect(deleteEventSpy).not.toHaveBeenCalled();
      flush();
    }));

    it('writes an all-day block when a task is planned for a day', fakeAsync(() => {
      const task = createDayTask('task-1', '2026-05-14');
      getByIdOnce$Spy.and.returnValue(of(task));

      planForDay(task, '2026-05-14');
      tick(COALESCE_MS);

      expect(upsertAllDayEventSpy).toHaveBeenCalledTimes(1);
      expect(upsertAllDayEventSpy.calls.mostRecent().args.slice(0, 2)).toEqual([
        'task-1',
        { title: 'Task task-1', dueDay: '2026-05-14', isDone: false },
      ]);
      expect(upsertEventSpy).not.toHaveBeenCalled();
      flush();
    }));

    it('writes all-day blocks for tasks added to Today', fakeAsync(() => {
      getByIdOnce$Spy.and.callFake((id: string) => of(createDayTask(id, dayStr(0))));

      actions$.next(
        TaskSharedActions.planTasksForToday({ taskIds: ['task-1', 'task-2'] }),
      );
      tick(COALESCE_MS);

      expect(upsertAllDayEventSpy.calls.allArgs().map((args) => args[0])).toEqual([
        'task-1',
        'task-2',
      ]);
      flush();
    }));

    it('writes an all-day block for a new task created on a day, not one with a time', fakeAsync(() => {
      const dayTask = createDayTask('day-task', dayStr(0));
      const timedTask = createTask('timed-task');
      getByIdOnce$Spy.and.callFake((id: string) =>
        of(id === dayTask.id ? dayTask : timedTask),
      );
      const add = (task: Task): void =>
        actions$.next(
          TaskSharedActions.addTask({
            task,
            workContextId: 'TODAY',
            workContextType: WorkContextType.TAG,
            isAddToBacklog: false,
            isAddToBottom: false,
          }),
        );

      add(dayTask);
      add(timedTask);
      tick(COALESCE_MS);

      expect(upsertAllDayEventSpy).toHaveBeenCalledTimes(1);
      expect(upsertAllDayEventSpy.calls.mostRecent().args[0]).toBe('day-task');
      expect(upsertEventSpy).not.toHaveBeenCalled();
      flush();
    }));

    it('ignores the option when the plugin does not implement all-day blocks', fakeAsync(() => {
      delete timeBlockDef['upsertAllDayEvent'];
      const task = createDayTask('task-1', '2026-05-14');
      getByIdOnce$Spy.and.returnValue(of(task));

      planForDay(task, '2026-05-14');
      tick(COALESCE_MS);

      expect(upsertEventSpy).not.toHaveBeenCalled();
      expect(deleteEventSpy).not.toHaveBeenCalled();
      flush();
    }));

    it('marks a completed day task done', fakeAsync(() => {
      getByIdOnce$Spy.and.returnValue(
        of(createDayTask('task-1', '2026-05-14', { isDone: true })),
      );

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
      tick(COALESCE_MS);

      expect(upsertAllDayEventSpy.calls.mostRecent().args[1].isDone).toBe(true);
      flush();
    }));

    it('does not mirror a day task imported from the same provider', fakeAsync(() => {
      const task = createDayTask('task-1', '2026-05-14', {
        issueId: 'cal::event-1',
        issueProviderId: provider.id,
      });
      getByIdOnce$Spy.and.returnValue(of(task));

      planForDay(task, '2026-05-14');
      tick(COALESCE_MS);

      expect(upsertAllDayEventSpy).not.toHaveBeenCalled();
      flush();
    }));

    it('replaces a timed block with an all-day one when a planner move drops the time', fakeAsync(() => {
      const deleteSub = effects.deleteOnUnschedule$.subscribe();
      const timedTask = createTask('task-1');
      getByIdOnce$Spy.and.returnValue(of(createDayTask('task-1', '2026-05-15')));

      actions$.next(
        PlannerActions.transferTask({
          task: timedTask,
          prevDay: '2026-05-14',
          newDay: '2026-05-15',
          targetIndex: 0,
          today: '2026-05-14',
        }),
      );
      flushMicrotasks();

      expect(upsertAllDayEventSpy).toHaveBeenCalledTimes(1);
      expect(upsertAllDayEventSpy.calls.mostRecent().args[1].dueDay).toBe('2026-05-15');
      expect(deleteEventSpy).not.toHaveBeenCalled();
      deleteSub.unsubscribe();
      flush();
    }));

    it('keeps the old delete for a timed block when the option is off', fakeAsync(() => {
      provider.pluginConfig = { isAutoTimeBlock: true };
      const deleteSub = effects.deleteOnUnschedule$.subscribe();
      getByIdOnce$Spy.and.returnValue(of(createDayTask('task-1', '2026-05-15')));

      actions$.next(
        PlannerActions.transferTask({
          task: createTask('task-1'),
          prevDay: '2026-05-14',
          newDay: '2026-05-15',
          targetIndex: 0,
          today: '2026-05-14',
        }),
      );
      flushMicrotasks();

      expect(deleteEventSpy).toHaveBeenCalledTimes(1);
      expect(upsertAllDayEventSpy).not.toHaveBeenCalled();
      deleteSub.unsubscribe();
      flush();
    }));

    it('deletes the block when a task loses its day', fakeAsync(() => {
      getByIdOnce$Spy.and.returnValue(
        of(createTask('task-1', { dueWithTime: undefined })),
      );

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { dueDay: undefined } },
        }),
      );
      tick(COALESCE_MS);

      expect(deleteEventSpy).toHaveBeenCalledTimes(1);
      expect(upsertAllDayEventSpy).not.toHaveBeenCalled();
      flush();
    }));

    it('keeps an all-day block for a task unscheduled but left in Today', fakeAsync(() => {
      const deleteSub = effects.deleteOnUnschedule$.subscribe();
      getByIdOnce$Spy.and.returnValue(of(createDayTask('task-1', dayStr(0))));

      actions$.next(
        TaskSharedActions.unscheduleTask({ id: 'task-1', isLeaveInToday: true }),
      );
      flushMicrotasks();

      expect(upsertAllDayEventSpy).toHaveBeenCalledTimes(1);
      expect(deleteEventSpy).not.toHaveBeenCalled();
      deleteSub.unsubscribe();
      flush();
    }));

    it('deletes the block of a deleted day task only while the option is on', fakeAsync(() => {
      const deleteSub = effects.deleteOnTaskDelete$.subscribe();
      getByIdOnce$Spy.and.returnValue(of(undefined));
      const task = createDayTask('task-1', '2026-05-14');

      provider.pluginConfig = { isAutoTimeBlock: true };
      actions$.next(TaskSharedActions.deleteTask({ task: { ...task, subTasks: [] } }));
      flushMicrotasks();
      expect(deleteEventSpy).not.toHaveBeenCalled();

      provider.pluginConfig = { isAutoTimeBlock: true, isAutoTimeBlockAllDay: true };
      actions$.next(TaskSharedActions.deleteTask({ task: { ...task, subTasks: [] } }));
      flushMicrotasks();
      expect(deleteEventSpy).toHaveBeenCalledTimes(1);
      deleteSub.unsubscribe();
      flush();
    }));

    it('deletes bulk-deleted day tasks only while the option is on', fakeAsync(() => {
      const bulkSub = effects.deleteOnBulkTaskDelete$.subscribe();
      getByIdOnce$Spy.and.returnValue(of(undefined));

      provider.pluginConfig = { isAutoTimeBlock: true };
      bulkDeleteSidecarDayOnlyIds = ['d-1'];
      actions$.next(TaskSharedActions.deleteTasks({ taskIds: ['d-1'] }));
      flushMicrotasks();
      expect(deleteEventSpy).not.toHaveBeenCalled();

      provider.pluginConfig = { isAutoTimeBlock: true, isAutoTimeBlockAllDay: true };
      bulkDeleteSidecarDayOnlyIds = ['d-2'];
      actions$.next(TaskSharedActions.deleteTasks({ taskIds: ['d-2'] }));
      flushMicrotasks();
      expect(deleteEventSpy).toHaveBeenCalledTimes(1);
      expect(deleteEventSpy.calls.mostRecent().args[0]).toBe('d-2');
      bulkSub.unsubscribe();
      flush();
    }));

    it('backfills day tasks from today to the end of the sync range', fakeAsync(() => {
      const backfillSub = effects.backfillOnAutoTimeBlockEnabled$.subscribe();
      const dayTasks = [
        createDayTask('past', dayStr(-1)),
        createDayTask('today', dayStr(0)),
        createDayTask('in-range', dayStr(10)),
        createDayTask('out-of-range', dayStr(20)),
      ] as TaskWithDueDay[];
      store.overrideSelector(selectAllUndoneTasksWithDueDay, dayTasks);
      store.refreshState();
      getByIdOnce$Spy.and.callFake((id: string) => of(dayTasks.find((t) => t.id === id)));

      actions$.next(
        IssueProviderActions.updateIssueProvider({
          issueProvider: { id: provider.id, changes: { pluginConfig: {} } },
        }),
      );
      flushMicrotasks();

      expect(upsertAllDayEventSpy.calls.allArgs().map((args) => args[0])).toEqual([
        'today',
        'in-range',
      ]);
      backfillSub.unsubscribe();
      flush();
    }));

    it('backfills day tasks once the option is turned on after timed blocks', fakeAsync(() => {
      const backfillSub = effects.backfillOnAutoTimeBlockEnabled$.subscribe();
      const oneHourMs = 60 * 60 * 1000;
      const timed = createTask('timed', {
        dueWithTime: Date.now() + oneHourMs,
      }) as TaskWithDueTime;
      const day = createDayTask('day', dayStr(1)) as TaskWithDueDay;
      store.overrideSelector(selectAllTasksWithDueTimeSorted, [timed]);
      store.overrideSelector(selectAllUndoneTasksWithDueDay, [day]);
      store.refreshState();
      getByIdOnce$Spy.and.callFake((id: string) => of(id === 'day' ? day : timed));
      const configChanged = (): void =>
        actions$.next(
          IssueProviderActions.updateIssueProvider({
            issueProvider: { id: provider.id, changes: { pluginConfig: {} } },
          }),
        );

      provider.pluginConfig = { isAutoTimeBlock: true };
      configChanged();
      flushMicrotasks();
      expect(upsertEventSpy).toHaveBeenCalledTimes(1);
      expect(upsertAllDayEventSpy).not.toHaveBeenCalled();

      provider.pluginConfig = { isAutoTimeBlock: true, isAutoTimeBlockAllDay: true };
      configChanged();
      flushMicrotasks();
      expect(upsertEventSpy).toHaveBeenCalledTimes(1);
      expect(upsertAllDayEventSpy).toHaveBeenCalledTimes(1);

      configChanged();
      flushMicrotasks();
      expect(upsertAllDayEventSpy).toHaveBeenCalledTimes(1);
      backfillSub.unsubscribe();
      flush();
    }));
  });
});
