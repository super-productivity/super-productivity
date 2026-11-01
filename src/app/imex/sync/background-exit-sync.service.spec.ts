import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import {
  BACKGROUND_EXIT_SYNC_BUDGET_MS,
  BackgroundExitSyncService,
} from './background-exit-sync.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { IS_ONLINE$ } from '../../util/is-online.token';
import { SyncBusyService } from './sync-busy.service';
import { SyncCycleGuardService } from '../../op-log/sync/sync-cycle-guard.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { SyncProviderId } from '../../op-log/sync-exports';
import { SyncConfig } from '../../features/config/global-config.model';

describe('BackgroundExitSyncService', () => {
  let service: BackgroundExitSyncService;
  let calls: string[];
  let flushPendingWrites: jasmine.Spy;
  let sync: jasmine.Spy;
  let isReady$: BehaviorSubject<boolean>;
  let isOnline$: BehaviorSubject<boolean>;
  let isInitialSyncDone: boolean;
  let isBusy$: BehaviorSubject<boolean>;
  let syncCfg$: BehaviorSubject<Partial<SyncConfig>>;
  let unsyncedCount: number;

  beforeEach(() => {
    calls = [];
    isReady$ = new BehaviorSubject(true);
    isOnline$ = new BehaviorSubject(true);
    isInitialSyncDone = true;
    isBusy$ = new BehaviorSubject(false);
    syncCfg$ = new BehaviorSubject<Partial<SyncConfig>>({
      syncProvider: SyncProviderId.SuperSync,
      isManualSyncOnly: false,
      syncInterval: 0,
    });
    unsyncedCount = 1;
    flushPendingWrites = jasmine
      .createSpy('flushPendingWrites')
      .and.callFake(async () => void calls.push('flush'));
    sync = jasmine.createSpy('sync').and.callFake(async () => {
      calls.push('sync');
      return 'IN_SYNC';
    });

    TestBed.configureTestingModule({
      providers: [
        BackgroundExitSyncService,
        { provide: OperationWriteFlushService, useValue: { flushPendingWrites } },
        {
          provide: SyncWrapperService,
          useValue: { sync, isEnabledAndReady$: isReady$, syncCfg$ },
        },
        {
          provide: SyncTriggerService,
          useValue: { isInitialSyncDoneSync: () => isInitialSyncDone },
        },
        {
          provide: SyncBusyService,
          useValue: {
            isBusy$,
            get isBusy(): boolean {
              return isBusy$.getValue();
            },
          },
        },
        { provide: IS_ONLINE$, useValue: isOnline$ },
        {
          provide: OperationLogStoreService,
          useValue: {
            getUnsynced: async () => new Array(unsyncedCount).fill({}),
          },
        },
      ],
    });
    service = TestBed.inject(BackgroundExitSyncService);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC;
  });

  it('persists pending ops before pushing them', async () => {
    await service.flushAndPush();
    expect(calls).toEqual(['flush', 'sync']);
  });

  it('pushes even when the last sync settled moments ago', async () => {
    // The scheduler's duty-cycle floor would defer this; the exit path must not.
    await service.flushAndPush();
    await service.flushAndPush();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('still pushes when the flush fails', async () => {
    flushPendingWrites.and.rejectWith(new Error('idb'));
    await service.flushAndPush();
    expect(sync).toHaveBeenCalled();
  });

  it('waits for a running sync to settle, then pushes', async () => {
    // The running sync may have read the op log before the flush.
    isBusy$.next(true);
    const done = service.flushAndPush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync).not.toHaveBeenCalled();
    isBusy$.next(false);
    await done;
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting for a running sync once the budget elapses', async () => {
    jasmine.clock().install();
    try {
      isBusy$.next(true);
      const done = service.flushAndPush();
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
      jasmine.clock().tick(BACKGROUND_EXIT_SYNC_BUDGET_MS);
      await done;
      isBusy$.next(false);
      expect(sync).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('pushes for a file provider with its interval on', async () => {
    syncCfg$.next({
      syncProvider: SyncProviderId.WebDAV,
      isManualSyncOnly: false,
      syncInterval: 60000,
    });
    await service.flushAndPush();
    expect(sync).toHaveBeenCalled();
  });

  const skipCases: [string, () => void][] = [
    ['offline', () => isOnline$.next(false)],
    ['no provider is ready', () => isReady$.next(false)],
    [
      'manual-only sync is on',
      () => syncCfg$.next({ ...syncCfg$.getValue(), isManualSyncOnly: true }),
    ],
    [
      'a file provider has its interval off',
      () =>
        syncCfg$.next({
          syncProvider: SyncProviderId.WebDAV,
          isManualSyncOnly: false,
          syncInterval: 0,
        }),
    ],
    ['the initial sync has not run', () => (isInitialSyncDone = false)],
    ['no op is pending', () => (unsyncedCount = 0)],
    [
      'E2E blocks auto sync',
      () => ((globalThis as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true),
    ],
  ];
  skipCases.forEach(([name, arrange]) => {
    it(`flushes but does not push when ${name}`, async () => {
      arrange();
      await service.flushAndPush();
      expect(flushPendingWrites).toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
    });
  });

  it('resolves once the budget elapses although the sync is still running', async () => {
    jasmine.clock().install();
    try {
      sync.and.returnValue(new Promise(() => undefined));
      let isDone = false;
      const done = service.flushAndPush().then(() => (isDone = true));
      // Let the flush and gate checks settle so the race is armed.
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
      expect(sync).toHaveBeenCalled();
      jasmine.clock().tick(BACKGROUND_EXIT_SYNC_BUDGET_MS - 1);
      await Promise.resolve();
      expect(isDone).toBe(false);
      jasmine.clock().tick(1);
      await done;
      expect(isDone).toBe(true);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('resolves once the budget elapses although the flush hangs', async () => {
    jasmine.clock().install();
    try {
      // iOS must reach BackgroundTask.finish() before its grace period ends.
      flushPendingWrites.and.returnValue(new Promise(() => undefined));
      let isDone = false;
      const done = service.flushAndPush().then(() => (isDone = true));
      jasmine.clock().tick(BACKGROUND_EXIT_SYNC_BUDGET_MS - 1);
      await Promise.resolve();
      expect(isDone).toBe(false);
      jasmine.clock().tick(1);
      await done;
      expect(isDone).toBe(true);
      expect(sync).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('never throws when sync throws', async () => {
    sync.and.rejectWith(new Error('net'));
    await expectAsync(service.flushAndPush()).toBeResolved();
  });
});

// Real busy service and cycle guard: the busy edge fires from inside the
// finishing sync's `finally`, which a faked isBusy$ cannot reproduce.
describe('BackgroundExitSyncService with the real cycle guard', () => {
  let service: BackgroundExitSyncService;
  let guard: SyncCycleGuardService;
  let sync: jasmine.Spy;

  beforeEach(() => {
    sync = jasmine.createSpy('sync').and.resolveTo('IN_SYNC');
    TestBed.configureTestingModule({
      providers: [
        BackgroundExitSyncService,
        SyncBusyService,
        SyncCycleGuardService,
        {
          provide: OperationWriteFlushService,
          useValue: { flushPendingWrites: async () => undefined },
        },
        {
          provide: SyncWrapperService,
          useValue: {
            sync,
            isEnabledAndReady$: new BehaviorSubject(true),
            syncCfg$: new BehaviorSubject({
              syncProvider: SyncProviderId.SuperSync,
              isManualSyncOnly: false,
            }),
            isSyncInProgress$: new BehaviorSubject(false),
            isEncryptionOperationInProgress$: new BehaviorSubject(false),
            isEncryptionOperationInProgress: false,
            isSyncInProgressSync: () => false,
          },
        },
        { provide: SyncTriggerService, useValue: { isInitialSyncDoneSync: () => true } },
        { provide: IS_ONLINE$, useValue: new BehaviorSubject(true) },
        {
          provide: OperationLogStoreService,
          useValue: { getUnsynced: async () => [{}] },
        },
      ],
    });
    service = TestBed.inject(BackgroundExitSyncService);
    guard = TestBed.inject(SyncCycleGuardService);
  });

  it('does not start its sync inside the finishing sync teardown', async () => {
    expect(guard.tryBegin()).toBe(true);
    const done = service.flushAndPush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // sync() releases the guard in its finally, then still resets SYNCING.
    guard.end();
    expect(sync).not.toHaveBeenCalled();
    await done;
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('waits again when a side channel claims the cycle before its sync starts', async () => {
    // A WS download that wins the gap would bounce sync() without pushing.
    expect(guard.tryBegin()).toBe(true);
    const done = service.flushAndPush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    guard.end();
    expect(guard.tryBegin()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync).not.toHaveBeenCalled();
    guard.end();
    await done;
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
