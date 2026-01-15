import { TestBed } from '@angular/core/testing';
import { OperationLogCompactionService } from './operation-log-compaction.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { LockService } from '../sync/lock.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { VectorClockService } from '../sync/vector-clock.service';
import {
  COMPACTION_RETENTION_MS,
  SLOW_COMPACTION_THRESHOLD_MS,
} from '../core/operation-log.const';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { OperationLogEntry } from '../core/operation.types';
import { OpLog } from '../../core/log';
import { MODEL_CONFIGS } from '../model/model-config';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('OperationLogCompactionService', () => {
  let service: OperationLogCompactionService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockStateSnapshot: jasmine.SpyObj<StateSnapshotService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;

  const mockState = {
    task: { entities: {}, ids: [] },
    project: { entities: {}, ids: [] },
    tag: { entities: {}, ids: [] },
  } as any;

  const mockVectorClock = { clientA: 10, clientB: 5 };

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'getLastSeq',
      'saveStateCache',
      'resetCompactionCounter',
      'deleteOpsWhere',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockStateSnapshot = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);

    // Mock OpLog methods
    spyOn(OpLog, 'warn');
    spyOn(OpLog, 'normal');

    // Default mock implementations
    mockLockService.request.and.callFake(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
      },
    );
    mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(100));
    mockOpLogStore.saveStateCache.and.returnValue(Promise.resolve());
    mockOpLogStore.resetCompactionCounter.and.returnValue(Promise.resolve());
    mockOpLogStore.deleteOpsWhere.and.returnValue(Promise.resolve());
    mockStateSnapshot.getStateSnapshot.and.returnValue(mockState);
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve(mockVectorClock),
    );

    TestBed.configureTestingModule({
      providers: [
        OperationLogCompactionService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        { provide: StateSnapshotService, useValue: mockStateSnapshot },
        { provide: VectorClockService, useValue: mockVectorClockService },
      ],
    });

    service = TestBed.inject(OperationLogCompactionService);
  });

  describe('compact', () => {
    it('should acquire lock before compaction', async () => {
      await service.compact();

      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should get current state from store delegate', async () => {
      await service.compact();

      expect(mockStateSnapshot.getStateSnapshot).toHaveBeenCalled();
    });

    it('should log metrics if compaction is slow', async () => {
      // Use jasmine.clock to control Date.now() without actual delays
      jasmine.clock().install();
      const baseTime = new Date(2024, 0, 1).getTime();
      jasmine.clock().mockDate(new Date(baseTime));

      // Mock saveStateCache to advance the clock, simulating slow operation
      mockOpLogStore.saveStateCache.and.callFake(async () => {
        // Advance the mocked Date.now() to simulate time passing
        jasmine.clock().mockDate(new Date(baseTime + SLOW_COMPACTION_THRESHOLD_MS + 100));
      });

      await service.compact();

      jasmine.clock().uninstall();

      expect(OpLog.normal).toHaveBeenCalledWith(
        'OperationLogCompactionService: Compaction completed',
        jasmine.objectContaining({
          durationMs: jasmine.any(Number),
          isEmergency: false,
        }),
      );
      const args = (OpLog.normal as jasmine.Spy).calls.mostRecent().args;
      expect(args[1].durationMs).toBeGreaterThan(SLOW_COMPACTION_THRESHOLD_MS);
    });

    it('should not log metrics if compaction is fast', async () => {
      await service.compact();

      expect(OpLog.normal).not.toHaveBeenCalled();
    });

    it('should get current vector clock', async () => {
      await service.compact();

      expect(mockVectorClockService.getCurrentVectorClock).toHaveBeenCalled();
    });

    it('should get last sequence number', async () => {
      await service.compact();

      expect(mockOpLogStore.getLastSeq).toHaveBeenCalled();
    });

    it('should save state cache with correct data', async () => {
      await service.compact();

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({
          state: mockState,
          lastAppliedOpSeq: 100,
          vectorClock: mockVectorClock,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }),
      );
    });

    it('should save state cache with compactedAt timestamp', async () => {
      const beforeTime = Date.now();
      await service.compact();
      const afterTime = Date.now();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.compactedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(savedCache.compactedAt).toBeLessThanOrEqual(afterTime);
    });

    it('should reset compaction counter after saving cache', async () => {
      await service.compact();

      expect(mockOpLogStore.resetCompactionCounter).toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledBefore(
        mockOpLogStore.resetCompactionCounter,
      );
    });

    it('should delete old operations with filter function', async () => {
      await service.compact();

      expect(mockOpLogStore.deleteOpsWhere).toHaveBeenCalledWith(jasmine.any(Function));
    });

    it('should not delete unsynced operations', async () => {
      let capturedFilter: ((entry: OperationLogEntry) => boolean) | undefined;
      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        capturedFilter = filterFn;
      });

      await service.compact();

      const unsyncedEntry: OperationLogEntry = {
        seq: 50,
        op: {} as any,
        appliedAt: Date.now() - COMPACTION_RETENTION_MS - 1000,
        source: 'local',
        syncedAt: undefined, // Not synced
      };

      expect(capturedFilter!(unsyncedEntry)).toBeFalse();
    });

    it('should not delete recently applied operations', async () => {
      let capturedFilter: ((entry: OperationLogEntry) => boolean) | undefined;
      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        capturedFilter = filterFn;
      });

      await service.compact();

      const recentEntry: OperationLogEntry = {
        seq: 50,
        op: {} as any,
        appliedAt: Date.now() - 1000, // Very recent
        source: 'remote',
        syncedAt: Date.now() - 1000,
      };

      expect(capturedFilter!(recentEntry)).toBeFalse();
    });

    it('should delete old synced operations', async () => {
      let capturedFilter: ((entry: OperationLogEntry) => boolean) | undefined;
      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        capturedFilter = filterFn;
      });

      await service.compact();

      const oldSyncedEntry: OperationLogEntry = {
        seq: 50,
        op: {} as any,
        appliedAt: Date.now() - COMPACTION_RETENTION_MS - 1000, // Old enough
        source: 'remote',
        syncedAt: Date.now() - COMPACTION_RETENTION_MS - 500,
      };

      expect(capturedFilter!(oldSyncedEntry)).toBeTrue();
    });

    it('should not delete operations with seq greater than lastSeq', async () => {
      mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(100));

      let capturedFilter: ((entry: OperationLogEntry) => boolean) | undefined;
      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        capturedFilter = filterFn;
      });

      await service.compact();

      const futureSeqEntry: OperationLogEntry = {
        seq: 101, // Greater than lastSeq
        op: {} as any,
        appliedAt: Date.now() - COMPACTION_RETENTION_MS - 1000,
        source: 'remote',
        syncedAt: Date.now() - COMPACTION_RETENTION_MS - 500,
      };

      expect(capturedFilter!(futureSeqEntry)).toBeFalse();
    });

    it('should handle empty state', async () => {
      mockStateSnapshot.getStateSnapshot.and.returnValue({} as any);

      await service.compact();

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({ state: {} }),
      );
    });

    it('should handle empty vector clock', async () => {
      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

      await service.compact();

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({ vectorClock: {} }),
      );
    });

    it('should handle sequence number of 0', async () => {
      mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(0));

      await service.compact();

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({ lastAppliedOpSeq: 0 }),
      );
    });

    it('should execute all steps within the lock', async () => {
      const callOrder: string[] = [];

      mockLockService.request.and.callFake(
        async (_name: string, fn: () => Promise<void>) => {
          callOrder.push('lock-start');
          await fn();
          callOrder.push('lock-end');
        },
      );

      mockStateSnapshot.getStateSnapshot.and.callFake((() => {
        callOrder.push('getState');
        return mockState;
      }) as any);

      mockVectorClockService.getCurrentVectorClock.and.callFake(async () => {
        callOrder.push('getVectorClock');
        return mockVectorClock;
      });

      mockOpLogStore.getLastSeq.and.callFake(async () => {
        callOrder.push('getLastSeq');
        return 100;
      });

      mockOpLogStore.saveStateCache.and.callFake(async () => {
        callOrder.push('saveStateCache');
      });

      mockOpLogStore.resetCompactionCounter.and.callFake(async () => {
        callOrder.push('resetCompactionCounter');
      });

      mockOpLogStore.deleteOpsWhere.and.callFake(async () => {
        callOrder.push('deleteOpsWhere');
      });

      await service.compact();

      // All operations should happen between lock-start and lock-end
      const lockStartIndex = callOrder.indexOf('lock-start');
      const lockEndIndex = callOrder.indexOf('lock-end');

      expect(callOrder.indexOf('getState')).toBeGreaterThan(lockStartIndex);
      expect(callOrder.indexOf('getState')).toBeLessThan(lockEndIndex);
      expect(callOrder.indexOf('saveStateCache')).toBeGreaterThan(lockStartIndex);
      expect(callOrder.indexOf('saveStateCache')).toBeLessThan(lockEndIndex);
      expect(callOrder.indexOf('deleteOpsWhere')).toBeGreaterThan(lockStartIndex);
      expect(callOrder.indexOf('deleteOpsWhere')).toBeLessThan(lockEndIndex);
    });

    it('should propagate errors from saveStateCache', async () => {
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('IndexedDB write failed'));

      await expectAsync(service.compact()).toBeRejectedWithError(
        'IndexedDB write failed',
      );
    });

    it('should propagate errors from vector clock service', async () => {
      mockVectorClockService.getCurrentVectorClock.and.rejectWith(
        new Error('Clock read failed'),
      );

      await expectAsync(service.compact()).toBeRejectedWithError('Clock read failed');
    });

    it('should propagate errors from state delegate', async () => {
      mockStateSnapshot.getStateSnapshot.and.throwError(new Error('State read failed'));

      await expectAsync(service.compact()).toBeRejectedWithError('State read failed');
    });
  });

  describe('emergencyCompact', () => {
    it('should return true on successful compaction', async () => {
      const result = await service.emergencyCompact();
      expect(result).toBeTrue();
    });

    it('should log metrics (including isEmergency: true) for emergency compaction', async () => {
      await service.emergencyCompact();

      expect(OpLog.normal).toHaveBeenCalledWith(
        'OperationLogCompactionService: Compaction completed',
        jasmine.objectContaining({
          isEmergency: true,
        }),
      );
    });

    it('should return false when compaction fails', async () => {
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('Storage full'));

      const result = await service.emergencyCompact();

      expect(result).toBeFalse();
    });

    it('should use shorter retention window than regular compaction', async () => {
      let capturedFilter: ((entry: OperationLogEntry) => boolean) | undefined;
      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        capturedFilter = filterFn;
      });

      await service.emergencyCompact();

      // Create an entry that's 2 days old (would be kept by regular compaction,
      // but deleted by emergency compaction which uses 1-day retention)
      const twoDaysMs = 2 * MS_PER_DAY;
      const twoDaysAgo = Date.now() - twoDaysMs;
      const entry: OperationLogEntry = {
        seq: 50,
        op: {} as any,
        appliedAt: twoDaysAgo,
        source: 'remote',
        syncedAt: twoDaysAgo,
      };

      expect(capturedFilter!(entry)).toBeTrue();
    });

    it('should still protect unsynced operations during emergency compaction', async () => {
      let capturedFilter: ((entry: OperationLogEntry) => boolean) | undefined;
      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        capturedFilter = filterFn;
      });

      await service.emergencyCompact();

      const tenDaysMs = 10 * MS_PER_DAY;
      const oldUnsyncedEntry: OperationLogEntry = {
        seq: 50,
        op: {} as any,
        appliedAt: Date.now() - tenDaysMs, // 10 days old
        source: 'local',
        syncedAt: undefined, // Not synced!
      };

      expect(capturedFilter!(oldUnsyncedEntry)).toBeFalse();
    });

    it('should acquire lock during emergency compaction', async () => {
      await service.emergencyCompact();

      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should return false when lock acquisition fails', async () => {
      mockLockService.request.and.rejectWith(new Error('Lock timeout'));

      const result = await service.emergencyCompact();

      expect(result).toBeFalse();
    });

    it('should catch and log errors without throwing', async () => {
      mockOpLogStore.getLastSeq.and.rejectWith(new Error('Database corrupted'));

      // Should not throw, just return false
      const result = await service.emergencyCompact();

      expect(result).toBeFalse();
    });

    it('should complete all phases during emergency compaction', async () => {
      await service.emergencyCompact();

      expect(mockStateSnapshot.getStateSnapshot).toHaveBeenCalled();
      expect(mockVectorClockService.getCurrentVectorClock).toHaveBeenCalled();
      expect(mockOpLogStore.getLastSeq).toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).toHaveBeenCalled();
      expect(mockOpLogStore.resetCompactionCounter).toHaveBeenCalled();
      expect(mockOpLogStore.deleteOpsWhere).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Snapshot entity keys extraction tests
  // =========================================================================
  // These tests verify that compaction extracts and stores entity keys from
  // the state snapshot. This is critical for conflict detection to distinguish
  // between entities that existed at compaction time vs new entities.

  describe('snapshotEntityKeys extraction', () => {
    it('should include snapshotEntityKeys in saved state cache', async () => {
      const stateWithEntities = {
        task: { ids: ['task-1', 'task-2'], entities: {} },
        project: { ids: ['proj-1'], entities: {} },
        tag: { ids: [], entities: {} },
        note: { ids: ['note-1'], entities: {} },
        globalConfig: { someConfig: true },
        planner: { days: [] },
        reminders: [{ id: 'reminder-1' }],
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithEntities);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toBeDefined();
      expect(Array.isArray(savedCache.snapshotEntityKeys)).toBeTrue();
    });

    it('should extract TASK entity keys from state', async () => {
      const stateWithTasks = {
        task: { ids: ['task-1', 'task-2', 'task-3'], entities: {} },
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithTasks);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toContain('TASK:task-1');
      expect(savedCache.snapshotEntityKeys).toContain('TASK:task-2');
      expect(savedCache.snapshotEntityKeys).toContain('TASK:task-3');
    });

    it('should extract PROJECT entity keys from state', async () => {
      const stateWithProjects = {
        project: { ids: ['proj-a', 'proj-b'], entities: {} },
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithProjects);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toContain('PROJECT:proj-a');
      expect(savedCache.snapshotEntityKeys).toContain('PROJECT:proj-b');
    });

    it('should extract TAG entity keys from state', async () => {
      const stateWithTags = {
        tag: { ids: ['tag-1'], entities: {} },
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithTags);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toContain('TAG:tag-1');
    });

    it('should extract REMINDER entity keys from reminders array', async () => {
      const stateWithReminders = {
        reminders: [{ id: 'rem-1' }, { id: 'rem-2' }],
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithReminders);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toContain('REMINDER:rem-1');
      expect(savedCache.snapshotEntityKeys).toContain('REMINDER:rem-2');
    });

    it('should extract singleton entity keys (GLOBAL_CONFIG, PLANNER, etc)', async () => {
      const stateWithSingletons = {
        globalConfig: { someConfig: true },
        planner: { days: [] },
        menuTree: { items: [] },
        timeTracking: { entries: {} },
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithSingletons);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toContain('GLOBAL_CONFIG:GLOBAL_CONFIG');
      expect(savedCache.snapshotEntityKeys).toContain('PLANNER:PLANNER');
      expect(savedCache.snapshotEntityKeys).toContain('MENU_TREE:MENU_TREE');
      expect(savedCache.snapshotEntityKeys).toContain('TIME_TRACKING:TIME_TRACKING');
    });

    it('should extract archived task entity keys', async () => {
      const stateWithArchive = {
        archiveYoung: { task: { ids: ['archived-task-1'], entities: {} } },
        archiveOld: { task: { ids: ['old-archived-task'], entities: {} } },
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithArchive);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      // Archived tasks should be tracked as TASK entities
      expect(savedCache.snapshotEntityKeys).toContain('TASK:archived-task-1');
      expect(savedCache.snapshotEntityKeys).toContain('TASK:old-archived-task');
    });

    it('should handle empty state gracefully', async () => {
      mockStateSnapshot.getStateSnapshot.and.returnValue({} as any);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toBeDefined();
      expect(savedCache.snapshotEntityKeys!.length).toBe(0);
    });

    it('should handle state with empty ids arrays', async () => {
      const stateWithEmptyIds = {
        task: { ids: [], entities: {} },
        project: { ids: [], entities: {} },
        reminders: [],
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(stateWithEmptyIds);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      // Should have no entity keys (but should not throw)
      expect(savedCache.snapshotEntityKeys).toBeDefined();
      const taskKeys = savedCache.snapshotEntityKeys!.filter((k: string) =>
        k.startsWith('TASK:'),
      );
      expect(taskKeys.length).toBe(0);
    });

    it('should extract entity keys for ALL models defined in MODEL_CONFIGS', async () => {
      // 1. Create a complete mock state with one item for every model type
      const completeState: any = {};

      // Helper to generate mock data for each model type
      Object.keys(MODEL_CONFIGS).forEach((modelKey) => {
        const key = modelKey as keyof typeof MODEL_CONFIGS;

        if (key === 'reminders') {
          completeState[key] = [{ id: 'reminder-1' }];
        } else if (key === 'boards') {
          completeState[key] = { boardCfgs: [{ id: 'board-1' }] };
        } else if (key === 'archiveYoung' || key === 'archiveOld') {
          completeState[key] = { task: { ids: [`${key}-task-1`], entities: {} } };
        } else if (
          key === 'globalConfig' ||
          key === 'planner' ||
          key === 'menuTree' ||
          key === 'timeTracking'
        ) {
          completeState[key] = { someData: true }; // Singleton existence check
        } else if (key === 'pluginUserData') {
          completeState[key] = [{ id: 'plugin-user-1' }];
        } else if (key === 'pluginMetadata') {
          completeState[key] = [{ id: 'plugin-meta-1' }];
        } else {
          // Standard entity adapter models (task, project, etc.)
          completeState[key] = { ids: [`${key}-1`], entities: {} };
        }
      });

      mockStateSnapshot.getStateSnapshot.and.returnValue(completeState);

      // 2. Run compaction
      await service.compact();

      // 3. Verify that we got at least one key for every model type
      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      const extractedKeys = new Set(savedCache.snapshotEntityKeys);

      // Define expected entity types for each model key
      const modelToEntityType: Record<string, string> = {
        task: 'TASK',
        project: 'PROJECT',
        tag: 'TAG',
        note: 'NOTE',
        issueProvider: 'ISSUE_PROVIDER',
        simpleCounter: 'SIMPLE_COUNTER',
        taskRepeatCfg: 'TASK_REPEAT_CFG',
        metric: 'METRIC',
        reminders: 'REMINDER',
        boards: 'BOARD',
        globalConfig: 'GLOBAL_CONFIG',
        planner: 'PLANNER',
        menuTree: 'MENU_TREE',
        timeTracking: 'TIME_TRACKING',
        archiveYoung: 'TASK', // Archives map to TASK
        archiveOld: 'TASK', // Archives map to TASK
        pluginUserData: 'PLUGIN_USER_DATA',
        pluginMetadata: 'PLUGIN_METADATA',
      };

      const missingModels: string[] = [];

      Object.keys(MODEL_CONFIGS).forEach((modelKey) => {
        const expectedPrefix = modelToEntityType[modelKey];
        if (!expectedPrefix) {
          fail(
            `Test setup error: No expected EntityType defined for model '${modelKey}'`,
          );
        }

        const hasKey = Array.from(extractedKeys).some((k) =>
          k.startsWith(expectedPrefix + ':'),
        );
        if (!hasKey) {
          missingModels.push(modelKey);
        }
      });

      if (missingModels.length > 0) {
        fail(
          `snapshotEntityKeys extraction is missing support for models: ${missingModels.join(', ')}. \n` +
            `Update _extractEntityKeysFromState in OperationLogCompactionService to handle these models.`,
        );
      }
    });

    it('should correctly extract keys when state contains only a subset of models (incomplete data)', async () => {
      // Create state with only Task, Tag, and PluginUserData populated
      const partialState = {
        task: { ids: ['t1'], entities: { t1: {} } },
        tag: { ids: ['tag1'], entities: { tag1: {} } },
        pluginUserData: [{ id: 'pud1', data: 'xyz' }],
        // explicit undefined/missing for others
        project: undefined,
        note: { ids: [], entities: {} }, // empty but defined
      } as any;

      mockStateSnapshot.getStateSnapshot.and.returnValue(partialState);

      await service.compact();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      const extractedKeys = new Set(savedCache.snapshotEntityKeys);

      // Should contain
      expect(extractedKeys.has('TASK:t1')).toBeTrue();
      expect(extractedKeys.has('TAG:tag1')).toBeTrue();
      expect(extractedKeys.has('PLUGIN_USER_DATA:pud1')).toBeTrue();

      // Should NOT contain
      const projectKeys = Array.from(extractedKeys).filter((k: string) =>
        k.startsWith('PROJECT:'),
      );
      expect(projectKeys.length).toBe(0);

      const noteKeys = Array.from(extractedKeys).filter((k: string) =>
        k.startsWith('NOTE:'),
      );
      expect(noteKeys.length).toBe(0);
    });
  });

  // =========================================================================
  // Race condition tests
  // =========================================================================
  // These tests verify behavior when concurrent operations occur during compaction.
  // The compaction service uses locks to prevent data corruption, and these tests
  // verify that the locking mechanism works correctly.

  describe('race conditions', () => {
    it('should request lock for every compact call', async () => {
      // This test verifies that every compact() call requests the lock.
      // The actual serialization happens in the LockService (tested separately in lock.service.spec.ts).
      const lockRequests: string[] = [];

      mockLockService.request.and.callFake(
        async (_name: string, fn: () => Promise<void>) => {
          lockRequests.push('lock-requested');
          await fn();
        },
      );

      // Call compact 3 times sequentially
      await service.compact();
      await service.compact();
      await service.compact();

      // Lock should have been requested 3 times
      expect(lockRequests.length).toBe(3);
    });

    it('should always request lock with correct name', async () => {
      await service.compact();

      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should use lastSeq captured before deleteOpsWhere to protect new ops', async () => {
      // Simulate a new operation being written after getLastSeq but before deleteOpsWhere
      let capturedLastSeq: number | undefined;
      let deleteFilterFn: ((entry: OperationLogEntry) => boolean) | undefined;

      mockOpLogStore.getLastSeq.and.callFake(async () => {
        capturedLastSeq = 100;
        return 100;
      });

      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        deleteFilterFn = filterFn;
      });

      await service.compact();

      // Verify lastSeq was captured
      expect(capturedLastSeq).toBe(100);

      // Simulate a new operation written after getLastSeq (seq 101)
      const newOpAfterSnapshot: OperationLogEntry = {
        seq: 101, // Written after getLastSeq returned 100
        op: {} as any,
        appliedAt: Date.now() - COMPACTION_RETENTION_MS - 1000, // Old enough to delete
        source: 'local',
        syncedAt: Date.now() - COMPACTION_RETENTION_MS - 500, // Synced
      };

      // The filter should NOT delete this op because seq > lastSeq
      expect(deleteFilterFn!(newOpAfterSnapshot)).toBeFalse();

      // But an op with seq <= lastSeq and old enough should be deleted
      const oldOpBeforeSnapshot: OperationLogEntry = {
        seq: 99,
        op: {} as any,
        appliedAt: Date.now() - COMPACTION_RETENTION_MS - 1000,
        source: 'remote',
        syncedAt: Date.now() - COMPACTION_RETENTION_MS - 500,
      };
      expect(deleteFilterFn!(oldOpBeforeSnapshot)).toBeTrue();
    });

    it('should handle concurrent compact and emergencyCompact calls', async () => {
      const callOrder: string[] = [];

      mockLockService.request.and.callFake(
        async (_name: string, fn: () => Promise<void>) => {
          callOrder.push('lock-start');
          await fn();
          callOrder.push('lock-end');
        },
      );

      // Launch both regular and emergency compaction concurrently
      const [regularResult, emergencyResult] = await Promise.all([
        service.compact().then(() => 'regular-done'),
        service
          .emergencyCompact()
          .then((success) => (success ? 'emergency-done' : 'emergency-failed')),
      ]);

      // Both should complete
      expect(regularResult).toBe('regular-done');
      expect(emergencyResult).toBe('emergency-done');

      // Lock should have been acquired twice (serialized)
      expect(callOrder.filter((c) => c === 'lock-start').length).toBe(2);
    });

    it('should not delete operations that arrive during compaction', async () => {
      // This test verifies the TOCTOU protection:
      // 1. getLastSeq() returns 100
      // 2. New op with seq 101 arrives (simulated)
      // 3. deleteOpsWhere should NOT delete seq 101

      const operationsInStore: OperationLogEntry[] = [
        {
          seq: 99,
          op: { id: 'op-99' } as any,
          appliedAt: Date.now() - COMPACTION_RETENTION_MS - 2000,
          source: 'remote',
          syncedAt: Date.now() - COMPACTION_RETENTION_MS - 1000,
        },
        {
          seq: 100,
          op: { id: 'op-100' } as any,
          appliedAt: Date.now() - COMPACTION_RETENTION_MS - 1000,
          source: 'remote',
          syncedAt: Date.now() - COMPACTION_RETENTION_MS - 500,
        },
        // This op "arrives" during compaction (seq > lastSeq when getLastSeq was called)
        {
          seq: 101,
          op: { id: 'op-101' } as any,
          appliedAt: Date.now() - COMPACTION_RETENTION_MS - 500,
          source: 'local',
          syncedAt: Date.now() - COMPACTION_RETENTION_MS - 100,
        },
      ];

      mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(100));

      const deletedSeqs: number[] = [];
      mockOpLogStore.deleteOpsWhere.and.callFake(async (filterFn) => {
        for (const entry of operationsInStore) {
          if (filterFn(entry)) {
            deletedSeqs.push(entry.seq);
          }
        }
      });

      await service.compact();

      // seq 99 and 100 should be eligible for deletion (old, synced, seq <= lastSeq)
      expect(deletedSeqs).toContain(99);
      expect(deletedSeqs).toContain(100);

      // seq 101 should NOT be deleted (seq > lastSeq at time of check)
      expect(deletedSeqs).not.toContain(101);
    });

    it('should complete all steps atomically within the lock', async () => {
      // Verify that if saveStateCache fails, subsequent steps don't run
      const callOrder: string[] = [];

      mockLockService.request.and.callFake(
        async (_name: string, fn: () => Promise<void>) => {
          callOrder.push('lock-acquired');
          try {
            await fn();
          } finally {
            callOrder.push('lock-released');
          }
        },
      );

      mockOpLogStore.saveStateCache.and.callFake(async () => {
        callOrder.push('saveStateCache');
        throw new Error('Simulated failure');
      });

      mockOpLogStore.resetCompactionCounter.and.callFake(async () => {
        callOrder.push('resetCompactionCounter');
      });

      mockOpLogStore.deleteOpsWhere.and.callFake(async () => {
        callOrder.push('deleteOpsWhere');
      });

      await expectAsync(service.compact()).toBeRejectedWithError('Simulated failure');

      // Lock should have been acquired and released
      expect(callOrder).toContain('lock-acquired');
      expect(callOrder).toContain('lock-released');

      // saveStateCache was called
      expect(callOrder).toContain('saveStateCache');

      // But subsequent steps should NOT have been called
      expect(callOrder).not.toContain('resetCompactionCounter');
      expect(callOrder).not.toContain('deleteOpsWhere');
    });
  });

  // =========================================================================
  // Compaction timeout tests
  // =========================================================================
  // These tests verify compaction handles timeout scenarios gracefully
  // to prevent data corruption from lock expiration.

  describe('compaction timeout handling', () => {
    it('should throw error when compaction exceeds timeout', async () => {
      // Simulate slow state retrieval that exceeds the 25s timeout
      const originalDateNow = Date.now;
      let callCount = 0;

      // Mock Date.now to simulate time passing during compaction
      spyOn(Date, 'now').and.callFake(() => {
        callCount++;
        // First call is startTime, subsequent calls simulate 26s elapsed
        if (callCount === 1) {
          return 0;
        }
        return 26000; // 26 seconds - exceeds 25s timeout
      });

      // Make state retrieval trigger a timeout check
      mockStateSnapshot.getStateSnapshot.and.returnValue(mockState);

      await expectAsync(service.compact()).toBeRejectedWithError(
        /Compaction timeout after.*Aborting to prevent lock expiration/,
      );

      // Restore original Date.now
      (Date.now as jasmine.Spy).and.callFake(originalDateNow);
    });

    it('should not throw when compaction completes within timeout', async () => {
      // Normal operation should complete without timeout
      mockStateSnapshot.getStateSnapshot.and.returnValue(mockState);

      await expectAsync(service.compact()).toBeResolved();
    });

    it('should include phase info in timeout error message', async () => {
      let callCount = 0;

      spyOn(Date, 'now').and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return 0;
        }
        return 26000;
      });

      mockStateSnapshot.getStateSnapshot.and.returnValue(mockState);

      try {
        await service.compact();
        fail('Expected error to be thrown');
      } catch (e: any) {
        expect(e.message).toContain('during');
        expect(e.message).toContain('Consider reducing state size');
      }
    });
  });
});
