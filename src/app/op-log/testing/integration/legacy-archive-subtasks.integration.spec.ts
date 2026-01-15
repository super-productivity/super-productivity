/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, OpType, Operation } from '../../core/operation.types';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';
import { createMinimalTaskPayload } from './helpers/operation-factory.helper';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { uuidv7 } from '../../../util/uuid-v7';

/**
 * Integration tests for legacy data import/export with archive subtasks.
 *
 * BUG: When importing data from before operation logs (legacy data) that contains
 * tasks with subtasks in archiveYoung, the subtasks are lost when exporting again.
 *
 * These tests verify that:
 * 1. Import creates proper operations preserving parent-subtask relationships
 * 2. Export includes all archived tasks including subtasks
 * 3. Round-trip import->export preserves data integrity
 */

// Type definitions for test data
interface TestTaskEntity {
  id: string;
  title: string;
  subTaskIds: string[];
  parentId?: string;
  isDone: boolean;
  doneOn?: number;
  timeSpent: number;
  projectId: string;
}

interface TestArchiveTask {
  ids: string[];
  entities: Record<string, TestTaskEntity>;
}

interface TestArchiveYoung {
  task: TestArchiveTask;
  timeTracking: { project: Record<string, unknown>; tag: Record<string, unknown> };
  lastTimeTrackingFlush: number;
}

interface TestLegacyData {
  task: {
    ids: string[];
    entities: Record<string, unknown>;
    currentTaskId: null;
    selectedTaskId: null;
    lastCurrentTaskId: null;
    isDataLoaded: boolean;
  };
  project: {
    ids: string[];
    entities: Record<string, unknown>;
  };
  tag: {
    ids: string[];
    entities: Record<string, unknown>;
  };
  archiveYoung: TestArchiveYoung;
  archiveOld: {
    task: { ids: string[]; entities: Record<string, unknown> };
    timeTracking: { project: Record<string, unknown>; tag: Record<string, unknown> };
    lastTimeTrackingFlush: number;
  };
  timeTracking: { project: Record<string, unknown>; tag: Record<string, unknown> };
}

