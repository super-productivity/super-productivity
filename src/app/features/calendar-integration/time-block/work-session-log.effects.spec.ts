import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Subject, Subscription } from 'rxjs';
import {
  WORK_SESSION_BEFORE_CLOSE_ID,
  WorkSessionLogEffects,
} from './work-session-log.effects';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ExecBeforeCloseService } from '../../../core/electron/exec-before-close.service';
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
  let sub: Subscription;
  let logWorkSessionSpy: jasmine.Spy;
  let snackService: jasmine.SpyObj<SnackService>;
  let closeRequests: Subject<string[]>;
  let setDoneSpy: jasmine.Spy;

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

  const setup = (pluginConfig: Record<string, unknown>): void => {
    logWorkSessionSpy = jasmine.createSpy('logWorkSession').and.resolveTo(undefined);
    closeRequests = new Subject<string[]>();
    setDoneSpy = jasmine.createSpy('setDone');
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
            getProvider: () => ({
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
            }),
          },
        },
        { provide: PluginHttpService, useValue: { createHttpHelper: () => ({}) } },
        {
          provide: ExecBeforeCloseService,
          useValue: { onBeforeClose$: closeRequests, setDone: setDoneSpy },
        },
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

  beforeEach(() => jasmine.clock().install());

  afterEach(() => {
    sub.unsubscribe();
    jasmine.clock().uninstall();
  });

  it('logs a session with its start and end when tracking stops', fakeAsync(() => {
    setup({ isLogWorkSessions: true });

    setCurrent(task('a'), START);
    setCurrent(task('a', 'Task a', 30 * MIN), minutesIn(30));
    setCurrent(null, minutesIn(30));
    flushMicrotasks();

    expect(logWorkSessionSpy).toHaveBeenCalledOnceWith(
      { taskId: 'a', title: 'Task a', start: START, end: minutesIn(30) },
      jasmine.any(Object),
      jasmine.any(Object),
    );
  }));

  it('ends the running session when switching tasks and keeps the latest title', fakeAsync(() => {
    setup({ isLogWorkSessions: true });

    setCurrent(task('a'), START);
    setCurrent(task('a', 'Renamed', 10 * MIN), minutesIn(10));
    setCurrent(task('b'), minutesIn(10));
    setCurrent(task('b', 'Task b', 10 * MIN), minutesIn(20));
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

  it('does nothing while the option is off', fakeAsync(() => {
    setup({ isAutoTimeBlock: true });

    setCurrent(task('a'), START);
    setCurrent(task('a', 'Task a', 30 * MIN), minutesIn(30));
    setCurrent(null, minutesIn(30));
    flushMicrotasks();

    expect(logWorkSessionSpy).not.toHaveBeenCalled();
  }));

  it('shows an error and keeps logging later sessions when a write fails', fakeAsync(() => {
    setup({ isLogWorkSessions: true });
    logWorkSessionSpy.and.returnValues(
      Promise.reject(new Error('offline')),
      Promise.resolve(),
    );

    setCurrent(task('a'), START);
    setCurrent(task('a', 'Task a', 10 * MIN), minutesIn(10));
    setCurrent(task('b'), minutesIn(10));
    flushMicrotasks();
    setCurrent(task('b', 'Task b', 10 * MIN), minutesIn(20));
    setCurrent(null, minutesIn(20));
    flushMicrotasks();

    expect(snackService.open).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: 'ERROR',
        msg: T.F.CALENDARS.S.WORK_SESSION_ERROR,
      }),
    );
    expect(logWorkSessionSpy).toHaveBeenCalledTimes(2);
  }));

  describe('when the app quits', () => {
    const requestClose = (): void =>
      closeRequests.next(['SYNC_BEFORE_CLOSE_ID', WORK_SESSION_BEFORE_CLOSE_ID]);

    it('logs the running session, then lets the app close', fakeAsync(() => {
      setup({ isLogWorkSessions: true });
      let resolveWrite!: () => void;
      logWorkSessionSpy.and.returnValue(
        new Promise<void>((resolve) => (resolveWrite = resolve)),
      );

      setCurrent(task('a'), START);
      setCurrent(task('a', 'Task a', 30 * MIN), minutesIn(30));
      requestClose();
      flushMicrotasks();

      expect(logWorkSessionSpy).toHaveBeenCalledOnceWith(
        { taskId: 'a', title: 'Task a', start: START, end: minutesIn(30) },
        jasmine.any(Object),
        jasmine.any(Object),
      );
      expect(setDoneSpy).not.toHaveBeenCalled();

      resolveWrite();
      flushMicrotasks();
      expect(setDoneSpy).toHaveBeenCalledOnceWith(WORK_SESSION_BEFORE_CLOSE_ID);
    }));

    it('lets the app close at once when no session is running', fakeAsync(() => {
      setup({ isLogWorkSessions: true });

      requestClose();
      flushMicrotasks();

      expect(logWorkSessionSpy).not.toHaveBeenCalled();
      expect(setDoneSpy).toHaveBeenCalledOnceWith(WORK_SESSION_BEFORE_CLOSE_ID);
    }));

    it('does not hold the app open longer than a few seconds', fakeAsync(() => {
      setup({ isLogWorkSessions: true });
      logWorkSessionSpy.and.returnValue(new Promise<void>(() => undefined));

      setCurrent(task('a'), START);
      setCurrent(task('a', 'Task a', 30 * MIN), minutesIn(30));
      requestClose();
      flushMicrotasks();
      jasmine.clock().tick(4999);
      expect(setDoneSpy).not.toHaveBeenCalled();

      jasmine.clock().tick(1);
      expect(setDoneSpy).toHaveBeenCalledOnceWith(WORK_SESSION_BEFORE_CLOSE_ID);
    }));

    it('ignores close requests meant for other handlers', fakeAsync(() => {
      setup({ isLogWorkSessions: true });

      setCurrent(task('a'), START);
      setCurrent(task('a', 'Task a', 30 * MIN), minutesIn(30));
      closeRequests.next(['SYNC_BEFORE_CLOSE_ID']);
      flushMicrotasks();

      expect(logWorkSessionSpy).not.toHaveBeenCalled();
      expect(setDoneSpy).not.toHaveBeenCalled();
    }));
  });
});
