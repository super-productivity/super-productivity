import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, ReplaySubject } from 'rxjs';
import { BackgroundSyncSchedulerService } from './background-sync-scheduler.service';
import { SyncBusyService } from './sync-busy.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncCycleGuardService } from '../../op-log/sync/sync-cycle-guard.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SYNC_MIN_INTERVAL } from './sync.const';

/**
 * The scheduler's own spec fakes SyncBusyService, so it proves the state machine
 * against a fake's emission behaviour rather than the real one. This wires the
 * REAL SyncCycleGuardService and REAL SyncBusyService to the REAL scheduler and
 * fakes only SyncWrapperService (whose sync() would otherwise drag in the whole
 * stack).
 *
 * The seam under test is the one that would fail silently: guard release →
 * busy union recompute → scheduler drain. If any link does not emit the way the
 * scheduler assumes, deferred work is never picked up — the background sync
 * simply stops happening, with nothing throwing and no unit test failing.
 */
describe('BackgroundSyncScheduler + SyncBusyService + SyncCycleGuard (integration)', () => {
  let scheduler: BackgroundSyncSchedulerService;
  let guard: SyncCycleGuardService;
  let sync: jasmine.Spy<() => Promise<string>>;
  let isSyncInProgress$: BehaviorSubject<boolean>;
  let isEncryption$: BehaviorSubject<boolean>;

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  /**
   * The duty-cycle floor spaces a background sync against ANY sync work, so
   * every drain behind a real cycle release must clear it. It reads
   * `performance.now()` (monotonic), which jasmine's clock does not fake.
   */
  let fakeNow: number;
  const passFloor = async (): Promise<void> => {
    fakeNow += SYNC_MIN_INTERVAL + 1;
    jasmine.clock().tick(SYNC_MIN_INTERVAL + 1);
    await flush();
  };

  beforeEach(() => {
    jasmine.clock().install();
    fakeNow = 10_000;
    spyOn(performance, 'now').and.callFake(() => fakeNow);
    isSyncInProgress$ = new BehaviorSubject(false);
    isEncryption$ = new BehaviorSubject(false);
    sync = jasmine.createSpy('sync').and.resolveTo('InSync');

    const gate$ = new ReplaySubject<boolean>(1);
    gate$.next(true);

    TestBed.configureTestingModule({
      providers: [
        BackgroundSyncSchedulerService,
        // The real collaborators — this is the point of the test.
        SyncBusyService,
        SyncCycleGuardService,
        {
          provide: SyncWrapperService,
          useValue: {
            sync,
            isSyncInProgress$: isSyncInProgress$.asObservable(),
            isEncryptionOperationInProgress$: isEncryption$.asObservable(),
            get isEncryptionOperationInProgress(): boolean {
              return isEncryption$.getValue();
            },
            isSyncInProgressSync: () => isSyncInProgress$.getValue(),
          },
        },
        {
          provide: SyncTriggerService,
          useValue: {
            initialSyncGateOpen$: gate$.asObservable(),
            isInitialSyncDoneSync: () => true,
          },
        },
        {
          provide: SyncProviderManager,
          useValue: {
            configEpoch: 1,
            getActiveProvider: () => ({ id: SyncProviderId.WebDAV }),
          },
        },
      ],
    });

    guard = TestBed.inject(SyncCycleGuardService);
    scheduler = TestBed.inject(BackgroundSyncSchedulerService);
  });

  afterEach(() => jasmine.clock().uninstall());

  it('defers while a real cycle is held, and drains on the real release', async () => {
    // The central claim of the whole branch, end to end through the real busy
    // union: a trigger arriving during other sync work is deferred, not dropped.
    expect(guard.tryBegin()).toBeTrue();

    scheduler.request();
    await flush();
    expect(sync).not.toHaveBeenCalled();

    guard.end();
    await passFloor();

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('drains a request deferred behind a side-channel cycle that touches no other signal', async () => {
    // Immediate upload / WS download claim the guard WITHOUT setting
    // isSyncInProgress$. This is the case a release-only busy edge got wrong:
    // the union must see the cycle at all, then see it end.
    guard.tryBegin();

    scheduler.request();
    await flush();
    expect(sync).not.toHaveBeenCalled();

    guard.end();
    await passFloor();

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("mirrors sync()'s finally ordering: idle only after the guard releases", async () => {
    // sync() clears isSyncInProgress$ BEFORE calling guard.end(). If the union
    // resolved to idle on the first of those, the scheduler would start a second
    // sync while the cycle was still held and tryBegin() would refuse it.
    guard.tryBegin();
    isSyncInProgress$.next(true);

    scheduler.request();
    await flush();
    expect(sync).not.toHaveBeenCalled();

    isSyncInProgress$.next(false);
    await flush();
    expect(sync).not.toHaveBeenCalled();

    guard.end();
    await passFloor();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('defers behind a standalone encryption operation (forceUpload holds no cycle here)', async () => {
    // isSyncInProgress$ does not span forceUpload; only the encryption flag does.
    isEncryption$.next(true);

    scheduler.request();
    await flush();
    expect(sync).not.toHaveBeenCalled();

    isEncryption$.next(false);
    await passFloor();

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst arriving during a real cycle into one drain', async () => {
    guard.tryBegin();

    scheduler.request();
    scheduler.request();
    scheduler.request();
    await flush();

    guard.end();
    await passFloor();

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('does not run when the real cycle is re-claimed before the drain', async () => {
    // Another flow wins the cycle in the same turn as the release. The
    // scheduler must not sync — it would only bounce off tryBegin().
    guard.tryBegin();
    scheduler.request();
    await flush();

    guard.end();
    guard.tryBegin();
    await passFloor();

    expect(sync).not.toHaveBeenCalled();

    guard.end();
    await passFloor();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