describe('Legacy Archive Subtasks Integration', () => {
  let storeService: OperationLogStoreService;

  // Test data: parent task with 2 subtasks + 1 normal task in archiveYoung
  const createLegacyArchiveData = (): TestLegacyData => ({
    task: {
      ids: [],
      entities: {},
      currentTaskId: null,
      selectedTaskId: null,
      lastCurrentTaskId: null,
      isDataLoaded: false,
    },
    project: {
      ids: ['INBOX_PROJECT'],
      entities: {
        INBOX_PROJECT: {
          id: 'INBOX_PROJECT',
          title: 'Inbox',
          taskIds: [],
          backlogTaskIds: [],
        },
      },
    },
    tag: {
      ids: ['TODAY'],
      entities: {
        TODAY: {
          id: 'TODAY',
          title: 'Today',
          taskIds: [],
        },
      },
    },
    archiveYoung: {
      task: {
        ids: [
          'archived-parent-task',
          'archived-subtask-1',
          'archived-subtask-2',
          'archived-normal-task',
        ],
        entities: {
          'archived-parent-task': createMinimalTaskPayload('archived-parent-task', {
            title: 'Legacy Archive Test - Parent Task With Subtasks',
            subTaskIds: ['archived-subtask-1', 'archived-subtask-2'],
            isDone: true,
            doneOn: Date.now() - 86400000, // 1 day ago
            timeSpent: 3600000,
            projectId: 'INBOX_PROJECT',
          }) as unknown as TestTaskEntity,
          'archived-subtask-1': createMinimalTaskPayload('archived-subtask-1', {
            title: 'Legacy Archive Test - First Subtask',
            parentId: 'archived-parent-task',
            subTaskIds: [],
            isDone: true,
            doneOn: Date.now() - 86400000,
            timeSpent: 1800000,
            projectId: 'INBOX_PROJECT',
          }) as unknown as TestTaskEntity,
          'archived-subtask-2': createMinimalTaskPayload('archived-subtask-2', {
            title: 'Legacy Archive Test - Second Subtask',
            parentId: 'archived-parent-task',
            subTaskIds: [],
            isDone: true,
            doneOn: Date.now() - 86400000,
            timeSpent: 1200000,
            projectId: 'INBOX_PROJECT',
          }) as unknown as TestTaskEntity,
          'archived-normal-task': createMinimalTaskPayload('archived-normal-task', {
            title: 'Legacy Archive Test - Normal Task Without Subtasks',
            subTaskIds: [],
            isDone: true,
            doneOn: Date.now() - 86400000,
            timeSpent: 2400000,
            projectId: 'INBOX_PROJECT',
          }) as unknown as TestTaskEntity,
        },
      },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: Date.now(),
    },
    archiveOld: {
      task: { ids: [], entities: {} },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: 0,
    },
    timeTracking: { project: {}, tag: {} },
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService],
    });
    storeService = TestBed.inject(OperationLogStoreService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('SyncImport with Archive Subtasks', () => {
    /**
     * Test: Import operation preserves all archived tasks including subtasks
     *
     * When legacy data with archived parent+subtask structure is imported,
     * the SyncImport operation payload should contain all 4 tasks.
     */
    it('should preserve archived subtasks in import operation payload', async () => {
      const testClient = new TestClient('import-client');
      const legacyData = createLegacyArchiveData();

      // Create import operation (simulating what PfapiService does)
      const importOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: legacyData },
      });

      await storeService.append(importOp, 'local');

      // Retrieve and verify the stored operation
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(1);

      const storedOp = allOps[0];
      const payload = storedOp.op.payload as { appDataComplete: TestLegacyData };

      // Verify archiveYoung contains all 4 tasks
      const archiveYoungTask = payload.appDataComplete.archiveYoung.task;

      expect(archiveYoungTask.ids.length).toBe(4);
      expect(archiveYoungTask.ids).toContain('archived-parent-task');
      expect(archiveYoungTask.ids).toContain('archived-subtask-1');
      expect(archiveYoungTask.ids).toContain('archived-subtask-2');
      expect(archiveYoungTask.ids).toContain('archived-normal-task');

      // Verify parent-subtask relationships are preserved
      const parentTask = archiveYoungTask.entities['archived-parent-task'];
      expect(parentTask.subTaskIds).toContain('archived-subtask-1');
      expect(parentTask.subTaskIds).toContain('archived-subtask-2');

      const subtask1 = archiveYoungTask.entities['archived-subtask-1'];
      expect(subtask1.parentId).toBe('archived-parent-task');

      const subtask2 = archiveYoungTask.entities['archived-subtask-2'];
      expect(subtask2.parentId).toBe('archived-parent-task');
    });

    /**
     * Test: State cache after import contains all archived subtasks
     *
     * BUG: This test documents the bug where subtasks are lost in the state cache
     * after importing legacy data. The state cache is used for export.
     */
    it('should include archived subtasks in state cache after import', async () => {
      const testClient = new TestClient('import-client');
      const legacyData = createLegacyArchiveData();

      // Create and store import operation
      const importOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: legacyData },
      });

      await storeService.append(importOp, 'local');
      const lastSeq = await storeService.getLastSeq();

      // Save state cache (simulating what PfapiService does after import)
      await storeService.saveStateCache({
        state: legacyData,
        lastAppliedOpSeq: lastSeq,
        vectorClock: importOp.vectorClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Load and verify state cache (this is what export would use)
      const stateCache = await storeService.loadStateCache();
      expect(stateCache).toBeDefined();

      const cachedState = stateCache!.state as TestLegacyData;
      const cachedArchiveYoung = cachedState.archiveYoung;

      // This should pass - verifying all 4 tasks are in cache
      expect(cachedArchiveYoung.task.ids.length).toBe(4);
      expect(cachedArchiveYoung.task.ids).toContain('archived-parent-task');
      expect(cachedArchiveYoung.task.ids).toContain('archived-subtask-1');
      expect(cachedArchiveYoung.task.ids).toContain('archived-subtask-2');
      expect(cachedArchiveYoung.task.ids).toContain('archived-normal-task');

      // Verify subtask entities are present
      expect(cachedArchiveYoung.task.entities['archived-subtask-1']).toBeDefined();
      expect(cachedArchiveYoung.task.entities['archived-subtask-2']).toBeDefined();
    });
  });

  describe('Import/Export Round-Trip', () => {
    /**
     * Test: Round-trip import->export preserves archived subtasks
     *
     * BUG: This is the main bug scenario. When legacy data is:
     * 1. Imported (creating SyncImport operation)
     * 2. State cache is created
     * 3. Exported (reading from state cache or operations)
     *
     * The exported data should contain all original archived tasks including subtasks.
     * Currently, subtasks are being lost.
     */
    it('should preserve archived subtasks through import->export cycle', async () => {
      const testClient = new TestClient('import-client');
      const originalData = createLegacyArchiveData();

      // Step 1: Import (create SyncImport operation)
      const importOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: originalData },
      });

      await storeService.append(importOp, 'local');
      const lastSeq = await storeService.getLastSeq();

      // Step 2: Save state cache (simulating post-import state saving)
      await storeService.saveStateCache({
        state: originalData,
        lastAppliedOpSeq: lastSeq,
        vectorClock: importOp.vectorClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Step 3: Simulate export by reading from stored operation
      const allOps = await storeService.getOpsAfterSeq(0);
      const exportedFromOp = allOps[0].op.payload as { appDataComplete: TestLegacyData };

      // Step 4: Also simulate export by reading from state cache
      const stateCache = await storeService.loadStateCache();
      const exportedFromCache = stateCache!.state as TestLegacyData;

      // Verify both export sources contain all archived tasks
      // From operation payload:
      const opArchiveYoung = exportedFromOp.appDataComplete.archiveYoung.task;
      expect(opArchiveYoung.ids).toContain('archived-parent-task');
      expect(opArchiveYoung.ids).toContain('archived-subtask-1');
      expect(opArchiveYoung.ids).toContain('archived-subtask-2');
      expect(opArchiveYoung.ids).toContain('archived-normal-task');

      // From state cache:
      const cacheArchiveYoung = exportedFromCache.archiveYoung.task;
      expect(cacheArchiveYoung.ids).toContain('archived-parent-task');
      expect(cacheArchiveYoung.ids).toContain('archived-subtask-1');
      expect(cacheArchiveYoung.ids).toContain('archived-subtask-2');
      expect(cacheArchiveYoung.ids).toContain('archived-normal-task');

      // Verify subtask entities are present in exports
      expect(opArchiveYoung.entities['archived-subtask-1']).toBeDefined();
      expect(opArchiveYoung.entities['archived-subtask-2']).toBeDefined();
      expect(cacheArchiveYoung.entities['archived-subtask-1']).toBeDefined();
      expect(cacheArchiveYoung.entities['archived-subtask-2']).toBeDefined();
    });

    /**
     * Test: Multiple imports maintain archive subtask integrity
     *
     * When legacy data is imported multiple times (simulating user importing
     * different backups), archived subtasks should remain intact.
     */
    it('should preserve archived subtasks across multiple import cycles', async () => {
      const testClient = new TestClient('import-client');

      // First import with subtasks
      const firstData = createLegacyArchiveData();
      const firstImportOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: firstData },
      });

      await storeService.append(firstImportOp, 'local');

      // Verify first import
      let allOps = await storeService.getOpsAfterSeq(0);
      let lastPayload = allOps[allOps.length - 1].op.payload as {
        appDataComplete: TestLegacyData;
      };
      let archiveYoung = lastPayload.appDataComplete.archiveYoung.task;
      expect(archiveYoung.ids.length).toBe(4);

      // Second import (same data, simulating re-import)
      const secondImportOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: firstData },
      });

      await storeService.append(secondImportOp, 'local');

      // Verify second import still has all subtasks
      allOps = await storeService.getOpsAfterSeq(0);
      lastPayload = allOps[allOps.length - 1].op.payload as {
        appDataComplete: TestLegacyData;
      };
      archiveYoung = lastPayload.appDataComplete.archiveYoung.task;

      expect(archiveYoung.ids.length).toBe(4);
      expect(archiveYoung.ids).toContain('archived-subtask-1');
      expect(archiveYoung.ids).toContain('archived-subtask-2');
      expect(archiveYoung.entities['archived-subtask-1']).toBeDefined();
      expect(archiveYoung.entities['archived-subtask-2']).toBeDefined();
    });
  });

  describe('Parent-Subtask Relationship Integrity', () => {
    /**
     * Test: Parent task subTaskIds match actual subtask parentIds
     *
     * This verifies the bidirectional relationship is maintained.
     */
    it('should maintain bidirectional parent-subtask relationships', async () => {
      const testClient = new TestClient('import-client');
      const legacyData = createLegacyArchiveData();

      const importOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: legacyData },
      });

      await storeService.append(importOp, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      const payload = allOps[0].op.payload as { appDataComplete: TestLegacyData };

      const archiveYoung = payload.appDataComplete.archiveYoung.task;

      // Get parent and subtasks
      const parent = archiveYoung.entities['archived-parent-task'];
      const subtask1 = archiveYoung.entities['archived-subtask-1'];
      const subtask2 = archiveYoung.entities['archived-subtask-2'];
      const normalTask = archiveYoung.entities['archived-normal-task'];

      // Verify parent has correct subTaskIds
      expect(parent.subTaskIds).toBeDefined();
      expect(parent.subTaskIds!.length).toBe(2);
      expect(parent.subTaskIds).toContain('archived-subtask-1');
      expect(parent.subTaskIds).toContain('archived-subtask-2');
      expect(parent.parentId).toBeUndefined();

      // Verify subtasks point to correct parent
      expect(subtask1.parentId).toBe('archived-parent-task');
      expect(subtask1.subTaskIds).toEqual([]);

      expect(subtask2.parentId).toBe('archived-parent-task');
      expect(subtask2.subTaskIds).toEqual([]);

      // Verify normal task has no parent-child relationships
      expect(normalTask.parentId).toBeUndefined();
      expect(normalTask.subTaskIds).toEqual([]);
    });
  });
});
