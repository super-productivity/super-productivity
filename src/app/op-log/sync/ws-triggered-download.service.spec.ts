import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  SuperSyncWebSocketService,
  type NewOpsNotification,
} from './super-sync-websocket.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { WrappedProviderService } from '../sync-providers/wrapped-provider.service';
import { WsTriggeredDownloadService } from './ws-triggered-download.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { SyncCycleGuardService } from './sync-cycle-guard.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { AuthFailSPError, MissingCredentialsSPError } from '../sync-exports';

describe('WsTriggeredDownloadService', () => {
  let service: WsTriggeredDownloadService;
  let notification$: Subject<NewOpsNotification>;
  let mockWsService: Pick<SuperSyncWebSocketService, 'newOpsNotification$'>;
  let mockSyncService: jasmine.SpyObj<OperationLogSyncService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockWrappedProvider: jasmine.SpyObj<WrappedProviderService>;
  let mockSyncWrapper: { isEncryptionOperationInProgress: boolean };
  let syncCapableProvider: any;

  beforeEach(() => {
    notification$ = new Subject<NewOpsNotification>();
    mockWsService = {
      newOpsNotification$: notification$.asObservable(),
    };

    syncCapableProvider = { id: 'sync-provider' };
    mockSyncService = jasmine.createSpyObj('OperationLogSyncService', [
      'downloadRemoteOps',
    ]);
    mockSyncService.downloadRemoteOps.and.returnValue(
      Promise.resolve({ kind: 'no_new_ops' as const }),
    );

    mockProviderManager = jasmine.createSpyObj(
      'SyncProviderManager',
      ['getActiveProvider'],
      {
        isSyncInProgress: false,
      },
    );
    mockProviderManager.getActiveProvider.and.returnValue({ id: 'raw-provider' } as any);

    mockWrappedProvider = jasmine.createSpyObj('WrappedProviderService', [
      'getOperationSyncCapable',
    ]);
    mockWrappedProvider.getOperationSyncCapable.and.returnValue(
      Promise.resolve(syncCapableProvider as any),
    );

    // Stub SyncWrapperService: the service reads `isEncryptionOperationInProgress`
    // off it lazily (via Injector, to avoid a DI cycle). Provide a minimal mock so
    // the real (heavily-dependent) service is never constructed in the unit test.
    mockSyncWrapper = { isEncryptionOperationInProgress: false };

    TestBed.configureTestingModule({
      providers: [
        WsTriggeredDownloadService,
        { provide: SuperSyncWebSocketService, useValue: mockWsService },
        { provide: OperationLogSyncService, useValue: mockSyncService },
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: WrappedProviderService, useValue: mockWrappedProvider },
        { provide: SyncWrapperService, useValue: mockSyncWrapper },
      ],
    });

    service = TestBed.inject(WsTriggeredDownloadService);
    // The cycle guard is a root singleton; reset it so a prior test that left
    // it claimed (e.g. an assertion threw before guard.end()) can't poison this
    // one. Mirrors SyncSessionValidationService's per-test reset.
    TestBed.inject(SyncCycleGuardService)._resetForTest();
  });

  afterEach(() => {
    service.stop();
  });

  it('should trigger a download after the debounce interval', fakeAsync(() => {
    service.start();
    notification$.next({ latestSeq: 1 });

    tick(500);
    flushMicrotasks();

    expect(mockWrappedProvider.getOperationSyncCapable).toHaveBeenCalled();
    expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledWith(syncCapableProvider);
  }));

  it('should debounce rapid notifications into a single download', fakeAsync(() => {
    service.start();
    notification$.next({ latestSeq: 1 });
    tick(250);
    notification$.next({ latestSeq: 2 });

    tick(499);
    flushMicrotasks();
    expect(mockSyncService.downloadRemoteOps).not.toHaveBeenCalled();

    tick(1);
    flushMicrotasks();

    expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledTimes(1);
  }));

  it('should skip downloads while sync is already in progress', fakeAsync(() => {
    mockProviderManager = TestBed.inject(
      SyncProviderManager,
    ) as jasmine.SpyObj<SyncProviderManager>;
    Object.defineProperty(mockProviderManager, 'isSyncInProgress', {
      get: () => true,
      configurable: true,
    });

    service.start();
    notification$.next({ latestSeq: 3 });
    tick(500);
    flushMicrotasks();

    expect(mockWrappedProvider.getOperationSyncCapable).not.toHaveBeenCalled();
    expect(mockSyncService.downloadRemoteOps).not.toHaveBeenCalled();
  }));

  // A WS download must not decrypt/apply remote ops while an encryption
  // operation (password change, enable/disable, force upload) owns the key
  // state — mirrors ImmediateUploadService gating on the same flag.
  it('should skip downloads while an encryption operation is in progress', fakeAsync(() => {
    mockSyncWrapper.isEncryptionOperationInProgress = true;

    service.start();
    notification$.next({ latestSeq: 9 });
    tick(500);
    flushMicrotasks();

    expect(mockWrappedProvider.getOperationSyncCapable).not.toHaveBeenCalled();
    expect(mockSyncService.downloadRemoteOps).not.toHaveBeenCalled();
  }));

  // #8309: the WS-download side channel claims the in-tab SyncCycleGuard and
  // skips when another cycle (main sync, force flow, or immediate upload) is
  // active, so its gate decision / setLastServerSeq can't race a concurrent
  // flow and overlapping withSession() calls can't misattribute the latch.
  it('should skip the download when another sync cycle is active (#8309)', fakeAsync(() => {
    const guard = TestBed.inject(SyncCycleGuardService);
    expect(guard.tryBegin()).toBe(true);

    service.start();
    notification$.next({ latestSeq: 7 });
    tick(500);
    flushMicrotasks();

    expect(mockWrappedProvider.getOperationSyncCapable).not.toHaveBeenCalled();
    expect(mockSyncService.downloadRemoteOps).not.toHaveBeenCalled();

    guard.end();
  }));

  it('releases the guard after the download so a later cycle can run (#8309)', fakeAsync(() => {
    const guard = TestBed.inject(SyncCycleGuardService);

    service.start();
    notification$.next({ latestSeq: 8 });
    tick(500);
    flushMicrotasks();

    expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledTimes(1);
    expect(guard.isActive).toBe(false);
  }));

  it('should stop listening after an auth failure', fakeAsync(() => {
    mockSyncService.downloadRemoteOps.and.callFake(async () => {
      throw new AuthFailSPError('unauthorized');
    });

    service.start();
    notification$.next({ latestSeq: 4 });
    tick(500);
    flushMicrotasks();

    notification$.next({ latestSeq: 5 });
    tick(500);
    flushMicrotasks();

    expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledTimes(1);
  }));

  it('should stop listening after a MissingCredentialsSPError', fakeAsync(() => {
    mockSyncService.downloadRemoteOps.and.callFake(async () => {
      throw new MissingCredentialsSPError('no creds');
    });

    service.start();
    notification$.next({ latestSeq: 1 });
    tick(500);
    flushMicrotasks();

    notification$.next({ latestSeq: 2 });
    tick(500);
    flushMicrotasks();

    expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledTimes(1);
  }));

  it('should survive non-auth errors and continue the pipeline', fakeAsync(() => {
    let callCount = 0;
    mockSyncService.downloadRemoteOps.and.callFake(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('network timeout');
      }
      return { kind: 'no_new_ops' as const };
    });

    service.start();
    notification$.next({ latestSeq: 1 });
    tick(500);
    flushMicrotasks();

    notification$.next({ latestSeq: 2 });
    tick(500);
    flushMicrotasks();

    expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledTimes(2);
  }));

  it('should be idempotent when start is called twice', fakeAsync(() => {
    service.start();
    service.start();

    notification$.next({ latestSeq: 1 });
    tick(500);
    flushMicrotasks();

    expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledTimes(1);
  }));

  // Codex review: WS-triggered downloads run outside the wrapper session
  // contract. Without an explicit reset+read here, validation failures
  // from realtime sync would be either silently dropped (next sync()'s
  // reset clears them) or leak into the next session. The service must
  // be its own session boundary.
  it('sets sync status ERROR when the download flips the validation latch', fakeAsync(() => {
    if (mockProviderManager.setSyncStatus === undefined) {
      mockProviderManager.setSyncStatus = jasmine.createSpy('setSyncStatus');
    }
    const latch = TestBed.inject(SyncSessionValidationService);
    mockSyncService.downloadRemoteOps.and.callFake(async () => {
      latch.setFailed();
      return { kind: 'ops_processed' as const, newOpsCount: 1, localWinOpsCreated: 0 };
    });

    service.start();
    notification$.next({ latestSeq: 1 });
    tick(500);
    flushMicrotasks();

    expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
  }));

  it('does not flag ERROR when the download leaves the latch reset', fakeAsync(() => {
    if (mockProviderManager.setSyncStatus === undefined) {
      mockProviderManager.setSyncStatus = jasmine.createSpy('setSyncStatus');
    }
    const latch = TestBed.inject(SyncSessionValidationService);
    latch._resetForTest();

    service.start();
    notification$.next({ latestSeq: 1 });
    tick(500);
    flushMicrotasks();

    expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('ERROR');
  }));

  // Defense against stale latch from a prior path: the WS service opens its
  // own session, which resets the latch up front so the read at the end
  // reflects only this session's outcome.
  it('resets the latch before each WS download', fakeAsync(() => {
    const latch = TestBed.inject(SyncSessionValidationService);
    // Directly seed stale state via the test-only helper, mirroring "a
    // prior session left the latch flipped." setFailed() outside a session
    // would log a warning, which we don't want in test output.
    latch._resetForTest();
    (latch as unknown as { _failed: boolean })._failed = true;

    service.start();
    notification$.next({ latestSeq: 1 });
    tick(500);
    flushMicrotasks();

    // After withSession's entry-reset and a clean download, the latch
    // should be back to false.
    expect(latch.hasFailed()).toBe(false);
  }));
});
