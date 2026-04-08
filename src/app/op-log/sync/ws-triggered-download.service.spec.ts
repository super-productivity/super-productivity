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
import { AuthFailSPError, MissingCredentialsSPError } from '../sync-exports';

describe('WsTriggeredDownloadService', () => {
  let service: WsTriggeredDownloadService;
  let notification$: Subject<NewOpsNotification>;
  let mockWsService: Pick<SuperSyncWebSocketService, 'newOpsNotification$'>;
  let mockSyncService: jasmine.SpyObj<OperationLogSyncService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockWrappedProvider: jasmine.SpyObj<WrappedProviderService>;
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

    TestBed.configureTestingModule({
      providers: [
        WsTriggeredDownloadService,
        { provide: SuperSyncWebSocketService, useValue: mockWsService },
        { provide: OperationLogSyncService, useValue: mockSyncService },
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: WrappedProviderService, useValue: mockWrappedProvider },
      ],
    });

    service = TestBed.inject(WsTriggeredDownloadService);
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
});
