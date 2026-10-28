import { signal } from '@angular/core';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { SyncWrapperService } from '../../../imex/sync/sync-wrapper.service';
import { SyncEpochChangedError } from '../../../op-log/core/errors/sync-errors';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import {
  SyncProviderManager,
  SyncStatusChangePayload,
} from '../../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../config/global-config.service';
import {
  CaptureKeyConfig,
  GlobalConfigState,
  SyncConfig,
} from '../../config/global-config.model';
import { DateService } from '../../../core/date/date.service';
import { TaskReminderOptionId } from '../task.model';
import {
  NativeCaptureImporter,
  NativeCaptureImportResult,
} from '../native-capture/native-capture-importer.service';
import { Log } from '../../../core/log';
import { AgentCaptureService } from './agent-capture.service';
import { AgentCaptureRun, CaptureUnsupportedError } from './super-sync-capture-source';

describe('AgentCaptureService', () => {
  const KEY: CaptureKeyConfig = { v: 1, privateKeyPkcs8: 'priv', publicKeySpki: 'pub' };
  let service: AgentCaptureService;
  let syncing$: BehaviorSubject<boolean>;
  let syncStatus$: BehaviorSubject<SyncStatusChangePayload>;
  let syncCfg: ReturnType<typeof signal<Partial<SyncConfig> | undefined>>;
  let globalCfg: ReturnType<typeof signal<GlobalConfigState | undefined>>;
  let provider: {
    id: SyncProviderId;
    registerCaptureKey: jasmine.Spy;
    disableCaptureKey: jasmine.Spy;
    listCaptureGrants: jasmine.Spy;
  };
  let importer: jasmine.SpyObj<NativeCaptureImporter>;
  let calls: string[];
  /** Another tab holds the import lock. */
  let isLockHeld: boolean;
  /** The Web Locks request itself fails, e.g. on an opaque origin. */
  let lockError: Error | null;

  const syncOnce = (result: SyncStatusChangePayload = 'IN_SYNC'): void => {
    syncStatus$.next('SYNCING');
    syncing$.next(true);
    syncStatus$.next(result);
    syncing$.next(false);
  };

  let ownLocksDescriptor: PropertyDescriptor | undefined;

  afterEach(() => {
    if (ownLocksDescriptor) {
      Object.defineProperty(navigator, 'locks', ownLocksDescriptor);
    } else {
      delete (navigator as { locks?: LockManager }).locks;
    }
  });

  beforeEach(() => {
    calls = [];
    isLockHeld = false;
    lockError = null;
    // Native Web Locks resolve outside fakeAsync; this one stays in the zone.
    // An own property, as lock.service.spec does: other specs may have left
    // `locks` as a plain value, which spyOnProperty cannot replace.
    ownLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          name: string,
          _opts: LockOptions,
          cb: (lock: Lock | null) => Promise<void> | void,
        ) =>
          lockError
            ? Promise.reject(lockError)
            : Promise.resolve(cb(isLockHeld ? null : ({ name } as Lock))),
      } as unknown as LockManager,
    });
    const record = (name: string) => async (): Promise<void> => {
      calls.push(name);
    };
    syncing$ = new BehaviorSubject(false);
    syncStatus$ = new BehaviorSubject<SyncStatusChangePayload>('UNKNOWN_OR_CHANGED');
    syncCfg = signal<Partial<SyncConfig> | undefined>({ captureKey: KEY });
    globalCfg = signal<GlobalConfigState | undefined>(undefined);
    provider = {
      id: SyncProviderId.SuperSync,
      registerCaptureKey: jasmine.createSpy().and.callFake(async () => {
        calls.push('register');
        return 'registered';
      }),
      disableCaptureKey: jasmine.createSpy().and.callFake(record('disable')),
      listCaptureGrants: jasmine.createSpy().and.resolveTo({ grants: [] }),
    };
    importer = jasmine.createSpyObj<NativeCaptureImporter>('Importer', ['importPending']);
    importer.importPending.and.resolveTo({ created: 0, invalid: 0 });

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        { provide: NativeCaptureImporter, useValue: importer },
        {
          provide: GlobalConfigService,
          useValue: {
            sync: syncCfg,
            cfg: globalCfg,
            updateSection: jasmine
              .createSpy('updateSection')
              .and.callFake((_: string, cfg: Partial<SyncConfig>) => {
                calls.push(`update:${cfg.captureKey === null ? 'null' : 'key'}`);
              }),
          },
        },
        {
          provide: SyncProviderManager,
          useValue: {
            getActiveProvider: () => provider,
            syncStatus$,
            syncEpoch: 1,
            assertSyncEpochUnchanged: () => undefined,
          },
        },
        { provide: DateService, useValue: { todayStr: () => '2026-10-15' } },
        {
          provide: SyncWrapperService,
          useValue: { isSyncInProgress$: syncing$ },
        },
      ],
    });
    service = TestBed.inject(AgentCaptureService);
  });

  it('imports after a sync, at most once a minute with one trailing run', fakeAsync(() => {
    service.start();
    syncOnce();
    flushMicrotasks();
    expect(importer.importPending).toHaveBeenCalledTimes(1);

    syncOnce();
    syncOnce();
    flushMicrotasks();
    expect(importer.importPending).toHaveBeenCalledTimes(1);

    tick(60_000);
    expect(importer.importPending).toHaveBeenCalledTimes(2);
    tick(60_000);
  }));

  it('does not import after a failed sync: its key may be stale', fakeAsync(() => {
    service.start();
    syncOnce('ERROR');
    syncOnce('UNKNOWN_OR_CHANGED');
    // A cycle skipped right after a failure keeps the failed status.
    syncing$.next(true);
    syncing$.next(false);
    tick(60_000);
    expect(importer.importPending).not.toHaveBeenCalled();

    syncOnce();
    flushMicrotasks();
    expect(importer.importPending).toHaveBeenCalledTimes(1);
    tick(60_000);
  }));

  it('skips the run while another tab imports', fakeAsync(() => {
    isLockHeld = true;
    service.start();
    syncOnce();
    tick(60_000);
    expect(importer.importPending).not.toHaveBeenCalled();
  }));

  it('keeps importing after the lock request fails', fakeAsync(() => {
    lockError = new DOMException('opaque origin', 'SecurityError');
    spyOn(Log, 'err');
    service.start();
    syncOnce();
    tick(60_000);
    expect(importer.importPending).not.toHaveBeenCalled();

    lockError = null;
    syncOnce();
    flushMicrotasks();
    expect(importer.importPending).toHaveBeenCalledTimes(1);
    tick(60_000);
  }));

  it('treats a server without capture as nothing to import', fakeAsync(() => {
    importer.importPending.and.rejectWith(new CaptureUnsupportedError());
    const err = spyOn(Log, 'err');
    service.start();
    syncOnce();
    tick(60_000);
    expect(importer.importPending).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
  }));

  it('does not import while capture is off or another provider is active', fakeAsync(() => {
    service.start();
    syncCfg.set({ captureKey: null });
    syncOnce();
    tick(60_000);
    syncCfg.set({ captureKey: KEY });
    provider.id = SyncProviderId.WebDAV;
    syncOnce();
    tick(60_000);
    expect(importer.importPending).not.toHaveBeenCalled();
  }));

  it('keeps importing after a failed or fenced run', fakeAsync(() => {
    // Created lazily: an eager Promise.reject is an unhandled rejection.
    const outcomes: Array<() => Promise<NativeCaptureImportResult>> = [
      () => Promise.reject(new SyncEpochChangedError(1, 2, 'createTask')),
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ created: 1, invalid: 0 }),
    ];
    importer.importPending.and.callFake(() =>
      (outcomes.shift() as (typeof outcomes)[0])(),
    );
    service.start();
    for (let i = 0; i < 3; i++) {
      syncOnce();
      tick(60_000);
    }
    expect(importer.importPending).toHaveBeenCalledTimes(3);
  }));

  it('switches on with a fresh key registered first, then synced', async () => {
    await service.switchOn();
    expect(calls).toEqual(['register', 'update:key']);
    const [, cfg] = (
      TestBed.inject(GlobalConfigService).updateSection as jasmine.Spy
    ).calls.mostRecent().args;
    expect(provider.registerCaptureKey).toHaveBeenCalledWith(
      cfg.captureKey.publicKeySpki,
    );
  });

  it('switches off: disables the server key, then clears the synced key', async () => {
    await service.switchOff();
    expect(calls).toEqual(['disable', 'update:null']);
  });

  it('saves no key when the server refuses it (no capture on the server)', async () => {
    provider.registerCaptureKey.and.rejectWith(new Error('404'));
    await expectAsync(service.switchOn()).toBeRejected();
    expect(calls).toEqual([]);
  });

  it('skips importing with a key from a newer client', fakeAsync(() => {
    syncCfg.set({ captureKey: { ...KEY, v: 2 } });
    service.start();
    syncOnce();
    tick(60_000);
    expect(importer.importPending).not.toHaveBeenCalled();
  }));

  it('counts grant captures and Android shares as pending', async () => {
    provider.listCaptureGrants.and.resolveTo({
      grants: [{ pendingCount: 2 }, { pendingCount: 1 }],
      otherPendingCount: 4,
    });
    expect(await service.countPending()).toBe(7);
    // An older server sends no share count.
    provider.listCaptureGrants.and.resolveTo({ grants: [{ pendingCount: 2 }] });
    expect(await service.countPending()).toBe(2);
  });

  it('keeps the synced key when the server could not be told', async () => {
    provider.disableCaptureKey.and.rejectWith(new Error('offline'));
    await expectAsync(service.switchOff()).toBeRejected();
    expect(calls).toEqual([]);
  });
  describe('the run handed to the capture source', () => {
    // The source's only way in: it calls this at the start of each claim.
    const startRun = (): AgentCaptureRun | null =>
      (service as unknown as { _startRun: () => AgentCaptureRun | null })._startRun();

    it("schedules with this device's today and the user's reminder default", () => {
      globalCfg.set({
        timeTracking: { defaultEstimate: 900_000 },
        reminder: { defaultTaskRemindOption: TaskReminderOptionId.m10 },
      } as unknown as GlobalConfigState);
      expect(startRun()).toEqual(
        jasmine.objectContaining({
          todayStr: '2026-10-15',
          defaultEstimate: 900_000,
          defaultRemindOption: TaskReminderOptionId.m10,
        }),
      );
    });

    it('falls back to the app defaults before the config has loaded', () => {
      expect(startRun()).toEqual(
        jasmine.objectContaining({
          defaultEstimate: 0,
          defaultRemindOption: TaskReminderOptionId.AtStart,
        }),
      );
    });
  });
});
