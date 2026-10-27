import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Subscription } from 'rxjs';
import { WorkSessionLogEffects } from './work-session-log.effects';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { SnackService } from '../../../core/snack/snack.service';
import { LS } from '../../../core/persistence/storage-keys.const';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import { T } from '../../../t.const';

describe('WorkSessionLogEffects', () => {
  const START = new Date('2026-05-14T09:00:00Z').getTime();
  const MIN = 60 * 1000;
  const minutesIn = (minutes: number): number => {
    const offset = minutes * MIN;
    return START + offset;
  };

  let store: MockStore;
  let sub: Subscription | undefined;
  let logWorkSessionSpy: jasmine.Spy;
  let snackService: jasmine.SpyObj<SnackService>;
  let registrationChanges$: BehaviorSubject<number>;
  let isPluginRegistered: boolean;

  const task = (id: string, title = `Task ${id}`, timeSpent = 0): Task => ({
    ...DEFAULT_TASK,
    id,
    projectId: 'project-1',
    title,
    timeSpent,
  });

  const setCurrent = (t: Task | null, at: number): void => {
    jasmine.clock().mockDate(new Date(at));
    store.overrideSelector(selectCurrentTask, t);
    store.refreshState();
  };

  /** Tracks task `id` from minute `from` to minute `to`, as the ticks would. */
  const track = (id: string, from: number, to: number): void => {
    setCurrent(task(id), minutesIn(from));
    setCurrent(task(id, `Task ${id}`, (to - from) * MIN), minutesIn(to));
  };

  const stored = (): { open: unknown; pending: unknown[] } =>
    JSON.parse(localStorage.getItem(LS.WORK_SESSION_LOG) || '{"open":null,"pending":[]}');

  const setup = (pluginConfig: Record<string, unknown>): void => {
    logWorkSessionSpy = jasmine.createSpy('logWorkSession').and.resolveTo(undefined);
    registrationChanges$ = new BehaviorSubject(0);
    TestBed.configureTestingModule({
      providers: [
        WorkSessionLogEffects,
        provideMockStore({
          selectors: [
            {
              selector: selectEnabledIssueProviders,
              value: [
                { id: 'ip-1', issueProviderKey: 'plugin:caldav-calendar', pluginConfig },
              ],
            },
            { selector: selectCurrentTask, value: null },
          ],
        }),
        {
          provide: PluginIssueProviderRegistryService,
          useValue: {
            registrationChanges$,
            getProvider: () =>
              isPluginRegistered
                ? {
                    pluginId: 'caldav-calendar-provider',
                    definition: {
                      getHeaders: () => ({}),
                      timeBlock: {
                        upsertEvent: jasmine.createSpy(),
                        deleteEvent: jasmine.createSpy(),
                        logWorkSession: logWorkSessionSpy,
                      },
                    },
                    allowPrivateNetwork: true,
                  }
                : undefined,
          },
        },
        { provide: PluginHttpService, useValue: { createHttpHelper: () => ({}) } },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    store = TestBed.inject(MockStore);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    sub = TestBed.inject(WorkSessionLogEffects).logWorkSessions$.subscribe();
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(START));
    localStorage.removeItem(LS.WORK_SESSION_LOG);
    isPluginRegistered = true;
    sub = undefined;
  });

  afterEach(() => {
    sub?.unsubscribe();
    jasmine.clock().uninstall();
    localStorage.removeItem(LS.WORK_SESSION_LOG);
  });

  it('logs a session with its start and end when tracking stops', fakeAsync(() => {
    setup({ isLogWorkSessions: true });

    track('a', 0, 30);
    setCurrent(null, minutesIn(30));
    flushMicrotasks();

    expect(logWorkSessionSpy).toHaveBeenCalledOnceWith(
      { taskId: 'a', title: 'Task a', start: START, end: minutesIn(30) },
      jasmine.any(Object),
      jasmine.any(Object),
    );
    expect(stored().pending).toEqual([]);
  }));

  it('ends the running session when switching tasks and keeps the latest title', fakeAsync(() => {
    setup({ isLogWorkSessions: true });

    setCurrent(task('a'), START);
    setCurrent(task('a', 'Renamed', 10 * MIN), minutesIn(10));
    track('b', 10, 20);
    setCurrent(null, minutesIn(20));
    flushMicrotasks();

    expect(logWorkSessionSpy.calls.allArgs().map((args) => args[0])).toEqual([
      { taskId: 'a', title: 'Renamed', start: START, end: minutesIn(10) },
      { taskId: 'b', title: 'Task b', start: minutesIn(10), end: minutesIn(20) },
    ]);
  }));

  it('skips sessions shorter than a minute', fakeAsync(() => {
    setup({ isLogWorkSessions: true });

    setCurrent(task('a'), START);
    setCurrent(task('a', 'Task a', MIN - 1), START + MIN - 1);
    setCurrent(null, START + MIN - 1);
    flushMicrotasks();

    expect(logWorkSessionSpy).not.toHaveBeenCalled();
  }));

  it('neither logs nor stores sessions while the option is off', fakeAsync(() => {
    setup({ isAutoTimeBlock: true });

    track('a', 0, 30);
    expect(stored().open).toBeNull();
    setCurrent(null, minutesIn(30));
    flushMicrotasks();

    expect(logWorkSessionSpy).not.toHaveBeenCalled();
    expect(stored().pending).toEqual([]);
  }));

  it('keeps failed sessions and retries them with the next one, warning once', fakeAsync(() => {
    setup({ isLogWorkSessions: true });
    let calls = 0;
    logWorkSessionSpy.and.callFake(() =>
      ++calls <= 2 ? Promise.reject(new Error('offline')) : Promise.resolve(),
    );

    track('a', 0, 10);
    setCurrent(null, minutesIn(10));
    flushMicrotasks();
    track('b', 10, 20);
    setCurrent(null, minutesIn(20));
    flushMicrotasks();
    expect(stored().pending.length).toBe(2);

    track('c', 20, 30);
    setCurrent(null, minutesIn(30));
    flushMicrotasks();

    expect(snackService.open).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: 'ERROR',
        msg: T.F.CALENDARS.S.WORK_SESSION_ERROR,
      }),
    );
    expect(logWorkSessionSpy.calls.allArgs().map((args) => args[0].taskId)).toEqual([
      'a',
      'a',
      'a',
      'b',
      'c',
    ]);
    expect(stored().pending).toEqual([]);
  }));

  it('logs a session cut short by a quit or crash at the next start', fakeAsync(() => {
    localStorage.setItem(
      LS.WORK_SESSION_LOG,
      JSON.stringify({
        open: {
          taskId: 'a',
          title: 'Task a',
          start: START,
          startTimeSpent: 0,
          timeSpent: 25 * MIN,
        },
        pending: [],
      }),
    );
    jasmine.clock().mockDate(new Date(minutesIn(600)));

    setup({ isLogWorkSessions: true });
    flushMicrotasks();

    expect(logWorkSessionSpy).toHaveBeenCalledOnceWith(
      { taskId: 'a', title: 'Task a', start: START, end: minutesIn(25) },
      jasmine.any(Object),
      jasmine.any(Object),
    );
    expect(stored()).toEqual({ open: null, pending: [] });
  }));

  it('keeps the full session when its partial copy finishes writing later', fakeAsync(() => {
    // A blocked second browser tab recovers the running session with a partial end.
    const partial = { taskId: 'a', title: 'Task a', start: START, end: minutesIn(5) };
    localStorage.setItem(
      LS.WORK_SESSION_LOG,
      JSON.stringify({ open: null, pending: [partial] }),
    );
    isPluginRegistered = false;
    setup({ isLogWorkSessions: true });
    let finishPartialWrite!: () => void;
    logWorkSessionSpy.and.returnValues(
      new Promise<void>((resolve) => (finishPartialWrite = resolve)),
      Promise.resolve(),
    );
    isPluginRegistered = true;
    registrationChanges$.next(1);

    track('a', 0, 30);
    setCurrent(null, minutesIn(30));
    finishPartialWrite();
    flushMicrotasks();

    expect(logWorkSessionSpy.calls.mostRecent().args[0]).toEqual({
      taskId: 'a',
      title: 'Task a',
      start: START,
      end: minutesIn(30),
    });
    expect(stored().pending).toEqual([]);
  }));

  it('remembers the running session so a quit does not lose it', fakeAsync(() => {
    setup({ isLogWorkSessions: true });

    track('a', 0, 30);

    expect(stored().open).toEqual(
      jasmine.objectContaining({ taskId: 'a', start: START, timeSpent: 30 * MIN }),
    );
  }));

  it('waits for the calendar plugin to load before writing', fakeAsync(() => {
    isPluginRegistered = false;
    setup({ isLogWorkSessions: true });

    track('a', 0, 30);
    setCurrent(null, minutesIn(30));
    flushMicrotasks();
    expect(logWorkSessionSpy).not.toHaveBeenCalled();
    expect(stored().pending.length).toBe(1);

    isPluginRegistered = true;
    registrationChanges$.next(1);
    flushMicrotasks();

    expect(logWorkSessionSpy).toHaveBeenCalledTimes(1);
    expect(stored().pending).toEqual([]);
  }));
});
