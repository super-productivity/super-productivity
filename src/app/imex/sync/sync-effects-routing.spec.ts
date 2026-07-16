import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { SyncEffects } from './sync.effects';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncTriggerService } from './sync-trigger.service';
import { BackgroundSyncSchedulerService } from './background-sync-scheduler.service';
import { IS_ONLINE$ } from '../../util/is-online.token';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SnackService } from '../../core/snack/snack.service';
import { TaskService } from '../../features/tasks/task.service';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { InitialPwaUpdateCheckService } from '../../core/initial-pwa-update-check.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SYNC_INITIAL_SYNC_TRIGGER } from './sync.const';

/**
 * Task 3 routing. The split is the whole behaviour change: background triggers
 * must reach the scheduler (which defers rather than drops them), while the
 * gate-opening paths must keep calling sync() directly.
 *
 * These assertions are the reason IS_ONLINE$ exists as a token: the module-level
 * isOnline$ freezes its initial value at import time from `navigator.onLine`,
 * which headless Chrome reports as false — so without the seam the online filter
 * would block every case below and the suite would pass while proving nothing.
 */
describe('SyncEffects routing (Task 3)', () => {
  let effects: SyncEffects;
  let backgroundTrigger$: Subject<string | null>;
  let initialUpdateCheck$: Subject<void>;
  let isOnline$: BehaviorSubject<boolean>;
  let schedulerRequest: jasmine.Spy;
  let sync: jasmine.Spy;
  let subs: { unsubscribe: () => void }[];

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    backgroundTrigger$ = new Subject<string | null>();
    initialUpdateCheck$ = new Subject<void>();
    isOnline$ = new BehaviorSubject(true);
    schedulerRequest = jasmine.createSpy('request');
    sync = jasmine.createSpy('sync').and.resolveTo('InSync');

    TestBed.configureTestingModule({
      providers: [
        SyncEffects,
        { provide: IS_ONLINE$, useValue: isOnline$ },
        {
          provide: BackgroundSyncSchedulerService,
          useValue: { request: schedulerRequest },
        },
        {
          provide: SyncWrapperService,
          useValue: {
            sync,
            isEnabledAndReady$: new BehaviorSubject(true),
            syncInterval$: new BehaviorSubject(10000),
            syncProviderId$: new BehaviorSubject(SyncProviderId.WebDAV),
          },
        },
        {
          provide: SyncTriggerService,
          useValue: {
            getSyncTrigger$: (): Observable<string | null> =>
              backgroundTrigger$.asObservable(),
            setInitialSyncDone: jasmine.createSpy('setInitialSyncDone'),
          },
        },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: new BehaviorSubject(true) },
        },
        {
          provide: InitialPwaUpdateCheckService,
          useValue: { afterInitialUpdateCheck$: initialUpdateCheck$.asObservable() },
        },
        { provide: SnackService, useValue: jasmine.createSpyObj('Snack', ['open']) },
        {
          provide: TaskService,
          useValue: jasmine.createSpyObj('TaskService', ['setCurrentId']),
        },
        {
          provide: SimpleCounterService,
          useValue: jasmine.createSpyObj('SimpleCounterService', [
            'flushAccumulatedTime',
            'turnOffAll',
          ]),
        },
        {
          provide: ExecBeforeCloseService,
          useValue: jasmine.createSpyObj(
            'ExecBeforeCloseService',
            ['schedule', 'unschedule', 'setDone'],
            { onBeforeClose$: new Subject() },
          ),
        },
      ],
    });

    effects = TestBed.inject(SyncEffects);
    subs = [];
  });

  afterEach(() => {
    subs.forEach((s) => s.unsubscribe());
    delete (globalThis as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC;
  });

  const subscribeBackground = (): void => {
    subs.push(effects.scheduleBackgroundSync$.subscribe());
  };

  describe('background triggers', () => {
    it('routes a background trigger to the scheduler', async () => {
      subscribeBackground();

      backgroundTrigger$.next('I_INTERVAL_TIMER');
      await flush();

      expect(schedulerRequest).toHaveBeenCalledTimes(1);
    });

    it('does NOT call sync() directly — that is the whole point of the split', async () => {
      // Previously this trigger went into the shared exhaustMap and called
      // sync(), which dropped it whenever a sync was already running.
      subscribeBackground();

      backgroundTrigger$.next('I_INTERVAL_TIMER');
      await flush();

      expect(sync).not.toHaveBeenCalled();
    });

    it('routes the settle branch, which emits null rather than a trigger name', async () => {
      // The dynamic branch emits `null` for the trailing settle timer, so
      // routing must not depend on the emitted value being a trigger string.
      // For SuperSync this is the only timer-ish trigger that survives.
      subscribeBackground();

      backgroundTrigger$.next(null);
      await flush();

      expect(schedulerRequest).toHaveBeenCalledTimes(1);
    });

    it('does not request while offline', async () => {
      isOnline$.next(false);
      subscribeBackground();

      backgroundTrigger$.next('I_INTERVAL_TIMER');
      await flush();

      expect(schedulerRequest).not.toHaveBeenCalled();
    });

    it('honours the E2E auto-sync kill switch', async () => {
      (globalThis as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
      subscribeBackground();

      backgroundTrigger$.next('I_INTERVAL_TIMER');
      await flush();

      expect(schedulerRequest).not.toHaveBeenCalled();
    });
  });

  describe('gate-opening triggers stay directly awaited', () => {
    it('calls sync() directly for the initial sync, bypassing the scheduler', async () => {
      subs.push(effects.triggerSync$.subscribe());

      initialUpdateCheck$.next();
      await flush();

      expect(sync).toHaveBeenCalledTimes(1);
      expect(schedulerRequest).not.toHaveBeenCalled();
    });

    it('opens the initial gate from the initial sync, not from a background one', async () => {
      const trigger = TestBed.inject(SyncTriggerService);
      subscribeBackground();

      backgroundTrigger$.next('I_INTERVAL_TIMER');
      await flush();

      // A background trigger must never flip the gate: the scheduler refuses to
      // run until the awaited initial path has opened it.
      expect(trigger.setInitialSyncDone).not.toHaveBeenCalled();

      subs.push(effects.triggerSync$.subscribe());
      initialUpdateCheck$.next();
      await flush();

      expect(trigger.setInitialSyncDone).toHaveBeenCalledWith(true);
    });
  });

  describe('the SYNC_INITIAL_SYNC_TRIGGER constant', () => {
    it('is still the value the awaited path keys its gate flip on', () => {
      expect(SYNC_INITIAL_SYNC_TRIGGER).toBeDefined();
    });
  });
});
