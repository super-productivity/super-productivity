import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { OperationLogDownloadService } from './operation-log-download.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from './lock.service';
import { SnackService } from '../../core/snack/snack.service';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { ActionType, OpType } from '../core/operation.types';
import { CLOCK_DRIFT_THRESHOLD_MS } from '../core/operation-log.const';
import { OpLog } from '../../core/log';
import { T } from '../../t.const';

describe('OperationLogDownloadService', () => {
  let service: OperationLogDownloadService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'getAppliedOpIds',
      'hasSyncedOps',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

    // Mock OpLog
    spyOn(OpLog, 'warn');
    spyOn(OpLog, 'normal');

    // Default mock implementations
    mockLockService.request.and.callFake(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
      },
    );
    mockOpLogStore.getAppliedOpIds.and.returnValue(Promise.resolve(new Set<string>()));
    mockOpLogStore.hasSyncedOps.and.returnValue(Promise.resolve(false));

    TestBed.configureTestingModule({
      providers: [
        OperationLogDownloadService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        { provide: SnackService, useValue: mockSnackService },
      ],
    });

    service = TestBed.inject(OperationLogDownloadService);
  });

  describe('downloadRemoteOps', () => {
    it('should return empty result when no sync provider', async () => {
      const result = await service.downloadRemoteOps(null as any);

      expect(result).toEqual({ newOps: [], success: false, failedFileCount: 0 });
    });

    describe('API-based sync', () => {
      let mockApiProvider: jasmine.SpyObj<
        SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
      >;

      beforeEach(() => {
        mockApiProvider = jasmine.createSpyObj('ApiSyncProvider', [
          'getLastServerSeq',
          'downloadOps',
          'setLastServerSeq',
        ]);
        (mockApiProvider as any).supportsOperationSync = true;
        // Add privateCfg mock for E2E encryption support
        (mockApiProvider as any).privateCfg = {
          load: jasmine
            .createSpy('privateCfg.load')
            .and.returnValue(Promise.resolve(null)),
        };

        mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        );
      });

      it('should use API download for operation-sync-capable providers', async () => {
        await service.downloadRemoteOps(mockApiProvider);

        expect(mockApiProvider.downloadOps).toHaveBeenCalled();
      });

      it('should detect and warn about clock drift after retry', fakeAsync(() => {
        const driftMs = CLOCK_DRIFT_THRESHOLD_MS + 60000; // Threshold + 1 min
        const serverCurrentTime = Date.now() - driftMs; // Server clock is behind

        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: serverCurrentTime,
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: Date.now(),
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 1,
            // Server's current time (this is what we check for clock drift)
            serverTime: serverCurrentTime,
          }),
        );

        service.downloadRemoteOps(mockApiProvider);
        tick(); // Resolve promises

        // Warning should not be shown immediately
        expect(OpLog.warn).not.toHaveBeenCalled();

        // After 1 second retry, warning should appear
        tick(1000);

        expect(OpLog.warn).toHaveBeenCalledWith(
          'OperationLogDownloadService: Clock drift detected',
          jasmine.objectContaining({
            driftMinutes: jasmine.any(String),
            direction: 'client ahead',
          }),
        );
        expect(mockSnackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'ERROR',
            msg: T.F.SYNC.S.CLOCK_DRIFT_WARNING,
          }),
        );
      }));

      it('should not warn if clock drift resolves after retry', fakeAsync(() => {
        const driftMs = CLOCK_DRIFT_THRESHOLD_MS + 60000; // Initial drift exceeds threshold
        const initialTime = Date.now();
        const serverCurrentTime = initialTime - driftMs;

        // Track Date.now() calls to simulate clock correction
        let dateNowCallCount = 0;
        spyOn(Date, 'now').and.callFake(() => {
          dateNowCallCount++;
          // First call (initial check): return time with drift
          // Subsequent calls (after retry): return corrected time (close to server time)
          if (dateNowCallCount <= 2) {
            return initialTime; // Initial check shows drift
          }
          // After "clock correction", drift is now within threshold
          return serverCurrentTime + 60000; // Only 1 minute drift
        });

        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: serverCurrentTime,
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: initialTime,
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 1,
            serverTime: serverCurrentTime,
          }),
        );

        service.downloadRemoteOps(mockApiProvider);
        tick(); // Resolve promises
        tick(1000); // Wait for retry

        // Should NOT warn because drift resolved after retry
        expect(OpLog.warn).not.toHaveBeenCalled();
        expect(mockSnackService.open).not.toHaveBeenCalled();
      }));

      it('should not warn about clock drift if within threshold', async () => {
        const smallDriftMs = CLOCK_DRIFT_THRESHOLD_MS - 60000; // Threshold - 1 min
        const serverTime = Date.now() - smallDriftMs;

        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: serverTime,
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: Date.now(),
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 1,
          }),
        );

        await service.downloadRemoteOps(mockApiProvider);

        expect(OpLog.warn).not.toHaveBeenCalled();
        expect(mockSnackService.open).not.toHaveBeenCalled();
      });

      it('should only warn about clock drift once per session', fakeAsync(() => {
        const driftMs = CLOCK_DRIFT_THRESHOLD_MS + 60000; // Threshold + 1 min
        const serverCurrentTime = Date.now() - driftMs;

        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: serverCurrentTime,
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: Date.now(),
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 1,
            serverTime: serverCurrentTime,
          }),
        );

        // First call - should warn after retry
        service.downloadRemoteOps(mockApiProvider);
        tick(); // Resolve promises
        tick(1000); // Wait for retry
        expect(OpLog.warn).toHaveBeenCalledTimes(1);

        // Second call - should NOT warn again
        service.downloadRemoteOps(mockApiProvider);
        tick(); // Resolve promises
        tick(1000); // Wait for retry (if any)
        expect(OpLog.warn).toHaveBeenCalledTimes(1);
      }));

      it('should NOT warn about clock drift when operations are just old (not actual drift)', fakeAsync(() => {
        // BUG FIX TEST: The old implementation compared Date.now() with receivedAt
        // (when the op was uploaded). If ops are 12 hours old, it would incorrectly
        // warn about "clock drift" even though clocks are synchronized.
        //
        // The fix: Use serverTime from the response (server's current time) instead
        // of receivedAt (when the op was uploaded).
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
        const twelveHoursAgo = Date.now() - TWELVE_HOURS_MS;

        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: twelveHoursAgo, // Op was uploaded 12 hours ago
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: twelveHoursAgo,
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 1,
            // Server's current time is NOW (no drift)
            serverTime: Date.now(),
          }),
        );

        service.downloadRemoteOps(mockApiProvider);
        tick(); // Resolve promises
        tick(1000); // Wait for retry

        // Should NOT warn - there's no actual clock drift, ops are just old
        expect(OpLog.warn).not.toHaveBeenCalled();
        expect(mockSnackService.open).not.toHaveBeenCalled();
      }));

      it('should warn about clock drift using serverTime from response', fakeAsync(() => {
        // When server sends its current time and it differs significantly from
        // client time, we should warn about clock drift
        const driftMs = CLOCK_DRIFT_THRESHOLD_MS + 60000; // 6 minutes drift
        const serverCurrentTime = Date.now() - driftMs; // Server clock is 6 min behind

        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: serverCurrentTime - 1000, // Op was received 1 sec before response
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: serverCurrentTime - 1000,
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 1,
            serverTime: serverCurrentTime, // Server's current time
          }),
        );

        service.downloadRemoteOps(mockApiProvider);
        tick(); // Resolve promises
        tick(1000); // Wait for retry

        // Should warn because serverTime differs from client time
        expect(OpLog.warn).toHaveBeenCalledWith(
          'OperationLogDownloadService: Clock drift detected',
          jasmine.objectContaining({
            driftMinutes: jasmine.any(String),
            direction: 'client ahead',
          }),
        );
      }));

      it('should skip clock drift check when serverTime is not provided (backwards compatibility)', fakeAsync(() => {
        // Old servers may not provide serverTime. In this case, we should NOT
        // check clock drift at all because using receivedAt would give false positives.
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
        const twelveHoursAgo = Date.now() - TWELVE_HOURS_MS;

        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: twelveHoursAgo, // Old op
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: twelveHoursAgo,
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 1,
            // serverTime is NOT provided (old server)
          }),
        );

        service.downloadRemoteOps(mockApiProvider);
        tick(); // Resolve promises
        tick(1000); // Wait for potential retry

        // Should NOT warn - no serverTime means we can't reliably detect drift
        expect(OpLog.warn).not.toHaveBeenCalled();
        expect(mockSnackService.open).not.toHaveBeenCalled();
      }));

      it('should acquire lock before downloading', async () => {
        await service.downloadRemoteOps(mockApiProvider);

        expect(mockLockService.request).toHaveBeenCalledWith(
          'sp_op_log_download',
          jasmine.any(Function),
        );
      });

      it('should download operations with pagination', async () => {
        mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
        mockApiProvider.downloadOps.and.returnValues(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: Date.now(),
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: Date.now(),
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: true,
            latestSeq: 2,
          }),
          Promise.resolve({
            ops: [
              {
                serverSeq: 2,
                receivedAt: Date.now(),
                op: {
                  id: 'op-2',
                  clientId: 'c1',
                  actionType: '[Task] Update' as ActionType,
                  opType: OpType.Update,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: Date.now(),
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 2,
          }),
        );

        const result = await service.downloadRemoteOps(mockApiProvider);

        expect(result.newOps.length).toBe(2);
        expect(mockApiProvider.downloadOps).toHaveBeenCalledTimes(2);
      });

      it('should filter already applied operations', async () => {
        mockOpLogStore.getAppliedOpIds.and.returnValue(
          Promise.resolve(new Set(['op-1'])),
        );
        mockApiProvider.downloadOps.and.returnValue(
          Promise.resolve({
            ops: [
              {
                serverSeq: 1,
                receivedAt: Date.now(),
                op: {
                  id: 'op-1',
                  clientId: 'c1',
                  actionType: '[Task] Add' as ActionType,
                  opType: OpType.Create,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: Date.now(),
                  schemaVersion: 1,
                },
              },
              {
                serverSeq: 2,
                receivedAt: Date.now(),
                op: {
                  id: 'op-2',
                  clientId: 'c1',
                  actionType: '[Task] Update' as ActionType,
                  opType: OpType.Update,
                  entityType: 'TASK',
                  payload: {},
                  vectorClock: {},
                  timestamp: Date.now(),
                  schemaVersion: 1,
                },
              },
            ],
            hasMore: false,
            latestSeq: 2,
          }),
        );

        const result = await service.downloadRemoteOps(mockApiProvider);

        expect(result.newOps.length).toBe(1);
        expect(result.newOps[0].id).toBe('op-2');
      });

      it('should return success true for API sync', async () => {
        const result = await service.downloadRemoteOps(mockApiProvider);

        expect(result.success).toBeTrue();
        expect(result.failedFileCount).toBe(0);
      });

      describe('forceFromSeq0 option', () => {
        it('should download from seq 0 when forceFromSeq0 is true', async () => {
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(100));
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: { c1: 1 },
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 1,
            }),
          );

          await service.downloadRemoteOps(mockApiProvider, { forceFromSeq0: true });

          // Should start from 0, not from lastServerSeq (100)
          expect(mockApiProvider.downloadOps).toHaveBeenCalledWith(0, undefined, 500);
        });

        it('should collect all op clocks when forceFromSeq0 is true', async () => {
          const clock1: Record<string, number> = { clientA: 1 };
          const clock2: Record<string, number> = { clientA: 1, clientB: 1 };
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: clock1,
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
                {
                  serverSeq: 2,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-2',
                    clientId: 'c2',
                    actionType: '[Task] Update' as ActionType,
                    opType: OpType.Update,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: clock2,
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 2,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider, {
            forceFromSeq0: true,
          });

          expect(result.allOpClocks).toBeDefined();
          expect(result.allOpClocks!.length).toBe(2);
          expect(result.allOpClocks![0]).toEqual({ clientA: 1 });
          expect(result.allOpClocks![1]).toEqual({ clientA: 1, clientB: 1 });
        });

        it('should include clocks from duplicate ops that are filtered out', async () => {
          // Mark op-1 as already applied
          mockOpLogStore.getAppliedOpIds.and.returnValue(
            Promise.resolve(new Set(['op-1'])),
          );

          const clock1: Record<string, number> = { clientA: 5 };
          const clock2: Record<string, number> = { clientA: 5, clientB: 1 };
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1', // Already applied - will be filtered from newOps
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: clock1, // Important clock data
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
                {
                  serverSeq: 2,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-2', // New op
                    clientId: 'c2',
                    actionType: '[Task] Update' as ActionType,
                    opType: OpType.Update,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: clock2,
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 2,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider, {
            forceFromSeq0: true,
          });

          // newOps should only contain the non-duplicate
          expect(result.newOps.length).toBe(1);
          expect(result.newOps[0].id).toBe('op-2');

          // But allOpClocks should include BOTH clocks
          expect(result.allOpClocks!.length).toBe(2);
          expect(result.allOpClocks![0]).toEqual({ clientA: 5 });
          expect(result.allOpClocks![1]).toEqual({ clientA: 5, clientB: 1 });
        });

        it('should not include allOpClocks when forceFromSeq0 is false', async () => {
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: { clientA: 1 },
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 1,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.allOpClocks).toBeUndefined();
        });

        it('should return empty allOpClocks array when no ops on server', async () => {
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider, {
            forceFromSeq0: true,
          });

          // No ops means no clocks to collect
          expect(result.allOpClocks).toBeUndefined();
        });
      });

      describe('snapshotVectorClock handling', () => {
        it('should capture snapshotVectorClock from first response', async () => {
          const snapshotClock = { clientA: 10, clientB: 5, clientC: 3 };
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 317,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-317',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: { c1: 1 },
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 317,
              snapshotVectorClock: snapshotClock,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.snapshotVectorClock).toEqual(snapshotClock);
        });

        it('should return snapshotVectorClock even when no new ops', async () => {
          const snapshotClock = { clientA: 10, clientB: 5 };
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 316,
              snapshotVectorClock: snapshotClock,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.snapshotVectorClock).toEqual(snapshotClock);
          expect(result.newOps.length).toBe(0);
        });

        it('should capture snapshotVectorClock from first page in paginated download', async () => {
          const snapshotClock = { clientA: 10, clientB: 5 };
          mockApiProvider.downloadOps.and.returnValues(
            // First page - has snapshotVectorClock
            Promise.resolve({
              ops: [
                {
                  serverSeq: 317,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-317',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: { c1: 1 },
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: true,
              latestSeq: 320,
              snapshotVectorClock: snapshotClock,
            }),
            // Second page - no snapshotVectorClock (only first response has it)
            Promise.resolve({
              ops: [
                {
                  serverSeq: 318,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-318',
                    clientId: 'c2',
                    actionType: '[Task] Update' as ActionType,
                    opType: OpType.Update,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: { c2: 1 },
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 320,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          // Should have captured snapshotVectorClock from first response
          expect(result.snapshotVectorClock).toEqual(snapshotClock);
          expect(result.newOps.length).toBe(2);
        });

        it('should not have snapshotVectorClock when server does not send it', async () => {
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: { c1: 1 },
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 1,
              // No snapshotVectorClock
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.snapshotVectorClock).toBeUndefined();
        });

        it('should clear snapshotVectorClock when gap is detected and re-downloading', async () => {
          const staleSnapshotClock = { clientA: 5 };
          const freshSnapshotClock = { clientA: 10, clientB: 3 };

          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(100));
          mockApiProvider.downloadOps.and.returnValues(
            // First response: gap detected with stale clock
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 50,
              gapDetected: true,
              snapshotVectorClock: staleSnapshotClock,
            }),
            // After reset: fresh clock
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: { c1: 1 },
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 50,
              snapshotVectorClock: freshSnapshotClock,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          // Should have the fresh clock from after the reset
          expect(result.snapshotVectorClock).toEqual(freshSnapshotClock);
        });

        it('should work with forceFromSeq0 option and return snapshotVectorClock', async () => {
          const snapshotClock = { clientA: 100, clientB: 50 };
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(500));
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 316,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-316',
                    clientId: 'c1',
                    actionType: '[All] Sync Import' as ActionType,
                    opType: 'SYNC_IMPORT' as OpType,
                    entityType: 'ALL',
                    payload: {},
                    vectorClock: snapshotClock,
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 316,
              snapshotVectorClock: snapshotClock,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider, {
            forceFromSeq0: true,
          });

          expect(result.snapshotVectorClock).toEqual(snapshotClock);
          expect(result.allOpClocks).toBeDefined();
          expect(result.allOpClocks!.length).toBe(1);
        });
      });

      describe('gap detection handling', () => {
        it('should reset lastServerSeq to 0 when gap is detected', async () => {
          // First call returns gap detected (client has stale sinceSeq)
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(100));
          mockApiProvider.downloadOps.and.returnValues(
            // First response: gap detected, no ops
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 3,
              gapDetected: true,
            }),
            // Second response after reset: ops from beginning
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: {},
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 3,
              gapDetected: false,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          // Should have re-downloaded after detecting gap (caller is responsible for persisting lastServerSeq)
          expect(mockApiProvider.downloadOps).toHaveBeenCalledTimes(2);
          expect(result.newOps.length).toBe(1);
          // latestServerSeq is returned for caller to persist AFTER storing ops
          expect(result.latestServerSeq).toBe(3);
        });

        it('should only reset once per download session to prevent infinite loops', async () => {
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(100));
          // Both responses report gap - should only reset once
          mockApiProvider.downloadOps.and.returnValues(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0,
              gapDetected: true,
            }),
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0,
              gapDetected: true, // Still reports gap after reset
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          // Should have exited after second download (no infinite loop)
          expect(mockApiProvider.downloadOps).toHaveBeenCalledTimes(2);
          // Download service no longer calls setLastServerSeq directly - caller handles persistence
          expect(mockApiProvider.setLastServerSeq).not.toHaveBeenCalled();
          // latestServerSeq is returned for caller to persist
          expect(result.latestServerSeq).toBe(0);
        });

        it('should clear accumulated ops when gap is detected mid-download', async () => {
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
          mockApiProvider.downloadOps.and.returnValues(
            // First page: some ops
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-stale',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: {},
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: true,
              latestSeq: 10,
              gapDetected: false,
            }),
            // Second page: gap detected (shouldn't happen normally but test the logic)
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 5,
              gapDetected: true,
            }),
            // After reset: fresh ops
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-fresh',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: {},
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 5,
              gapDetected: false,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          // Should only contain the fresh op, not the stale one
          expect(result.newOps.length).toBe(1);
          expect(result.newOps[0].id).toBe('op-fresh');
        });

        it('should return latestServerSeq even when no ops are returned', async () => {
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 5, // Server has ops but none new for us
              gapDetected: false,
            }),
          );

          const result = await service.downloadRemoteOps(mockApiProvider);

          // Download service returns latestServerSeq for caller to persist
          // (caller will persist it after storing any ops to IndexedDB)
          expect(result.latestServerSeq).toBe(5);
          // Download service no longer calls setLastServerSeq directly
          expect(mockApiProvider.setLastServerSeq).not.toHaveBeenCalled();
        });
      });

      describe('server migration detection for file-based providers', () => {
        it('should set needsFullStateUpload when empty server AND first connect AND has synced ops', async () => {
          // Scenario: User switches from SuperSync to Dropbox
          // - Server is empty (no sync-data.json file)
          // - First time connecting (lastServerSeq === 0)
          // - Client has previously synced ops (from SuperSync)
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0, // Empty server
            }),
          );
          // Client has synced ops from previous provider
          mockOpLogStore.hasSyncedOps.and.returnValue(Promise.resolve(true));

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.needsFullStateUpload).toBeTrue();
          expect(OpLog.normal).toHaveBeenCalledWith(
            jasmine.stringContaining(
              'Server migration detected - empty server with synced ops',
            ),
          );
        });

        it('should NOT set needsFullStateUpload when empty server AND first connect AND NO synced ops', async () => {
          // Scenario: Fresh client connecting for the first time
          // - Server is empty
          // - First time connecting
          // - No previous sync history (fresh client)
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0,
            }),
          );
          // Client has NO synced ops (fresh client)
          mockOpLogStore.hasSyncedOps.and.returnValue(Promise.resolve(false));

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.needsFullStateUpload).toBeFalsy();
        });

        it('should NOT set needsFullStateUpload when server has data', async () => {
          // Scenario: Joining existing sync group
          // - Server has ops
          // - Client may or may not have synced ops - irrelevant
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [
                {
                  serverSeq: 1,
                  receivedAt: Date.now(),
                  op: {
                    id: 'op-1',
                    clientId: 'c1',
                    actionType: '[Task] Add' as ActionType,
                    opType: OpType.Create,
                    entityType: 'TASK',
                    payload: {},
                    vectorClock: {},
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMore: false,
              latestSeq: 1,
            }),
          );
          mockOpLogStore.hasSyncedOps.and.returnValue(Promise.resolve(true));

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.needsFullStateUpload).toBeFalsy();
        });

        it('should NOT set needsFullStateUpload when already synced with this server (server has data)', async () => {
          // Scenario: Regular sync with already-connected server
          // - lastServerSeq > 0 means we've synced before
          // - Server has data (latestSeq > 0)
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(50)); // Already synced
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 50, // Server has data
            }),
          );
          mockOpLogStore.hasSyncedOps.and.returnValue(Promise.resolve(true));

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.needsFullStateUpload).toBeFalsy();
        });

        it('should set needsFullStateUpload when server was reset (previously synced, now empty)', async () => {
          // Scenario: User previously synced with Dropbox, then cleared the Dropbox folder
          // - lastServerSeq > 0 (had previous sync)
          // - Server is now empty (user deleted sync-data.json)
          // - Client has synced ops
          // This is a server reset scenario - need full state upload
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(100)); // Had previous sync
          mockApiProvider.downloadOps.and.returnValue(
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0, // Server is empty now
            }),
          );
          mockOpLogStore.hasSyncedOps.and.returnValue(Promise.resolve(true));

          const result = await service.downloadRemoteOps(mockApiProvider);

          expect(result.needsFullStateUpload).toBeTrue();
          expect(OpLog.normal).toHaveBeenCalledWith(
            jasmine.stringContaining(
              'Server migration detected - empty server with synced ops',
            ),
          );
        });

        it('should NOT set needsFullStateUpload if gapDetected migration already triggered', async () => {
          // Scenario: API-based provider with gap detection
          // The gapDetected path should take precedence
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(100));
          mockApiProvider.downloadOps.and.returnValues(
            // Gap detected on empty server - triggers migration via hasResetForGap path
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0,
              gapDetected: true,
            }),
            // After reset, still empty
            Promise.resolve({
              ops: [],
              hasMore: false,
              latestSeq: 0,
            }),
          );
          mockOpLogStore.hasSyncedOps.and.returnValue(Promise.resolve(true));

          const result = await service.downloadRemoteOps(mockApiProvider);

          // Should have been triggered by the gapDetected path, not the alternative path
          expect(result.needsFullStateUpload).toBeTrue();
          // The warning should mention the gap-based detection
          expect(OpLog.warn).toHaveBeenCalledWith(
            jasmine.stringContaining('gap on empty server'),
          );
        });
      });
    });
  });
});
