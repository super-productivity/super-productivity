import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, ReplaySubject, Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import { IdleEffects } from './idle.effects';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { ChromeExtensionInterfaceService } from '../../../core/chrome-extension-interface/chrome-extension-interface.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../../tasks/task.service';
import { MatDialog } from '@angular/material/dialog';
import { UiHelperService } from '../../ui-helper/ui-helper.service';
import { SimpleCounterService } from '../../simple-counter/simple-counter.service';
import { DateService } from '../../../core/date/date.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import { selectIdleConfig } from '../../config/store/global-config.reducer';
import { selectIsSessionRunning } from '../../focus-mode/store/focus-mode.selectors';
import { selectIdleTime, selectIsIdle } from './idle.selectors';
import { openIdleDialog, triggerIdle } from './idle.actions';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';

describe('IdleEffects', () => {
  let effects: IdleEffects;
  let actions$: Subject<Action>;
  let store: MockStore;
  let chromeInterfaceMock: {
    onReady$: Subject<void>;
    addEventListener: jasmine.Spy;
  };
  let idleCallback: ((ev: Event, data?: unknown) => void) | null;
  let simpleCounterServiceMock: {
    enabledSimpleStopWatchCounters$: BehaviorSubject<{ id: string; isOn: boolean }[]>;
    decreaseCounterToday: jasmine.Spy;
  };

  const setup = (overrides?: {
    isSuppressIdleDuringFocusMode?: boolean;
    isFocusSessionRunning?: boolean;
  }): void => {
    idleCallback = null;
    const isSuppress = overrides?.isSuppressIdleDuringFocusMode ?? false;
    const isSessionRunning = overrides?.isFocusSessionRunning ?? false;

    actions$ = new Subject<Action>();
    const onReady$ = new ReplaySubject<void>(1);
    chromeInterfaceMock = {
      onReady$,
      addEventListener: jasmine
        .createSpy('addEventListener')
        .and.callFake((event: string, cb: (ev: Event, data?: unknown) => void) => {
          if (event === IPC.IDLE_TIME) {
            idleCallback = cb;
          }
        }),
    };

    const dataInitStateMock = {
      isAllDataLoadedInitially$: new BehaviorSubject<boolean>(true),
    };

    const taskServiceMock = {
      currentTaskId: jasmine.createSpy('currentTaskId').and.returnValue('task-1'),
      removeTimeSpent: jasmine.createSpy('removeTimeSpent'),
      setCurrentId: jasmine.createSpy('setCurrentId'),
    };

    simpleCounterServiceMock = {
      enabledSimpleStopWatchCounters$: new BehaviorSubject<
        { id: string; isOn: boolean }[]
      >([]),
      decreaseCounterToday: jasmine.createSpy('decreaseCounterToday'),
    };

    TestBed.configureTestingModule({
      providers: [
        IdleEffects,
        provideMockActions(() => actions$),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        provideMockStore({
          selectors: [
            {
              selector: selectIdleConfig,
              value: {
                isEnableIdleTimeTracking: true,
                isSuppressIdleDuringFocusMode: isSuppress,
                isOnlyOpenIdleWhenCurrentTask: false,
                minIdleTime: 60000,
              },
            },
            { selector: selectIsSessionRunning, value: isSessionRunning },
            { selector: selectIsIdle, value: false },
            { selector: selectIdleTime, value: 0 },
          ],
        }),
        { provide: DataInitStateService, useValue: dataInitStateMock },
        { provide: ChromeExtensionInterfaceService, useValue: chromeInterfaceMock },
        { provide: WorkContextService, useValue: {} as any },
        { provide: TaskService, useValue: taskServiceMock },
        { provide: MatDialog, useValue: {} as any },
        { provide: UiHelperService, useValue: {} as any },
        { provide: SimpleCounterService, useValue: simpleCounterServiceMock },
        {
          provide: DateService,
          useValue: { todayStr: () => '2026-07-13' },
        },
      ],
    });

    effects = TestBed.inject(IdleEffects);
    store = TestBed.inject(MockStore);

    // Emit ready signal so _triggerIdleApis$ subscribes to the inner listener.
    // ReplaySubject replays the value even though the effect hasn't subscribed yet.
    onReady$.next();
    onReady$.complete();
  };

  afterEach(() => {
    store?.resetSelectors();
  });

  describe('triggerIdleWhenEnabled$', () => {
    it('should suppress idle when isSuppressIdleDuringFocusMode is true and a work session is running', (done) => {
      setup({ isSuppressIdleDuringFocusMode: true, isFocusSessionRunning: true });

      const emitted: unknown[] = [];
      const sub = effects.triggerIdleWhenEnabled$.subscribe({
        next: (action) => emitted.push(action),
        error: (err) => {
          sub.unsubscribe();
          done.fail(err);
        },
      });

      // Fire idle time above minIdleTime (60000ms)
      if (idleCallback) {
        idleCallback(null as unknown as Event, 120000);
      }

      setTimeout(() => {
        sub.unsubscribe();
        expect(emitted.length).toBe(0);
        done();
      }, 200);
    });

    it('should NOT suppress idle when isSuppressIdleDuringFocusMode is true but no session is running', (done) => {
      setup({ isSuppressIdleDuringFocusMode: true, isFocusSessionRunning: false });

      const emitted: unknown[] = [];
      const sub = effects.triggerIdleWhenEnabled$.subscribe({
        next: (action) => emitted.push(action),
        error: (err) => {
          sub.unsubscribe();
          done.fail(err);
        },
      });

      if (idleCallback) {
        idleCallback(null as unknown as Event, 120000);
      }

      setTimeout(() => {
        sub.unsubscribe();
        expect(emitted.length).toBe(1);
        expect(emitted[0]).toEqual(triggerIdle({ idleTime: 120000 }));
        done();
      }, 200);
    });

    it('should NOT suppress idle when isSuppressIdleDuringFocusMode is false even if session is running', (done) => {
      setup({ isSuppressIdleDuringFocusMode: false, isFocusSessionRunning: true });

      const emitted: unknown[] = [];
      const sub = effects.triggerIdleWhenEnabled$.subscribe({
        next: (action) => emitted.push(action),
        error: (err) => {
          sub.unsubscribe();
          done.fail(err);
        },
      });

      if (idleCallback) {
        idleCallback(null as unknown as Event, 120000);
      }

      setTimeout(() => {
        sub.unsubscribe();
        expect(emitted.length).toBe(1);
        expect(emitted[0]).toEqual(triggerIdle({ idleTime: 120000 }));
        done();
      }, 200);
    });
  });

  describe('handleIdleInit$', () => {
    // #9348: selectIsIdle emits `true` exactly once per idle episode. Dropping
    // that single edge (rather than deferring it) loses the side effects for
    // good AND leaves the store stuck at isIdle:true, which makes every later
    // idle tick short-circuit on isAlreadyIdle - idle handling is then dead
    // for the whole session.
    let emitted: Action[];
    let sub: { unsubscribe: () => void };

    const listen = (): void => {
      emitted = [];
      sub = effects.handleIdleInit$.subscribe((a) => emitted.push(a));
    };

    const goIdle = (): void => {
      store.overrideSelector(selectIsIdle, true);
      store.refreshState();
      TestBed.flushEffects();
    };

    const taskSpies = (): {
      currentTaskId: jasmine.Spy;
      removeTimeSpent: jasmine.Spy;
      setCurrentId: jasmine.Spy;
    } =>
      TestBed.inject(TaskService) as unknown as {
        currentTaskId: jasmine.Spy;
        removeTimeSpent: jasmine.Spy;
        setCurrentId: jasmine.Spy;
      };

    afterEach(() => {
      sub?.unsubscribe();
      // the effect starts a 1s poll interval; stop it so it cannot dispatch
      // into a torn-down TestBed
      (
        effects as unknown as { _cancelIdlePoll?: () => void } | undefined
      )?._cancelIdlePoll?.();
      // startApplyingRemoteOps() writes a MODULE-level flag that TestBed teardown
      // does not reset, so a test that throws before its own endApplyingRemoteOps()
      // would leave every later spec buffering its actions - invisible, and Karma
      // randomises spec order. Same precaution as tag.effects.spec.ts.
      const hydrationState = TestBed.inject(HydrationStateService);
      hydrationState.endApplyingRemoteOps();
      hydrationState.clearPostSyncCooldown();
      hydrationState.closeSyncWindow();
    });

    it('opens the idle dialog when nothing is being applied', () => {
      setup();
      listen();

      goIdle();

      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe(openIdleDialog.type);
    });

    it('defers - not drops - the idle side effects when the edge lands inside a sync apply window', () => {
      setup();
      const hydrationState = TestBed.inject(HydrationStateService);
      listen();

      hydrationState.startApplyingRemoteOps();
      goIdle();

      // still held: the mutations must not run mid-apply
      expect(emitted.length).toBe(0);
      expect(taskSpies().removeTimeSpent).not.toHaveBeenCalled();
      expect(taskSpies().setCurrentId).not.toHaveBeenCalled();

      hydrationState.endApplyingRemoteOps();
      TestBed.flushEffects();

      // ...but they must not be lost either
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe(openIdleDialog.type);
      expect(taskSpies().removeTimeSpent).toHaveBeenCalledTimes(1);
    });

    // The deferral can outlive the user's return. If the entity were re-read
    // after the wait, the idle time would be subtracted from whatever task is
    // current by then - deleting real tracked work from a task that never
    // accrued it.
    it('subtracts the idle time from the task running at the edge, not one started during the wait', () => {
      setup();
      const hydrationState = TestBed.inject(HydrationStateService);
      listen();

      hydrationState.startApplyingRemoteOps();
      goIdle();

      // user comes back mid-window and starts tracking something else
      taskSpies().currentTaskId.and.returnValue('task-2');

      hydrationState.endApplyingRemoteOps();
      TestBed.flushEffects();

      expect(taskSpies().removeTimeSpent).toHaveBeenCalledTimes(1);
      expect(taskSpies().removeTimeSpent.calls.mostRecent().args[0]).toBe('task-1');
      expect(taskSpies().setCurrentId).toHaveBeenCalledWith(null);
    });

    // Same hazard, other entity: a counter switched on during the wait never ran
    // during the idle period, so decrementing it would delete recorded habit time.
    it('decrements the counters running at the edge, not ones started during the wait', () => {
      setup();
      const hydrationState = TestBed.inject(HydrationStateService);
      simpleCounterServiceMock.enabledSimpleStopWatchCounters$.next([
        { id: 'counter-at-edge', isOn: true },
      ]);
      listen();

      hydrationState.startApplyingRemoteOps();
      goIdle();

      // user comes back mid-window, stops that counter and starts another
      simpleCounterServiceMock.enabledSimpleStopWatchCounters$.next([
        { id: 'counter-started-later', isOn: true },
      ]);

      hydrationState.endApplyingRemoteOps();
      TestBed.flushEffects();

      expect(simpleCounterServiceMock.decreaseCounterToday).toHaveBeenCalledTimes(1);
      expect(
        simpleCounterServiceMock.decreaseCounterToday.calls.mostRecent().args[0],
      ).toBe('counter-at-edge');
    });
  });
});
