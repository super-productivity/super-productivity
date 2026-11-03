import { MatDialog } from '@angular/material/dialog';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { DialogEditIssueProviderComponent } from '../../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component';
import { T } from '../../../t.const';
import { TestBed, fakeAsync, tick, flush, flushMicrotasks } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Store, provideStore } from '@ngrx/store';
import { EMPTY, Subject, of, Subscription } from 'rxjs';
import {
  TimeBlockSyncEffects,
  COALESCE_MS,
  TIME_BLOCK_TITLE_RESYNC_MS,
} from './time-block-sync.effects';
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
import { updateGlobalConfigSection } from '../../config/store/global-config.actions';
import {
  CONFIG_FEATURE_NAME,
  globalConfigReducer,
  selectTimelineConfig,
} from '../../config/store/global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';

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
  let oauthTokensSpy: jasmine.Spy;
  let configFields: Array<{ type: string }>;
  let registeredPluginId: string;

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
    oauthTokensSpy = jasmine.createSpy('restoreAndCheckOAuthTokens').and.resolveTo(true);
    configFields = [{ type: 'oauthButton' }];
    registeredPluginId = 'google-calendar-provider';

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
              pluginId: registeredPluginId,
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
    // Overrides live on the shared selector objects; don't leak them.
    store.resetSelectors();
  });

  it('offers Connect for missing provider credentials and opens that provider settings', fakeAsync(() => {
    oauthTokensSpy.and.resolveTo(false);
    upsertEventSpy.and.rejectWith(new Error('Not authenticated'));
    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { title: 'New' } } }),
    );
    tick(COALESCE_MS);

    const snack = (TestBed.inject(SnackService).open as jasmine.Spy).calls.mostRecent()
      .args[0];
    expect(snack.actionStr).toEqual(jasmine.any(String));
    expect(oauthTokensSpy).toHaveBeenCalledOnceWith(
      'google-calendar-provider',
      provider.id,
    );
    snack.actionFn();
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledOnceWith(
      DialogEditIssueProviderComponent,
      {
        restoreFocus: true,
        data: { issueProvider: provider },
      },
    );
    flush();
  }));

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

  describe('time block title setting', () => {
    const setTimeBlockTitle = (timeBlockTitle: string): void => {
      store.overrideSelector(selectTimelineConfig, {
        ...DEFAULT_GLOBAL_CONFIG.schedule,
        timeBlockTitle,
      });
      store.refreshState();
    };

    const saveSchedule = (changes: Record<string, unknown>): void => {
      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'schedule',
          sectionCfg: { ...DEFAULT_GLOBAL_CONFIG.schedule, ...changes },
        }),
      );
    };

    const triggerUpsert = (task: Task): void => {
      getByIdOnce$Spy.and.callFake(() => of(task));
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: task.id, changes: { isDone: task.isDone } },
        }),
      );
      tick(COALESCE_MS);
    };

    const lastEventData = (): { title: string; isDone: boolean } =>
      upsertEventSpy.calls.mostRecent().args[1];

    const writtenTitles = (): string[][] =>
      upsertEventSpy.calls
        .allArgs()
        .map(([taskId, eventData]) => [taskId, eventData.title]);

    it('uses the task title when the setting is empty', fakeAsync(() => {
      triggerUpsert(createTask('task-1'));
      expect(lastEventData().title).toBe('Task task-1');
      flush();
    }));

    it('uses the task title when the setting is only whitespace', fakeAsync(() => {
      setTimeBlockTitle('   ');
      triggerUpsert(createTask('task-1'));
      expect(lastEventData().title).toBe('Task task-1');
      flush();
    }));

    for (const [issueProviderKey, pluginId] of [
      ['plugin:google-calendar-provider', 'google-calendar-provider'],
      ['plugin:caldav-calendar-provider', 'caldav-calendar-provider'],
    ]) {
      describe(`for ${pluginId}`, () => {
        beforeEach(() => {
          provider.issueProviderKey = issueProviderKey;
          registeredPluginId = pluginId;
        });

        it('sends the custom title instead of the task title', fakeAsync(() => {
          setTimeBlockTitle(' Focus time ');
          triggerUpsert(createTask('task-1'));
          expect(lastEventData()).toEqual(
            jasmine.objectContaining({ title: 'Focus time', isDone: false }),
          );
          flush();
        }));

        it('keeps the done flag, so the plugin still marks a done block', fakeAsync(() => {
          setTimeBlockTitle('Focus time');
          triggerUpsert(createTask('task-1', { isDone: true }));
          expect(lastEventData()).toEqual(
            jasmine.objectContaining({ title: 'Focus time', isDone: true }),
          );
          flush();
        }));
      });
    }

    describe('when the setting changes', () => {
      let resyncSub: Subscription;
      let dueWithTime: number;

      beforeEach(() => {
        const oneHourMs = 60 * 60 * 1000;
        dueWithTime = Date.now() + oneHourMs;
        const tasks = ['task-1', 'task-2'].map(
          (id) => createTask(id, { dueWithTime }) as TaskWithDueTime,
        );
        store.overrideSelector(selectAllTasksWithDueTimeSorted, tasks);
        getByIdOnce$Spy.and.callFake((id: string) => of(createTask(id, { dueWithTime })));
        resyncSub = effects.resyncOnTimeBlockTitleChange$.subscribe();
      });

      afterEach(() => resyncSub.unsubscribe());

      it('re-writes existing blocks with the new title once typing stops', fakeAsync(() => {
        setTimeBlockTitle('F');
        saveSchedule({ timeBlockTitle: 'F' });
        tick(COALESCE_MS);
        setTimeBlockTitle('Focus time');
        saveSchedule({ timeBlockTitle: 'Focus time' });
        tick(TIME_BLOCK_TITLE_RESYNC_MS - 1);
        expect(upsertEventSpy).not.toHaveBeenCalled();

        tick(1);
        flushMicrotasks();

        expect(writtenTitles()).toEqual([
          ['task-1', 'Focus time'],
          ['task-2', 'Focus time'],
        ]);
        flush();
      }));

      it('restores the task titles when the setting is cleared', fakeAsync(() => {
        setTimeBlockTitle('Focus time');
        setTimeBlockTitle('');
        saveSchedule({ timeBlockTitle: '' });
        tick(TIME_BLOCK_TITLE_RESYNC_MS);
        flushMicrotasks();

        expect(writtenTitles()).toEqual([
          ['task-1', 'Task task-1'],
          ['task-2', 'Task task-2'],
        ]);
        flush();
      }));

      it('does not re-write blocks when another schedule field is saved', fakeAsync(() => {
        setTimeBlockTitle('Focus time');
        // The save of another field emits a state with the same title.
        store.refreshState();
        saveSchedule({ timeBlockTitle: 'Focus time', workEnd: '18:00' });
        tick(TIME_BLOCK_TITLE_RESYNC_MS);
        flushMicrotasks();

        expect(upsertEventSpy).not.toHaveBeenCalled();
        flush();
      }));

      it('does not re-write blocks for another settings section', fakeAsync(() => {
        setTimeBlockTitle('Focus time');
        actions$.next(
          updateGlobalConfigSection({
            sectionKey: 'misc',
            sectionCfg: { isConfirmBeforeExit: true },
          }),
        );
        tick(TIME_BLOCK_TITLE_RESYNC_MS);
        flushMicrotasks();

        expect(upsertEventSpy).not.toHaveBeenCalled();
        flush();
      }));
    });
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
});

