import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, ReplaySubject } from 'rxjs';
import { BackgroundSyncSchedulerService } from './background-sync-scheduler.service';
import { SyncBusyService } from './sync-busy.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SYNC_MIN_INTERVAL } from './sync.const';

class FakeBusy {
  private _isBusy$ = new BehaviorSubject(false);
  isBusy$ = this._isBusy$.asObservable();

  get isBusy(): boolean {
    return this._isBusy$.getValue();
  }

  set(v: boolean): void {
    this._isBusy$.next(v);
  }
}

class FakeTrigger {
  private _gate$ = new ReplaySubject<boolean>(1);
  private _isDone = false;
  initialSyncGateOpen$ = this._gate$.asObservable();

  isInitialSyncDoneSync(): boolean {
    return this._isDone;
  }

  setInitialSyncDone(v: boolean): void {
    this._isDone = v;
    this._gate$.next(v);
  }
}

class FakeProviderManager {
  configEpoch = 1;
  private _active: { id: SyncProviderId } | null = { id: SyncProviderId.WebDAV };

  getActiveProvider(): { id: SyncProviderId } | null {
    return this._active;
  }

  setActive(id: SyncProviderId | null): void {
    this._active = id ? { id } : null;
  }
}

describe('BackgroundSyncSchedulerService', () => {
  let scheduler: BackgroundSyncSchedulerService;
  let busy: FakeBusy;
  let trigger: FakeTrigger;
  let providerManager: FakeProviderManager;
  let sync: jasmine.Spy<() => Promise<string>>;

  /** Lets queued microtasks (the drain chain) run to completion. */
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  /**
   * The duty-cycle floor reads `performance.now()` (monotonic — a wall-clock
   * jump must not strand it), which jasmine's mockDate does NOT fake. Drive it
   * explicitly and keep the timer clock in step.
   */
  let fakeNow: number;
  const advance = (ms: number): void => {
    fakeNow += ms;
    jasmine.clock().tick(ms);
  };

  /** Advances past the duty-cycle floor so a deferred trailing run may proceed. */
  const passFloor = async (): Promise<void> => {
    advance(SYNC_MIN_INTERVAL + 1);
    await flush();
  };

  beforeEach(() => {
    jasmine.clock().install();
    fakeNow = 10_000;
    spyOn(performance, 'now').and.callFake(() => fakeNow);
    busy = new FakeBusy();
    trigger = new FakeTrigger();
    providerManager = new FakeProviderManager();
    sync = jasmine.createSpy('sync').and.resolveTo('InSync');

    TestBed.configureTestingModule({
      providers: [
        BackgroundSyncSchedulerService,
        { provide: SyncBusyService, useValue: busy },
        { provide: SyncTriggerService, useValue: trigger },
        { provide: SyncProviderManager, useValue: providerManager },
        { provide: SyncWrapperService, useValue: { sync } },
      ],
    });
    scheduler = TestBed.inject(BackgroundSyncSchedulerService);
    // Default: past the initial gate, nothing running.
    trigger.setInitialSyncDone(true);
  });

  afterEach(() => jasmine.clock().uninstall());

  describe('idle', () => {
    it('runs one sync for one request', async () => {
      scheduler.request();
      await flush();

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('does not sync without a request', async () => {
      await flush();

      expect(sync).not.toHaveBeenCalled();
    });
  });

  describe('bursts', () => {
    it('collapses a burst arriving while idle into a single leading run', async () => {
      // The drain is synchronous up to the sync() call, so the first request
      // starts running and the rest collapse into the one pending slot.
      scheduler.request();
      scheduler.request();
      scheduler.request();
      scheduler.request();
      await flush();
      await passFloor();

      // One leading run + exactly one trailing rerun for the collapsed burst.
      expect(sync).toHaveBeenCalledTimes(2);
    });

    it('has at most one pending rerun for fifty triggers during a run', async () => {
      let release!: () => void;
      sync.and.returnValue(
        new Promise<string>((resolve) => {
          release = () => resolve('InSync');
        }),
      );

      scheduler.request();
      await flush();
      expect(sync).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 50; i++) {
        scheduler.request();
      }
      sync.and.resolveTo('InSync');
      release();
      await flush();
      await passFloor();

      expect(sync).toHaveBeenCalledTimes(2);
    });
  });

  describe('duty-cycle floor', () => {
    it('does not run a trailing sync back-to-back with the one that just settled', async () => {
      // Deferring instead of dropping removed the only bound on the SYNC rate
      // (exhaustMap). When a sync outlasts syncInterval, every tick lands
      // mid-sync and would drain the instant the previous settled — a permanent
      // loop with no idle gap, in which skipDuringSyncWindow() would suppress
      // TODAY_TAG repair and day-change effects indefinitely.
      scheduler.request();
      await flush();
      expect(sync).toHaveBeenCalledTimes(1);

      // A tick that arrived during the run must not drain immediately.
      scheduler.request();
      await flush();
      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('runs the deferred trailing sync once the floor has elapsed', async () => {
      scheduler.request();
      await flush();
      expect(sync).toHaveBeenCalledTimes(1);

      scheduler.request();
      await flush();
      expect(sync).toHaveBeenCalledTimes(1);

      await passFloor();

      expect(sync).toHaveBeenCalledTimes(2);
    });

    it('never spaces the first request of the session', async () => {
      scheduler.request();
      await flush();

      expect(sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('external busy', () => {
    it('does not call sync() while other work is active', async () => {
      // A sync() call here would only bounce off the cycle guard and return
      // HANDLED_ERROR, silently burning the request.
      busy.set(true);
      scheduler.request();
      await flush();

      expect(sync).not.toHaveBeenCalled();
    });

    it('drains once the external work settles', async () => {
      busy.set(true);
      scheduler.request();
      await flush();
      expect(sync).not.toHaveBeenCalled();

      busy.set(false);
      await flush();
      // The floor spaces us against the foreign work that just settled, not only
      // against our own runs.
      expect(sync).not.toHaveBeenCalled();
      await passFloor();

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('collapses requests made while busy into one drain', async () => {
      busy.set(true);
      scheduler.request();
      scheduler.request();
      scheduler.request();
      await flush();

      busy.set(false);
      await passFloor();

      expect(sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('initial gate', () => {
    it('does not start a shadow sync before the gate opens', async () => {
      trigger.setInitialSyncDone(false);
      scheduler.request();
      await flush();

      expect(sync).not.toHaveBeenCalled();
    });

    it('drains once the awaited initial path opens the gate', async () => {
      trigger.setInitialSyncDone(false);
      scheduler.request();
      await flush();

      trigger.setInitialSyncDone(true);
      await flush();

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('drains a pre-gate request even though busy fell BEFORE the gate opened', async () => {
      // The real ordering: sync()'s finally releases the busy signals, and only
      // then does SyncEffects flip the gate in its .then(). A scheduler waking
      // only on the busy edge finds the gate shut, returns, and strands the
      // request forever — the first background sync of the session never runs.
      trigger.setInitialSyncDone(false);
      busy.set(true);
      scheduler.request();
      await flush();

      busy.set(false);
      await flush();
      expect(sync).not.toHaveBeenCalled();

      trigger.setInitialSyncDone(true);
      await passFloor();

      expect(sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('staleness', () => {
    it('drops a request whose config epoch moved before it drained', async () => {
      busy.set(true);
      scheduler.request();
      await flush();

      providerManager.configEpoch++;
      busy.set(false);
      await flush();

      expect(sync).not.toHaveBeenCalled();
    });

    it('drops a request whose provider was switched before it drained', async () => {
      busy.set(true);
      scheduler.request();
      await flush();

      providerManager.setActive(SyncProviderId.Dropbox);
      busy.set(false);
      await flush();

      expect(sync).not.toHaveBeenCalled();
    });

    it('drops rather than retargets — a later current request still runs', async () => {
      busy.set(true);
      scheduler.request();
      await flush();

      providerManager.configEpoch++;
      busy.set(false);
      await flush();
      expect(sync).not.toHaveBeenCalled();

      // A live trigger asks again against the new target.
      scheduler.request();
      await passFloor();

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('revalidates before the TRAILING run, not only at request() time', async () => {
      let release!: () => void;
      sync.and.returnValue(
        new Promise<string>((resolve) => {
          release = () => resolve('InSync');
        }),
      );

      scheduler.request();
      await flush();
      expect(sync).toHaveBeenCalledTimes(1);

      // Queued while current, invalidated mid-run.
      scheduler.request();
      providerManager.configEpoch++;

      sync.and.resolveTo('InSync');
      release();
      await flush();

      // The trailing run must not proceed against the new target.
      expect(sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure', () => {
    it('releases state after a rejected sync and can run again', async () => {
      sync.and.rejectWith(new Error('network gone'));

      scheduler.request();
      await flush();
      expect(sync).toHaveBeenCalledTimes(1);

      sync.and.resolveTo('InSync');
      scheduler.request();
      await flush();
      await passFloor();

      expect(sync).toHaveBeenCalledTimes(2);
    });

    it('honours dirty once after a failure', async () => {
      let reject!: (e: Error) => void;
      sync.and.returnValue(
        new Promise<string>((_resolve, rej) => {
          reject = rej;
        }),
      );

      scheduler.request();
      await flush();

      scheduler.request();
      sync.and.resolveTo('InSync');
      reject(new Error('boom'));
      await flush();
      await passFloor();

      expect(sync).toHaveBeenCalledTimes(2);
    });

    it('treats HANDLED_ERROR as a settled attempt, not a success to retry', async () => {
      // 'HANDLED_ERROR' is a truthy string; a naive truthiness check reads it as
      // success. Either way the scheduler releases state and does not retry on
      // its own — retry policy belongs to the source.
      sync.and.resolveTo('HANDLED_ERROR');

      scheduler.request();
      await flush();

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('does not leak an unhandled rejection out of request()', async () => {
      sync.and.rejectWith(new Error('boom'));

      expect(() => scheduler.request()).not.toThrow();
      await flush();

      expect(sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('settled$', () => {
    it('emits after a successful run', async () => {
      const seen: number[] = [];
      scheduler.settled$.subscribe(() => seen.push(1));

      scheduler.request();
      await flush();

      expect(seen.length).toBe(1);
    });

    it('emits after a failed run too', async () => {
      sync.and.rejectWith(new Error('boom'));
      const seen: number[] = [];
      scheduler.settled$.subscribe(() => seen.push(1));

      scheduler.request();
      await flush();

      expect(seen.length).toBe(1);
    });

    it('does not emit for a dropped stale request (no attempt was made)', async () => {
      const seen: number[] = [];
      scheduler.settled$.subscribe(() => seen.push(1));

      busy.set(true);
      scheduler.request();
      await flush();
      providerManager.configEpoch++;
      busy.set(false);
      await flush();

      expect(seen).toEqual([]);
    });
  });
});
