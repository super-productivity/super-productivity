import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
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
import { DEFAULT_TASK, Task } from '../../tasks/task.model';

describe('TimeBlockSyncEffects', () => {
  let effects: TimeBlockSyncEffects;
  let actions$: Subject<any>;
  let sub: Subscription;
  let upsertEventSpy: jasmine.Spy;
  let getByIdOnce$Spy: jasmine.Spy;

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
    getByIdOnce$Spy = jasmine
      .createSpy('getByIdOnce$')
      .and.callFake((id: string) => of(createTask(id)));

    const provider = {
      id: 'ip-1',
      issueProviderKey: 'plugin:google-calendar',
      pluginConfig: { isAutoTimeBlock: true },
    };

    TestBed.configureTestingModule({
      providers: [
        TimeBlockSyncEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [{ selector: selectEnabledIssueProviders, value: [provider] }],
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
                  deleteEvent: jasmine.createSpy('deleteEvent').and.resolveTo(undefined),
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
          useValue: { consume: () => [] },
        },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });

    effects = TestBed.inject(TimeBlockSyncEffects);
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

  it('a late change for the same task supersedes an in-flight upsert without losing the final state', fakeAsync(() => {
    let currentTitle = 'first';
    getByIdOnce$Spy.and.callFake((id: string) =>
      of(createTask(id, { title: currentTitle })),
    );
    // First upsert never resolves → it is still in flight when the next
    // settled change arrives and switchMap supersedes it.
    upsertEventSpy.and.returnValue(new Promise<void>(() => {}));

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

    // The in-flight write was superseded; the final write reflects the
    // latest settled state rather than being dropped.
    expect(upsertEventSpy).toHaveBeenCalledTimes(2);
    expect(upsertEventSpy.calls.mostRecent().args[1].title).toBe('second');
    flush();
  }));
});