// The title-change check relies on the real store emitting the new state just
// before effects see the action, which MockStore cannot show.
describe('TimeBlockSyncEffects title re-sync with the real store', () => {
  it('re-writes blocks only for a save that changes the title', fakeAsync(() => {
    TestBed.configureTestingModule({
      providers: [
        TimeBlockSyncEffects,
        provideStore({ [CONFIG_FEATURE_NAME]: globalConfigReducer }),
        { provide: MatDialog, useValue: {} },
        { provide: PluginBridgeService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: SnackService, useValue: {} },
        { provide: TimeBlockDeleteSidecarService, useValue: {} },
      ],
    });
    const effects = TestBed.inject(TimeBlockSyncEffects);
    const store = TestBed.inject(Store);
    const resyncSpy = spyOn(
      effects as unknown as { _withTimeBlockContext$: () => unknown },
      '_withTimeBlockContext$',
    ).and.returnValue(EMPTY);
    const sub = effects.resyncOnTimeBlockTitleChange$.subscribe();
    const saveSchedule = (changes: Record<string, unknown>): void => {
      store.dispatch(
        updateGlobalConfigSection({
          sectionKey: 'schedule',
          sectionCfg: { ...DEFAULT_GLOBAL_CONFIG.schedule, ...changes },
        }),
      );
      tick(TIME_BLOCK_TITLE_RESYNC_MS);
    };

    saveSchedule({ workEnd: '18:00' });
    expect(resyncSpy).not.toHaveBeenCalled();

    saveSchedule({ timeBlockTitle: 'Focus time' });
    expect(resyncSpy).toHaveBeenCalledTimes(1);

    saveSchedule({ timeBlockTitle: 'Focus time', workEnd: '19:00' });
    expect(resyncSpy).toHaveBeenCalledTimes(1);

    saveSchedule({ timeBlockTitle: '' });
    expect(resyncSpy).toHaveBeenCalledTimes(2);

    sub.unsubscribe();
    flush();
  }));
});
