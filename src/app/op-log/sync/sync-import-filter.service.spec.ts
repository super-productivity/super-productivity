import { TestBed } from '@angular/core/testing';
import { SyncImportFilterService } from './sync-import-filter.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { MAX_VECTOR_CLOCK_SIZE } from '../core/operation-log.const';

describe('SyncImportFilterService', () => {
  let service: SyncImportFilterService;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;

  // Helper to create operations with UUIDv7-style IDs (lexicographically sortable by time)
  const createOp = (partial: Partial<Operation>): Operation => ({
    id: '019afd68-0000-7000-0000-000000000000', // Default UUIDv7 format
    actionType: '[Test] Action' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'entity-1',
    payload: {},
    clientId: 'client-A',
    vectorClock: { clientA: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    ...partial,
  });

  beforeEach(() => {
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getLatestFullStateOp',
      'getLatestFullStateOpEntry',
    ]);
    // By default, no full-state ops in store
    opLogStoreSpy.getLatestFullStateOp.and.returnValue(Promise.resolve(undefined));
    opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(Promise.resolve(undefined));

    TestBed.configureTestingModule({
      providers: [
        SyncImportFilterService,
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
      ],
    });

    service = TestBed.inject(SyncImportFilterService);
  });

  describe('filterOpsInvalidatedBySyncImport', () => {
    it('should return all ops as valid when no SYNC_IMPORT is present', async () => {
      const ops: Operation[] = [
        createOp({ id: '019afd68-0001-7000-0000-000000000000', opType: OpType.Update }),
        createOp({ id: '019afd68-0002-7000-0000-000000000000', opType: OpType.Create }),
        createOp({ id: '019afd68-0003-7000-0000-000000000000', opType: OpType.Delete }),
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(ops);

      expect(result.validOps.length).toBe(3);
      expect(result.invalidatedOps.length).toBe(0);
    });

    it('should keep SYNC_IMPORT operation itself as valid', async () => {
      const syncImportOp = createOp({
        id: '019afd68-0050-7000-0000-000000000000',
        opType: OpType.SyncImport,
        clientId: 'client-B',
      });

      const result = await service.filterOpsInvalidatedBySyncImport([syncImportOp]);

      expect(result.validOps.length).toBe(1);
      expect(result.validOps[0].opType).toBe(OpType.SyncImport);
      expect(result.invalidatedOps.length).toBe(0);
    });

    it('should filter out ops from OTHER clients created BEFORE SYNC_IMPORT', async () => {
      const ops: Operation[] = [
        // Client A's op created BEFORE the import - LESS_THAN import's clock
        createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-A',
          entityId: 'task-1',
          vectorClock: { clientA: 2 }, // LESS_THAN import's clock
        }),
        // Client B's SYNC_IMPORT with higher clock
        createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientA: 5, clientB: 3 }, // Import has knowledge of clientA up to 5
        }),
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(ops);

      // SYNC_IMPORT is valid, Client A's earlier op is invalidated (LESS_THAN)
      expect(result.validOps.length).toBe(1);
      expect(result.validOps[0].opType).toBe(OpType.SyncImport);
      expect(result.invalidatedOps.length).toBe(1);
      expect(result.invalidatedOps[0].clientId).toBe('client-A');
    });

    it('should filter pre-import ops from the SAME client as SYNC_IMPORT', async () => {
      const ops: Operation[] = [
        // Client B's op created BEFORE the import - LESS_THAN import's clock
        createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-B',
          entityId: 'task-1',
          vectorClock: { clientB: 2 }, // LESS_THAN import's clock
        }),
        // Client B's SYNC_IMPORT
        createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientB: 5 }, // Import's clock
        }),
        // Client B's ops after the import - GREATER_THAN import's clock
        createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'client-B',
          entityId: 'task-2',
          vectorClock: { clientB: 6 }, // GREATER_THAN import's clock (B saw import first)
        }),
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(ops);

      // Only SYNC_IMPORT and post-import ops should be valid
      expect(result.validOps.length).toBe(2);
      expect(result.validOps.map((op) => op.id)).toContain(
        '019afd68-0050-7000-0000-000000000000',
      ); // SYNC_IMPORT
      expect(result.validOps.map((op) => op.id)).toContain(
        '019afd68-0100-7000-0000-000000000000',
      ); // Post-import

      expect(result.invalidatedOps.length).toBe(1);
      expect(result.invalidatedOps[0].id).toBe('019afd68-0001-7000-0000-000000000000'); // Pre-import
    });

    it('should preserve ops from OTHER clients created AFTER SYNC_IMPORT (by vector clock)', async () => {
      const ops: Operation[] = [
        // Client B's SYNC_IMPORT
        createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientB: 5 }, // Import's clock
        }),
        // Client A's op created AFTER seeing the import - GREATER_THAN
        createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-A',
          entityId: 'task-1',
          vectorClock: { clientA: 1, clientB: 5 }, // A saw import (has B's clock), then created op
        }),
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(ops);

      // Both should be valid - Client A's op was created after seeing the import
      expect(result.validOps.length).toBe(2);
      expect(result.invalidatedOps.length).toBe(0);
    });

    it('should handle BACKUP_IMPORT the same way as SYNC_IMPORT', async () => {
      const ops: Operation[] = [
        // Client A's op created BEFORE the backup import - LESS_THAN
        createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-A',
          entityId: 'task-1',
          vectorClock: { clientA: 2 }, // LESS_THAN import's clock
        }),
        // Client B's BACKUP_IMPORT
        createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.BackupImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientA: 5, clientB: 3 }, // Import dominates A's clock
        }),
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(ops);

      expect(result.validOps.length).toBe(1);
      expect(result.validOps[0].opType).toBe(OpType.BackupImport);
      expect(result.invalidatedOps.length).toBe(1);
      expect(result.invalidatedOps[0].clientId).toBe('client-A');
    });

    it('should use the LATEST import when multiple imports exist', async () => {
      const ops: Operation[] = [
        // Client A's early op - CONCURRENT with latest import (no knowledge of imports)
        createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-A',
          entityId: 'task-1',
          vectorClock: { clientA: 1 }, // CONCURRENT with latest import
        }),
        // First SYNC_IMPORT from Client B
        createOp({
          id: '019afd68-0010-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientB: 1 },
        }),
        // Client A's op between the two imports - still CONCURRENT with latest
        createOp({
          id: '019afd68-0020-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-A',
          entityId: 'task-2',
          vectorClock: { clientA: 2, clientB: 1 }, // Saw first import but CONCURRENT with second
        }),
        // Second SYNC_IMPORT from Client C (latest)
        createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-C',
          entityType: 'ALL',
          vectorClock: { clientB: 1, clientC: 1 }, // Latest import's clock
        }),
        // Client A's op after the latest import - GREATER_THAN (includes latest import's clock)
        createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-A',
          entityId: 'task-3',
          vectorClock: { clientA: 3, clientB: 1, clientC: 1 }, // GREATER_THAN latest import
        }),
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(ops);

      // Clean Slate Semantics: Only ops with knowledge of the latest import are kept.
      // - First two Client A ops are CONCURRENT (no knowledge of latest import) → filtered
      // - Third Client A op is GREATER_THAN (has latest import's clock) → kept
      // - Both SYNC_IMPORTs are kept
      expect(result.validOps.length).toBe(3); // 2 imports + 1 post-import op
      expect(result.invalidatedOps.length).toBe(2); // 2 concurrent ops from Client A
    });

    it('should filter pre-import ops when SYNC_IMPORT was downloaded in a PREVIOUS sync cycle', async () => {
      // Set up the store to have a SYNC_IMPORT from a previous sync
      const existingSyncImport: Operation = {
        id: '019afd68-0050-7000-0000-000000000000',
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: 'import-1',
        payload: { appDataComplete: {} },
        clientId: 'client-B',
        vectorClock: { clientB: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Return as an entry (remote + synced = already accepted import)
      opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
        Promise.resolve({
          seq: 1,
          op: existingSyncImport,
          source: 'remote',
          syncedAt: Date.now(),
          appliedAt: Date.now(),
        }),
      );

      // These are OLD ops from Client A, created BEFORE the import
      // They are CONCURRENT with the import (no knowledge of it)
      const oldOpsFromClientA: Operation[] = [
        {
          id: '019afd60-0001-7000-0000-000000000000',
          actionType: '[Task] Update Task' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Old title' },
          clientId: 'client-A',
          vectorClock: { clientA: 5 }, // CONCURRENT - no knowledge of import
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        {
          id: '019afd60-0002-7000-0000-000000000000',
          actionType: '[Task] Update Task' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-2',
          payload: { title: 'Another old title' },
          clientId: 'client-A',
          vectorClock: { clientA: 6 }, // CONCURRENT - no knowledge of import
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(oldOpsFromClientA);

      // Clean Slate Semantics: CONCURRENT ops are filtered, even from unknown clients.
      // These ops have no knowledge of the import, so they're invalidated.
      expect(result.validOps.length).toBe(0);
      expect(result.invalidatedOps.length).toBe(2);
      expect(opLogStoreSpy.getLatestFullStateOpEntry).toHaveBeenCalled();
    });

    it('should keep post-import ops when SYNC_IMPORT was downloaded in a PREVIOUS sync cycle', async () => {
      const existingSyncImport: Operation = {
        id: '019afd68-0050-7000-0000-000000000000',
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: 'import-1',
        payload: { appDataComplete: {} },
        clientId: 'client-B',
        vectorClock: { clientB: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Return as an entry (remote + synced = already accepted import)
      opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
        Promise.resolve({
          seq: 1,
          op: existingSyncImport,
          source: 'remote',
          syncedAt: Date.now(),
          appliedAt: Date.now(),
        }),
      );

      // These ops are created AFTER the import - client A saw the import (includes clientB: 1)
      const newOpsFromClientA: Operation[] = [
        {
          id: '019afd70-0001-7000-0000-000000000000',
          actionType: '[Task] Update Task' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'New title' },
          clientId: 'client-A',
          vectorClock: { clientB: 1, clientA: 7 }, // GREATER_THAN import
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ];

      const result = await service.filterOpsInvalidatedBySyncImport(newOpsFromClientA);

      // Op should be valid because it has knowledge of the import
      expect(result.validOps.length).toBe(1);
      expect(result.invalidatedOps.length).toBe(0);
    });

    describe('vector clock based filtering', () => {
      it('should filter CONCURRENT ops (client had no knowledge of import)', async () => {
        const ops: Operation[] = [
          {
            id: '019afd70-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Offline change' },
            clientId: 'client-B',
            vectorClock: { clientA: 2, clientB: 3 }, // CONCURRENT with import
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          {
            id: '019afd68-0050-7000-0000-000000000000',
            actionType: '[SP_ALL] Load(import) all data' as ActionType,
            opType: OpType.SyncImport,
            entityType: 'ALL',
            entityId: 'import-1',
            payload: { appDataComplete: {} },
            clientId: 'client-A',
            vectorClock: { clientA: 5 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        // Clean Slate Semantics: CONCURRENT ops are filtered, even from unknown clients.
        // Client B's op has no knowledge of the import, so it's invalidated.
        expect(result.validOps.length).toBe(1); // Only SYNC_IMPORT
        expect(result.invalidatedOps.length).toBe(1); // Client B's concurrent op
      });

      it('should filter LESS_THAN ops (dominated by import)', async () => {
        const ops: Operation[] = [
          {
            id: '019afd60-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Old change' },
            clientId: 'client-A',
            vectorClock: { clientA: 2 }, // LESS_THAN import's clock
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          {
            id: '019afd68-0050-7000-0000-000000000000',
            actionType: '[SP_ALL] Load(import) all data' as ActionType,
            opType: OpType.SyncImport,
            entityType: 'ALL',
            entityId: 'import-1',
            payload: { appDataComplete: {} },
            clientId: 'client-B',
            vectorClock: { clientA: 5, clientB: 3 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        expect(result.validOps.length).toBe(1);
        expect(result.validOps[0].opType).toBe(OpType.SyncImport);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should keep GREATER_THAN ops (created after seeing import)', async () => {
        const ops: Operation[] = [
          {
            id: '019afd68-0050-7000-0000-000000000000',
            actionType: '[SP_ALL] Load(import) all data' as ActionType,
            opType: OpType.SyncImport,
            entityType: 'ALL',
            entityId: 'import-1',
            payload: { appDataComplete: {} },
            clientId: 'client-A',
            vectorClock: { clientA: 5 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          {
            id: '019afd70-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Post-import change' },
            clientId: 'client-B',
            vectorClock: { clientA: 5, clientB: 1 }, // GREATER_THAN
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        expect(result.validOps.length).toBe(2);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should keep EQUAL ops (same causal history as import)', async () => {
        const ops: Operation[] = [
          {
            id: '019afd68-0050-7000-0000-000000000000',
            actionType: '[SP_ALL] Load(import) all data' as ActionType,
            opType: OpType.SyncImport,
            entityType: 'ALL',
            entityId: 'import-1',
            payload: { appDataComplete: {} },
            clientId: 'client-A',
            vectorClock: { clientA: 5, clientB: 3 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          {
            id: '019afd68-0051-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Same-clock change' },
            clientId: 'client-B',
            vectorClock: { clientA: 5, clientB: 3 }, // EQUAL to import
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        expect(result.validOps.length).toBe(2);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should filter ops even if client clock was ahead (clock drift regression)', async () => {
        const ops: Operation[] = [
          {
            // UUIDv7 timestamp is AFTER the import (client clock was ahead!)
            id: '019afd80-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Clock-drift change' },
            clientId: 'client-B',
            vectorClock: { clientA: 2, clientB: 3 }, // But vector clock shows no knowledge of import!
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          {
            id: '019afd68-0050-7000-0000-000000000000',
            actionType: '[SP_ALL] Load(import) all data' as ActionType,
            opType: OpType.SyncImport,
            entityType: 'ALL',
            entityId: 'import-1',
            payload: { appDataComplete: {} },
            clientId: 'client-A',
            vectorClock: { clientA: 5 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        // Clean Slate Semantics: CONCURRENT ops are filtered based on vector clock,
        // NOT UUIDv7 timestamp. Even though UUIDv7 is later, vector clock shows
        // no knowledge of import, so it's filtered.
        expect(result.validOps.length).toBe(1); // Only SYNC_IMPORT
        expect(result.invalidatedOps.length).toBe(1); // Client B's concurrent op
      });

      it('should handle REPAIR operations the same as SYNC_IMPORT', async () => {
        const ops: Operation[] = [
          {
            id: '019afd60-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Old change' },
            clientId: 'client-B',
            vectorClock: { clientA: 2, clientB: 3 }, // CONCURRENT with repair
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          {
            id: '019afd68-0050-7000-0000-000000000000',
            actionType: '[OpLog] Repair' as ActionType,
            opType: OpType.Repair,
            entityType: 'ALL',
            entityId: 'repair-1',
            payload: { appDataComplete: {} },
            clientId: 'client-A',
            vectorClock: { clientA: 5 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        // Clean Slate Semantics: REPAIR ops are handled the same as SYNC_IMPORT.
        // CONCURRENT ops are filtered, even from unknown clients.
        expect(result.validOps.length).toBe(1); // Only REPAIR
        expect(result.invalidatedOps.length).toBe(1); // Client B's concurrent op
      });
    });

    describe('vector clock merge fix verification', () => {
      /**
       * These tests verify the bug fix for the vector clock merge issue.
       *
       * THE BUG:
       * When a client receives and applies a SYNC_IMPORT, the local vector clock
       * was NOT being updated to include the import's clock entries. This caused
       * subsequent local operations to have vector clocks that were CONCURRENT
       * with the import instead of GREATER_THAN, leading to incorrect filtering.
       *
       * THE FIX:
       * After applying remote operations (including SYNC_IMPORT), we now call
       * `mergeRemoteOpClocks()` to merge the remote ops' clocks into the local clock.
       * This ensures subsequent local ops will have clocks that dominate the import.
       */

      it('should correctly identify ops created AFTER clock merge as valid', async () => {
        // Scenario:
        // 1. Client A creates SYNC_IMPORT with clock {clientA: 1}
        // 2. Client B receives it, merges clocks → local clock becomes {clientA: 1, clientB: 5}
        // 3. Client B creates new op with clock {clientA: 1, clientB: 6} (GREATER_THAN import)
        // 4. This op should pass the filter

        const existingSyncImport: Operation = {
          id: '019afd68-0050-7000-0000-000000000000',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        // Return as an entry (remote + synced = already accepted import)
        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: existingSyncImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Op created AFTER merging import's clock - includes clientA: 1
        const postMergeOp: Operation[] = [
          {
            id: '019afd70-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'New task after merge' },
            clientId: 'client-B',
            vectorClock: { clientA: 1, clientB: 6 }, // Includes import's clock entry
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(postMergeOp);

        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should filter ops from unknown clients (clean slate semantics)', async () => {
        // Clean Slate Semantics: ops from clients unknown to the SYNC_IMPORT are FILTERED.
        // Rationale: the import is an explicit user action to restore ALL clients to
        // a specific state. Concurrent work is intentionally discarded.
        //
        // Scenario:
        // 1. Client A creates SYNC_IMPORT with clock {clientA: 1}
        // 2. Client B (unknown to A) creates op with clock {clientB: 6}
        // 3. Client B's op should be FILTERED (no knowledge of import)

        const existingSyncImport: Operation = {
          id: '019afd68-0050-7000-0000-000000000000',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        // Return as an entry (remote + synced = already accepted import)
        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: existingSyncImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Op from a client that was UNKNOWN to the import
        const unknownClientOp: Operation[] = [
          {
            id: '019afd70-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'New task from unknown client' },
            clientId: 'client-B',
            vectorClock: { clientB: 6 }, // Client B is not in import's clock
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(unknownClientOp);

        // Should be FILTERED - no knowledge of import means it's pre-import state
        expect(result.validOps.length).toBe(0);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should handle multiple clients scenario correctly', async () => {
        // Scenario with 3 clients:
        // 1. Client A creates SYNC_IMPORT with clock {clientA: 1}
        // 2. Client B merges → clock becomes {clientA: 1, clientB: 5}
        // 3. Client C merges → clock becomes {clientA: 1, clientC: 3}
        // 4. Both B and C create ops, both should pass filter

        const existingSyncImport: Operation = {
          id: '019afd68-0050-7000-0000-000000000000',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        // Return as an entry (remote + synced = already accepted import)
        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: existingSyncImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        const opsFromMultipleClients: Operation[] = [
          {
            id: '019afd70-0001-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'From client B' },
            clientId: 'client-B',
            vectorClock: { clientA: 1, clientB: 6 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          {
            id: '019afd70-0002-7000-0000-000000000000',
            actionType: '[Task] Update Task' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-2',
            payload: { title: 'From client C' },
            clientId: 'client-C',
            vectorClock: { clientA: 1, clientC: 4 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result =
          await service.filterOpsInvalidatedBySyncImport(opsFromMultipleClients);

        expect(result.validOps.length).toBe(2);
        expect(result.invalidatedOps.length).toBe(0);
      });
    });

    describe('BUG FIX: Vector clock pruning preserves import client', () => {
      /**
       * This test documents the bug that occurs when vector clock pruning removes
       * the SYNC_IMPORT client's entry, causing new ops to appear CONCURRENT with
       * the import instead of GREATER_THAN.
       *
       * THE BUG SCENARIO:
       * 1. Client A creates SYNC_IMPORT with clock {clientA: 1}
       * 2. Client B receives it, merges clocks → {clientA: 1, clientB: 9746, ...}
       * 3. B has 91 clients in clock, pruning triggers (limit is 10)
       * 4. clientA has counter=1 (lowest) → PRUNED by limitVectorClockSize()
       * 5. New task on B has clock {clientB: 9747} - MISSING clientA!
       * 6. Comparison: {clientA: 0 (missing)} vs {clientA: 1} → CONCURRENT
       * 7. Op is incorrectly filtered as "invalidated by import"
       *
       * THE FIX:
       * - After applying SYNC_IMPORT, store the import client ID as "protected"
       * - limitVectorClockSize() preserves protected client IDs even with low counters
       * - New ops include the import client entry → comparison yields GREATER_THAN
       */

      it('should correctly filter ops when SYNC_IMPORT client was NOT pruned (fix applied)', async () => {
        // This test shows CORRECT behavior when the fix is applied:
        // The import client's entry is preserved in the op's vector clock

        const existingSyncImport: Operation = {
          id: '019afd68-0050-7000-0000-000000000000',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'clientA',
          vectorClock: { clientA: 1 }, // Import's clock
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: existingSyncImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // With the fix: op's clock includes clientA (protected during pruning)
        const opWithPreservedClock: Operation[] = [
          {
            id: '019afd70-0001-7000-0000-000000000000',
            actionType: '[Task Shared] addTask' as ActionType,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: 'new-task-1',
            payload: { title: 'My new task' },
            clientId: 'clientB',
            // Clock includes clientA because it was protected during pruning
            vectorClock: { clientA: 1, clientB: 9747 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result =
          await service.filterOpsInvalidatedBySyncImport(opWithPreservedClock);

        // With preserved clock: op is GREATER_THAN import → kept
        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should incorrectly filter ops when SYNC_IMPORT client was pruned (bug scenario)', async () => {
        // This test documents the BUGGY behavior before the fix:
        // When the import client's entry is pruned, new ops appear CONCURRENT

        const existingSyncImport: Operation = {
          id: '019afd68-0050-7000-0000-000000000000',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'clientA',
          vectorClock: { clientA: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: existingSyncImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // WITHOUT the fix: clientA was pruned from clock (low counter)
        const opWithPrunedClock: Operation[] = [
          {
            id: '019afd70-0001-7000-0000-000000000000',
            actionType: '[Task Shared] addTask' as ActionType,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: 'new-task-1',
            payload: { title: 'My new task' },
            clientId: 'clientB',
            vectorClock: { clientB: 9747 }, // clientA was pruned!
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(opWithPrunedClock);

        // BUG: Op is CONCURRENT with import (clientA: 0 vs 1) → filtered
        // This documents the buggy behavior that the fix prevents
        expect(result.invalidatedOps.length).toBe(1);
        expect(result.validOps.length).toBe(0);
      });
    });

    describe('filteringImport return field', () => {
      it('should return filteringImport when ops are filtered by SYNC_IMPORT in batch', async () => {
        const syncImportOp = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 5 },
        });
        const filteredOp = createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-B',
          vectorClock: { clientB: 2 }, // CONCURRENT - no knowledge of import
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          filteredOp,
          syncImportOp,
        ]);

        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.id).toBe('019afd68-0050-7000-0000-000000000000');
        expect(result.filteringImport!.opType).toBe(OpType.SyncImport);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should return filteringImport when ops are filtered by stored SYNC_IMPORT', async () => {
        const storedImport: Operation = {
          id: '019afd68-0050-7000-0000-000000000000',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'client-A',
          vectorClock: { clientA: 5 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        // Return as an entry (remote + synced = already accepted import)
        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: storedImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        const filteredOps: Operation[] = [
          createOp({
            id: '019afd60-0001-7000-0000-000000000000',
            opType: OpType.Update,
            clientId: 'client-B',
            vectorClock: { clientB: 2 }, // CONCURRENT
          }),
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(filteredOps);

        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.id).toBe(storedImport.id);
        expect(result.filteringImport!.clientId).toBe('client-A');
        expect(result.invalidatedOps.length).toBe(1);
        expect(result.validOps.length).toBe(0);
      });

      it('should return undefined filteringImport when no import exists', async () => {
        const ops: Operation[] = [
          createOp({ id: '019afd68-0001-7000-0000-000000000000', opType: OpType.Update }),
          createOp({ id: '019afd68-0002-7000-0000-000000000000', opType: OpType.Create }),
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        expect(result.filteringImport).toBeUndefined();
        expect(result.validOps.length).toBe(2);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should return filteringImport even when no ops are actually filtered (all valid)', async () => {
        const syncImportOp = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 5 },
        });
        const validOp = createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-B',
          vectorClock: { clientA: 5, clientB: 1 }, // GREATER_THAN - has knowledge of import
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          syncImportOp,
          validOp,
        ]);

        // filteringImport is set because import exists, even though no ops were filtered
        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.id).toBe('019afd68-0050-7000-0000-000000000000');
        expect(result.validOps.length).toBe(2);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should return the LATEST import when multiple imports exist in batch', async () => {
        const ops: Operation[] = [
          createOp({
            id: '019afd68-0010-7000-0000-000000000000',
            opType: OpType.SyncImport,
            clientId: 'client-A',
            entityType: 'ALL',
            vectorClock: { clientA: 1 },
          }),
          createOp({
            id: '019afd68-0050-7000-0000-000000000000', // Later UUIDv7 = latest
            opType: OpType.SyncImport,
            clientId: 'client-B',
            entityType: 'ALL',
            vectorClock: { clientB: 1 },
          }),
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        // Should return the latest import (by UUIDv7)
        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.id).toBe('019afd68-0050-7000-0000-000000000000');
        expect(result.filteringImport!.clientId).toBe('client-B');
      });

      it('should return stored import when it is newer than batch import', async () => {
        const storedImport: Operation = {
          id: '019afd68-0100-7000-0000-000000000000', // Newer than batch import
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'client-A',
          vectorClock: { clientA: 10 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        // Return as an entry (remote + synced = already accepted import)
        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: storedImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        const batchImport = createOp({
          id: '019afd68-0050-7000-0000-000000000000', // Older than stored
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientB: 1 },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([batchImport]);

        // Should return stored import (newer by UUIDv7)
        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.id).toBe(storedImport.id);
        expect(result.filteringImport!.clientId).toBe('client-A');
      });

      it('should return filteringImport for BACKUP_IMPORT as well', async () => {
        const backupImportOp = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.BackupImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 5 },
        });
        const filteredOp = createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-B',
          vectorClock: { clientB: 2 }, // CONCURRENT
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          filteredOp,
          backupImportOp,
        ]);

        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.opType).toBe(OpType.BackupImport);
        expect(result.invalidatedOps.length).toBe(1);
      });
    });

    describe('isLocalUnsyncedImport flag', () => {
      // Helper to create OperationLogEntry
      const createEntry = (
        op: Operation,
        source: 'local' | 'remote',
        syncedAt?: number,
      ): OperationLogEntry => ({
        seq: 1,
        op,
        source,
        syncedAt,
        appliedAt: Date.now(),
      });

      it('should set isLocalUnsyncedImport=false when no import exists', async () => {
        const ops: Operation[] = [
          createOp({ id: '019afd68-0001-7000-0000-000000000000', opType: OpType.Update }),
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        expect(result.isLocalUnsyncedImport).toBe(false);
      });

      it('should set isLocalUnsyncedImport=false when filtering import is in the batch (remote)', async () => {
        // When a SYNC_IMPORT comes in the batch, it's being downloaded from remote
        // so it's not a local unsynced import
        const syncImportOp = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientB: 1 },
        });
        const oldOp = createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-A',
          vectorClock: { clientA: 1 }, // CONCURRENT with import
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          oldOp,
          syncImportOp,
        ]);

        expect(result.isLocalUnsyncedImport).toBe(false);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should set isLocalUnsyncedImport=true when stored import is local and unsynced', async () => {
        const storedImportOp = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.BackupImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 1 },
        });
        const storedEntry = createEntry(storedImportOp, 'local', undefined); // No syncedAt

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve(storedEntry),
        );

        // Incoming op that will be filtered
        const oldOp = createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-B',
          vectorClock: { clientB: 1 }, // CONCURRENT with import
        });

        const result = await service.filterOpsInvalidatedBySyncImport([oldOp]);

        expect(result.isLocalUnsyncedImport).toBe(true);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should set isLocalUnsyncedImport=false when stored import is local but already synced', async () => {
        const storedImportOp = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 1 },
        });
        const storedEntry = createEntry(storedImportOp, 'local', Date.now()); // Has syncedAt

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve(storedEntry),
        );

        const oldOp = createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-B',
          vectorClock: { clientB: 1 }, // CONCURRENT with import
        });

        const result = await service.filterOpsInvalidatedBySyncImport([oldOp]);

        expect(result.isLocalUnsyncedImport).toBe(false);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should set isLocalUnsyncedImport=false when stored import is remote', async () => {
        const storedImportOp = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientB: 1 },
        });
        const storedEntry = createEntry(storedImportOp, 'remote', Date.now());

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve(storedEntry),
        );

        const oldOp = createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-C',
          vectorClock: { clientC: 1 }, // CONCURRENT with import
        });

        const result = await service.filterOpsInvalidatedBySyncImport([oldOp]);

        expect(result.isLocalUnsyncedImport).toBe(false);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should prefer batch import over stored import when determining isLocalUnsyncedImport', async () => {
        // Even if there's a local unsynced import in the store, if a newer import
        // is in the batch, it's not a local unsynced import scenario
        const storedImportOp = createOp({
          id: '019afd68-0040-7000-0000-000000000000', // Older ID
          opType: OpType.BackupImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 1 },
        });
        const storedEntry = createEntry(storedImportOp, 'local', undefined);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve(storedEntry),
        );

        // Newer SYNC_IMPORT in the batch
        const batchImport = createOp({
          id: '019afd68-0050-7000-0000-000000000000', // Newer ID
          opType: OpType.SyncImport,
          clientId: 'client-B',
          entityType: 'ALL',
          vectorClock: { clientA: 1, clientB: 1 },
        });
        const oldOp = createOp({
          id: '019afd68-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'client-C',
          vectorClock: { clientC: 1 },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          oldOp,
          batchImport,
        ]);

        // Batch import is used (newer), so isLocalUnsyncedImport is false
        expect(result.isLocalUnsyncedImport).toBe(false);
        expect(result.filteringImport!.id).toBe('019afd68-0050-7000-0000-000000000000');
      });
    });

    /* eslint-disable @typescript-eslint/naming-convention */
    describe('BUG FIX: Server-side pruning causes new client ops to appear CONCURRENT with import', () => {
      /**
       * This test suite covers the bug where a NEW client (born after a SYNC_IMPORT)
       * has its operations silently dropped by other clients.
       *
       * THE BUG:
       * 1. SYNC_IMPORT exists with exactly MAX_VECTOR_CLOCK_SIZE (10) entries in its clock
       * 2. New client (e.g., mobile A_DReS) receives import, merges clock → 11 entries
       * 3. Server prunes to 10 entries (drops one inherited entry like A_Zw6o:88)
       * 4. Other clients download the op and compare with import:
       *    - Both clocks have 10 entries → pruning-aware mode
       *    - 9 shared keys are all equal
       *    - Each side has 1 unique key (A_DReS in op, A_Zw6o in import)
       *    - compareVectorClocks returns CONCURRENT
       * 5. SyncImportFilterService drops CONCURRENT ops → mobile changes lost!
       *
       * THE FIX:
       * When an op appears CONCURRENT with the import, check if it's a pruning artifact:
       * - Op's clientId is NOT in import's clock (new client born after import)
       * - ALL shared vector clock keys have op values >= import values
       * If both conditions are true, the CONCURRENT is from server-side pruning and
       * the op should be KEPT.
       */

      // Helper: build a clock with exactly N entries
      const buildClock = (entries: Record<string, number>): Record<string, number> =>
        entries;

      it('should KEEP ops from new client when CONCURRENT is caused by server-side pruning (exact bug scenario)', async () => {
        // SYNC_IMPORT with exactly MAX_VECTOR_CLOCK_SIZE entries
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });
        expect(Object.keys(importClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        const syncImport = createOp({
          id: '019c4290-0a51-7184-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'B_pr52',
          entityType: 'ALL',
          vectorClock: importClock,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: syncImport,
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New mobile client A_DReS (NOT in import's clock) creates op after
        // receiving import. Server pruned A_Zw6o:88, added A_DReS:1.
        const mobileOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'A_DReS',
          entityId: 'new-task-1',
          actionType: '[Task Shared] addTask' as ActionType,
          vectorClock: buildClock({
            A_DReS: 1,
            A_bw1h: 227,
            A_wU5p: 95,
            // A_Zw6o: 88 was PRUNED by server
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });
        expect(Object.keys(mobileOp.vectorClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        const result = await service.filterOpsInvalidatedBySyncImport([mobileOp]);

        // FIX: Op should be KEPT - A_DReS is a new client that inherited the import's
        // clock. The CONCURRENT result is a pruning artifact, not genuine concurrency.
        expect(result.validOps.length).toBe(1);
        expect(result.validOps[0].clientId).toBe('A_DReS');
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should KEEP multiple ops from new client after import (server pruned different entries)', async () => {
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        const ops = [
          createOp({
            id: '019c42a0-0001-7000-0000-000000000000',
            opType: OpType.Create,
            clientId: 'A_DReS',
            entityId: 'task-1',
            vectorClock: buildClock({
              A_DReS: 1,
              A_bw1h: 227,
              A_wU5p: 95,
              B_HSxu: 10774,
              B_pr52: 3642,
              BCL_174: 117821,
              BCLmd3: 4990,
              BCLmd4: 80215,
              BCLmdt: 653096,
              BCM_mhq: 2659,
            }),
          }),
          createOp({
            id: '019c42a0-0002-7000-0000-000000000000',
            opType: OpType.Update,
            clientId: 'A_DReS',
            entityId: 'task-1',
            vectorClock: buildClock({
              A_DReS: 2,
              A_bw1h: 227,
              A_wU5p: 95,
              B_HSxu: 10774,
              B_pr52: 3642,
              BCL_174: 117821,
              BCLmd3: 4990,
              BCLmd4: 80215,
              BCLmdt: 653096,
              BCM_mhq: 2659,
            }),
          }),
        ];

        const result = await service.filterOpsInvalidatedBySyncImport(ops);

        expect(result.validOps.length).toBe(2);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should KEEP op from new client when shared keys are GREATER than import (post-import activity)', async () => {
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client saw more ops from B_pr52 after the import
        const mobileOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'A_DReS',
          entityId: 'task-1',
          vectorClock: buildClock({
            A_DReS: 3,
            A_bw1h: 227,
            A_wU5p: 95,
            B_HSxu: 10774,
            B_pr52: 3650, // GREATER than import's 3642
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([mobileOp]);

        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should still FILTER ops from new client with NO shared keys (genuinely unknown)', async () => {
        const importClock = buildClock({
          clientA: 5,
          clientB: 10,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'clientA',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Genuinely unknown client - no shared keys with import at all
        const unknownOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'clientNew',
          entityId: 'task-1',
          vectorClock: { clientNew: 5 },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([unknownOp]);

        // Should still be filtered - no evidence this client saw the import
        expect(result.validOps.length).toBe(0);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should still FILTER ops from new client with shared keys but LOWER values (genuinely concurrent)', async () => {
        const importClock = buildClock({
          clientA: 100,
          clientB: 200,
          clientC: 300,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'clientA',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client has shared keys but LOWER values than import
        // This means the client saw older ops from these clients, NOT the import
        const genuinelyConcurrentOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'clientNew',
          entityId: 'task-1',
          vectorClock: {
            clientNew: 5,
            clientA: 50, // LOWER than import's 100
            clientB: 200, // EQUAL
          },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          genuinelyConcurrentOp,
        ]);

        // Should be filtered - client has LESS knowledge than import for clientA
        expect(result.validOps.length).toBe(0);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should still FILTER ops from client that IS in import clock (not a new client)', async () => {
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Client A_bw1h IS in import's clock - this is an existing client, not new.
        // Even though shared keys are equal, the pruning-artifact heuristic should NOT apply.
        const existingClientOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'A_bw1h',
          entityId: 'task-1',
          vectorClock: buildClock({
            A_bw1h: 228,
            A_wU5p: 95,
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
            A_Zw6o: 88,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([existingClientOp]);

        // This should be KEPT via normal GREATER_THAN comparison (A_bw1h: 228 > 227)
        // The pruning artifact check is not needed here - normal comparison handles it
        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should KEEP op from new client even when import is in the same batch', async () => {
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });

        const syncImport = createOp({
          id: '019c4290-0a51-7184-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'B_pr52',
          entityType: 'ALL',
          vectorClock: importClock,
        });

        const mobileOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'A_DReS',
          entityId: 'task-1',
          vectorClock: buildClock({
            A_DReS: 1,
            A_bw1h: 227,
            A_wU5p: 95,
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          syncImport,
          mobileOp,
        ]);

        expect(result.validOps.length).toBe(2); // import + mobile op
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should FILTER op from new client when import has fewer entries than MAX (no server pruning possible)', async () => {
        // Import has only 5 entries (below MAX_VECTOR_CLOCK_SIZE = 10).
        // Server pruning only triggers when clock exceeds MAX, so the op's
        // missing entry (clientE) was genuinely never seen, not pruned.
        const importClock = buildClock({
          clientA: 100,
          clientB: 200,
          clientC: 300,
          clientD: 400,
          clientE: 500,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'clientA',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client with shared keys >= import BUT import < MAX entries.
        // Since server wouldn't prune a 6-entry clock, the missing clientE
        // means genuine concurrency, not a pruning artifact.
        const newClientOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'clientNew',
          entityId: 'task-1',
          vectorClock: buildClock({
            clientNew: 1,
            clientA: 100,
            clientB: 200,
            clientC: 300,
            clientD: 400,
            // clientE missing - genuinely not seen (not pruned)
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([newClientOp]);

        // Should be FILTERED - import is below MAX, no pruning artifact possible
        expect(result.validOps.length).toBe(0);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should KEEP ops from new client when MULTIPLE entries were pruned (2+ entries dropped)', async () => {
        // Import has MAX entries. New client inherits clock, sees 2 more new clients,
        // resulting in MAX+3 entries. Server prunes back to MAX, dropping 3 import entries.
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });
        expect(Object.keys(importClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client added 3 entries (A_DReS, A_newX, A_newY) making 13 total.
        // Server pruned 3 import entries (A_Zw6o, A_wU5p, BCM_mhq) back to MAX.
        // Only 7 shared keys remain (8 inherited - 1 not present = 7).
        const mobileOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'A_DReS',
          entityId: 'task-1',
          vectorClock: buildClock({
            A_DReS: 1,
            A_newX: 5,
            A_newY: 3,
            A_bw1h: 227,
            // A_wU5p: 95 was PRUNED
            // A_Zw6o: 88 was PRUNED
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            // BCM_mhq: 2659 was PRUNED
          }),
        });
        expect(Object.keys(mobileOp.vectorClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        const result = await service.filterOpsInvalidatedBySyncImport([mobileOp]);

        // Should be KEPT - 7 shared keys all >= import, new client, import at MAX
        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should KEEP op from new client even when op clock has fewer than MAX entries', async () => {
        // Import has MAX entries. New client creates an op with fewer than MAX entries
        // (e.g., server pruned heavily or client only inherited a subset).
        // compareVectorClocks does NOT enter pruning-aware mode here (only one side at MAX),
        // but still returns CONCURRENT. The pruning artifact heuristic should still detect it.
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Op has only 6 entries: own clientId + 5 inherited entries
        // (heavy pruning or partial inheritance scenario)
        const mobileOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'A_DReS',
          entityId: 'task-1',
          vectorClock: buildClock({
            A_DReS: 1,
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });
        expect(Object.keys(mobileOp.vectorClock).length).toBe(6); // < MAX

        const result = await service.filterOpsInvalidatedBySyncImport([mobileOp]);

        // Should be KEPT - new client, import at MAX, 5 shared keys all >= import values
        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should still FILTER ops from new client with NO shared keys when import is at MAX', async () => {
        // Import has MAX entries but op has zero overlap - tests criteria #3
        // at MAX size (not short-circuited by criteria #2)
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Completely unknown client with no shared keys
        const unknownOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'Z_unknown',
          entityId: 'task-1',
          vectorClock: { Z_unknown: 5 },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([unknownOp]);

        // Should be FILTERED - no shared keys means no evidence of seeing import
        expect(result.validOps.length).toBe(0);
        expect(result.invalidatedOps.length).toBe(1);
      });

      it('should document known false positive: concurrent client whose ID was pruned from import clock', async () => {
        // KNOWN LIMITATION: If the import clock itself was pruned and a genuinely
        // concurrent client's ID happened to be among the pruned entries, the heuristic
        // incorrectly keeps the op. The concurrent client appears "born after" the import
        // (criterion 1 satisfied) even though it existed before the import.
        //
        // This is unlikely in practice because it requires the concurrent client to be
        // one of the oldest (least-recently-updated) entries in the import clock at the
        // time of pruning.
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          // A_old1 was pruned from the import clock (was an old entry with low counter)
          // A_old1 is actually a pre-existing concurrent client, not a new client
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
          B_xtra: 500,
        });
        expect(Object.keys(importClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // A_old1 is a genuinely concurrent client (existed before import) whose ID
        // was pruned from the import clock. Its op inherits some shared keys from
        // a previous sync, making it look like a post-import client to the heuristic.
        const concurrentOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'A_old1',
          entityId: 'task-1',
          vectorClock: buildClock({
            A_old1: 50,
            A_bw1h: 227,
            A_wU5p: 95,
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([concurrentOp]);

        // FALSE POSITIVE: The heuristic incorrectly keeps this op because:
        // 1. A_old1 is not in import clock (pruned) → looks like "born after import"
        // 2. Import has MAX entries → pruning was possible
        // 3. All shared keys are >= import values → looks like inherited knowledge
        // In reality, A_old1 existed before the import and is genuinely concurrent.
        // This is an accepted trade-off: keeping a concurrent op is safer than
        // dropping a legitimate post-import op.
        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should still FILTER ops from new client with LOWER shared keys when import is at MAX', async () => {
        // Import has MAX entries, op has shared keys but LOWER values - tests criteria #4
        // at MAX size (not short-circuited by criteria #2)
        const importClock = buildClock({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client has shared keys but saw OLDER state than import
        const staleOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'A_stale',
          entityId: 'task-1',
          vectorClock: buildClock({
            A_stale: 5,
            A_bw1h: 100, // LOWER than import's 227
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
            A_wU5p: 95,
          }),
        });
        expect(Object.keys(staleOp.vectorClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        const result = await service.filterOpsInvalidatedBySyncImport([staleOp]);

        // Should be FILTERED - shared key A_bw1h (100 < 227) proves stale knowledge
        expect(result.validOps.length).toBe(0);
        expect(result.invalidatedOps.length).toBe(1);
      });
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    /* eslint-disable @typescript-eslint/naming-convention */
    describe('Oversized import clock normalization (import clock > MAX_VECTOR_CLOCK_SIZE)', () => {
      // Helper: build a clock with exactly N entries
      const buildClockN = (entries: Record<string, number>): Record<string, number> =>
        entries;

      it('should KEEP ops from existing client when import clock exceeds MAX (exact bug scenario)', async () => {
        // Import clock has 12 entries (exceeds MAX=10). The server pruned this to 10,
        // but our local copy still has 12. Remote client B_EH5U created ops based on
        // the 10-entry server version. Without normalization, B_EH5U's ops appear
        // CONCURRENT because the local import has entries missing from the op.
        const importClock = buildClockN({
          A_bw1h: 227,
          A_lPYz: 51,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_EH5U: 52,
          B_HSxu: 10774,
          B_pr52: 3638,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });
        expect(Object.keys(importClock).length).toBe(12);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Op from B_EH5U with 10 entries (server-pruned). B_EH5U IS in the original
        // import clock but gets dropped during normalization (low counter=52).
        const opFromBugScenario = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'B_EH5U',
          entityId: 'task-1',
          vectorClock: buildClockN({
            A_bw1h: 227,
            A_wU5p: 95,
            B_EH5U: 173,
            B_HSxu: 10774,
            B_pr52: 4073,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });
        expect(Object.keys(opFromBugScenario.vectorClock).length).toBe(
          MAX_VECTOR_CLOCK_SIZE,
        );

        const result = await service.filterOpsInvalidatedBySyncImport([
          opFromBugScenario,
        ]);

        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should KEEP ops when import has MAX+1 (11) entries and op client is in import', async () => {
        // Boundary case: just barely over MAX
        const importClock = buildClockN({
          A_bw1h: 227,
          A_lPYz: 51,
          A_wU5p: 95,
          B_EH5U: 52,
          B_HSxu: 10774,
          B_pr52: 3638,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });
        expect(Object.keys(importClock).length).toBe(11);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        const op = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'B_EH5U',
          entityId: 'task-1',
          vectorClock: buildClockN({
            A_bw1h: 227,
            A_wU5p: 95,
            B_EH5U: 173,
            B_HSxu: 10774,
            B_pr52: 4073,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([op]);

        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should preserve existing behavior when import has exactly MAX entries', async () => {
        // No normalization needed — import clock is already at MAX
        const importClock = buildClockN({
          A_bw1h: 227,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_HSxu: 10774,
          B_pr52: 3642,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });
        expect(Object.keys(importClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client born after import with inherited knowledge — same as existing test
        const newClientOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'A_DReS',
          entityId: 'task-1',
          vectorClock: buildClockN({
            A_DReS: 1,
            A_bw1h: 227,
            A_wU5p: 95,
            B_HSxu: 10774,
            B_pr52: 3642,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([newClientOp]);

        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should handle mixed batch: GREATER_THAN kept, genuinely concurrent filtered, bug-scenario kept', async () => {
        const importClock = buildClockN({
          A_bw1h: 227,
          A_lPYz: 51,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_EH5U: 52,
          B_HSxu: 10774,
          B_pr52: 3638,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });
        expect(Object.keys(importClock).length).toBe(12);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Op 1: Clearly GREATER_THAN (ahead on all keys) — should be KEPT
        const greaterOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'B_pr52',
          entityId: 'task-1',
          vectorClock: buildClockN({
            A_bw1h: 228,
            A_lPYz: 52,
            A_wU5p: 96,
            A_Zw6o: 89,
            B_EH5U: 53,
            B_HSxu: 10775,
            B_pr52: 3639,
            BCL_174: 117822,
            BCLmd3: 4991,
            BCLmd4: 80216,
            BCLmdt: 653097,
            BCM_mhq: 2660,
          }),
        });

        // Op 2: Genuinely concurrent (no shared keys) — should be FILTERED
        const concurrentOp = createOp({
          id: '019c42a0-0002-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'Z_unknown',
          entityId: 'task-2',
          vectorClock: { Z_unknown: 5 },
        });

        // Op 3: Bug scenario — existing client pruned out of import — should be KEPT
        const bugOp = createOp({
          id: '019c42a0-0003-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'B_EH5U',
          entityId: 'task-3',
          vectorClock: buildClockN({
            A_bw1h: 227,
            A_wU5p: 95,
            B_EH5U: 173,
            B_HSxu: 10774,
            B_pr52: 4073,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          greaterOp,
          concurrentOp,
          bugOp,
        ]);

        expect(result.validOps.length).toBe(2);
        expect(result.validOps.map((o) => o.id)).toContain(greaterOp.id);
        expect(result.validOps.map((o) => o.id)).toContain(bugOp.id);
        expect(result.invalidatedOps.length).toBe(1);
        expect(result.invalidatedOps[0].id).toBe(concurrentOp.id);
      });

      it('should KEEP ops when import has 15 entries (stress test)', async () => {
        const importClock = buildClockN({
          A_bw1h: 227,
          A_lPYz: 51,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_EH5U: 52,
          B_HSxu: 10774,
          B_pr52: 3638,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
          C_ext1: 30,
          C_ext2: 20,
          C_ext3: 10,
        });
        expect(Object.keys(importClock).length).toBe(15);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Op from B_EH5U which has a very low counter (52) in the import
        const op = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'B_EH5U',
          entityId: 'task-1',
          vectorClock: buildClockN({
            A_bw1h: 227,
            A_wU5p: 95,
            B_EH5U: 173,
            B_HSxu: 10774,
            B_pr52: 4073,
            BCL_174: 117821,
            BCLmd3: 4990,
            BCLmd4: 80215,
            BCLmdt: 653096,
            BCM_mhq: 2659,
          }),
        });

        const result = await service.filterOpsInvalidatedBySyncImport([op]);

        expect(result.validOps.length).toBe(1);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should FILTER genuinely concurrent op with no shared keys even when import exceeds MAX', async () => {
        const importClock = buildClockN({
          A_bw1h: 227,
          A_lPYz: 51,
          A_wU5p: 95,
          A_Zw6o: 88,
          B_EH5U: 52,
          B_HSxu: 10774,
          B_pr52: 3638,
          BCL_174: 117821,
          BCLmd3: 4990,
          BCLmd4: 80215,
          BCLmdt: 653096,
          BCM_mhq: 2659,
        });
        expect(Object.keys(importClock).length).toBe(12);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 3,
            op: createOp({
              id: '019c4290-0a51-7184-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'B_pr52',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Completely unknown client with zero shared keys — genuinely concurrent
        const unknownOp = createOp({
          id: '019c42a0-0001-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'Z_alien1',
          entityId: 'task-1',
          vectorClock: { Z_alien1: 5 },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([unknownOp]);

        expect(result.validOps.length).toBe(0);
        expect(result.invalidatedOps.length).toBe(1);
      });
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    describe('Bug Scenario: Pruned vector clock causes false CONCURRENT classification', () => {
      /**
       * This test verifies the scenario that caused the bug where changes on client B
       * were not syncing to client A.
       *
       * Root Cause: When a SYNC_IMPORT is created locally via handleServerMigration() or
       * createCleanSlateFromImport(), the protectedClientIds were not being set.
       * Without this protection, limitVectorClockSize() would prune low-counter entries
       * from subsequent operations' vector clocks.
       *
       * Example from logs:
       * - Op vectorClock had 9 entries
       * - Import vectorClock had 16 entries
       * - Op was missing 7 low-counter entries present in Import
       * - This caused CONCURRENT comparison instead of GREATER_THAN
       *
       * The fix adds setProtectedClientIds() call after creating local SYNC_IMPORT ops.
       * This test validates the correct behavior when vector clocks are properly maintained.
       */

      it('should classify op as GREATER_THAN when it has full knowledge of SYNC_IMPORT (no pruning)', async () => {
        // Simulate a SYNC_IMPORT with many client entries (like from server migration)
        const syncImportClock = {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_3Xx3: 5,
          A_AMT3: 81,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_EemJ: 1,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_Jxm0: 35,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_wU5p: 13,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_ypDK: 19,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          B_bC8O: 25,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          B_HSxu: 10806,
        };

        const syncImport = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'A_Jxm0',
          entityType: 'ALL',
          vectorClock: syncImportClock,
        });

        // Op created AFTER the import - includes ALL entries from import plus increment
        // (This is what happens when protectedClientIds are set correctly)
        const postImportOp = createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'A_Jxm0',
          entityId: 'task-1',
          vectorClock: {
            // All entries from import are preserved
            // eslint-disable-next-line @typescript-eslint/naming-convention
            A_3Xx3: 5,
            A_AMT3: 81,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            A_EemJ: 1,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            A_Jxm0: 36, // Incremented
            // eslint-disable-next-line @typescript-eslint/naming-convention
            A_wU5p: 13,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            A_ypDK: 19,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            B_bC8O: 25,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            B_HSxu: 10806,
          },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          syncImport,
          postImportOp,
        ]);

        // Both should be valid - op has GREATER_THAN relationship to import
        expect(result.validOps.length).toBe(2);
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('should demonstrate the bug: op with PRUNED clock is incorrectly classified as CONCURRENT', async () => {
        // SYNC_IMPORT with many client entries
        const syncImportClock = {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_3Xx3: 5,
          A_AMT3: 81,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_EemJ: 1,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_Jxm0: 35,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_wU5p: 13,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          A_ypDK: 19,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          B_bC8O: 25,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          B_HSxu: 10806,
        };

        const syncImport = createOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'A_Jxm0',
          entityType: 'ALL',
          vectorClock: syncImportClock,
        });

        // Op created AFTER the import, but with PRUNED clock (missing low-counter entries)
        // This simulates what happens WITHOUT the fix (protectedClientIds not set)
        // limitVectorClockSize() would have removed the low-counter entries
        const postImportOpWithPrunedClock = createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'A_Jxm0',
          entityId: 'task-1',
          vectorClock: {
            // Only kept the highest counter entries (pruned to ~8 entries)
            // Missing: A_3Xx3, A_EemJ, A_wU5p, A_ypDK, B_bC8O (all with low counters)
            A_AMT3: 81,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            A_Jxm0: 36, // Incremented from 35
            // eslint-disable-next-line @typescript-eslint/naming-convention
            B_HSxu: 10806,
          },
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          syncImport,
          postImportOpWithPrunedClock,
        ]);

        // BUG BEHAVIOR: Op is incorrectly classified as CONCURRENT and filtered out
        // because it's missing entries that the import has (A_3Xx3, A_EemJ, etc.)
        //
        // When comparing vector clocks:
        // - Import has A_3Xx3:5, op has it as undefined (0) → Import wins on this key
        // - Op has A_Jxm0:36, import has 35 → Op wins on this key
        // - This results in CONCURRENT (both have some higher values)
        //
        // After our fix (setProtectedClientIds), this scenario won't occur because
        // the op will preserve all entries from the import's vector clock.
        expect(result.invalidatedOps.length).toBe(1);
        expect(result.invalidatedOps[0].id).toBe('019afd68-0100-7000-0000-000000000000');

        // The SYNC_IMPORT itself is valid
        expect(result.validOps.length).toBe(1);
        expect(result.validOps[0].opType).toBe(OpType.SyncImport);
      });
    });

    describe('full pruning pipeline simulation', () => {
      /**
       * These tests simulate the full round-trip of vector clock pruning
       * through the filterOpsInvalidatedBySyncImport pipeline:
       *   limitVectorClockSize → compareVectorClocks → isLikelyPruningArtifact
       *
       * They verify that the layered heuristics work together correctly for
       * realistic scenarios involving MAX-entry clocks and server-side pruning.
       */

      it('Test F: server-pruned clock round-trip — op from new client kept via pruning artifact detection', async () => {
        // Import with exactly MAX entries
        const importClock: Record<string, number> = {};
        for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
          importClock[`client_${i}`] = 100 + i;
        }
        expect(Object.keys(importClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: createOp({
              id: '019afd68-0050-7000-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'client_0',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client K inherited import clock + own ID = MAX+1.
        // Server pruned: dropped client_0 (lowest counter=100), kept clientK.
        // Result: MAX entries with clientK replacing client_0.
        const serverPrunedOpClock: Record<string, number> = {};
        for (let i = 1; i < MAX_VECTOR_CLOCK_SIZE; i++) {
          serverPrunedOpClock[`client_${i}`] = 100 + i; // inherited from import
        }
        serverPrunedOpClock['clientK'] = 1; // K's own counter
        expect(Object.keys(serverPrunedOpClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        const opFromK = createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'clientK',
          entityId: 'task-1',
          vectorClock: serverPrunedOpClock,
        });

        const result = await service.filterOpsInvalidatedBySyncImport([opFromK]);

        // compareVectorClocks returns CONCURRENT (both MAX, different unique keys).
        // isLikelyPruningArtifact detects: clientK not in import, all shared >= import.
        // Op is KEPT.
        expect(result.validOps.length).toBe(1);
        expect(result.validOps[0].clientId).toBe('clientK');
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('Test G: multiple new clients after import — progressive pruning, both kept', async () => {
        // Import with exactly MAX entries
        const importClock: Record<string, number> = {};
        for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
          importClock[`client_${i}`] = 50 + i;
        }

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: createOp({
              id: '019afd68-0050-7000-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'client_0',
              entityType: 'ALL',
              vectorClock: importClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // Client K joins: inherits import + own = MAX+1.
        // Server prunes: drops client_0 (counter=50, lowest), keeps clientK.
        const kClock: Record<string, number> = {};
        for (let i = 1; i < MAX_VECTOR_CLOCK_SIZE; i++) {
          kClock[`client_${i}`] = 50 + i;
        }
        kClock['clientK'] = 1;

        // Client L joins after K: inherits K's pruned clock + own = MAX+1.
        // Server prunes: drops client_1 (counter=51, now lowest), keeps clientL.
        const lClock: Record<string, number> = {};
        for (let i = 2; i < MAX_VECTOR_CLOCK_SIZE; i++) {
          lClock[`client_${i}`] = 50 + i;
        }
        lClock['clientK'] = 1; // inherited from K
        lClock['clientL'] = 1; // L's own counter

        const opFromK = createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'clientK',
          entityId: 'task-1',
          vectorClock: kClock,
        });

        const opFromL = createOp({
          id: '019afd68-0200-7000-0000-000000000000',
          opType: OpType.Create,
          clientId: 'clientL',
          entityId: 'task-2',
          vectorClock: lClock,
        });

        const result = await service.filterOpsInvalidatedBySyncImport([opFromK, opFromL]);

        // Both ops should be kept via isLikelyPruningArtifact:
        // - clientK not in import, shared keys all >= import values
        // - clientL not in import, shared keys all >= import values
        expect(result.validOps.length).toBe(2);
        expect(result.validOps.map((op) => op.clientId)).toEqual(
          jasmine.arrayContaining(['clientK', 'clientL']),
        );
        expect(result.invalidatedOps.length).toBe(0);
      });

      it('Test H: oversized import clock gets normalized — new client ops still correctly filtered/kept', async () => {
        // Import was created locally with 15 entries (exceeds MAX).
        // The service normalizes it to MAX before comparison.
        const oversizedImportClock: Record<string, number> = {};
        for (let i = 0; i < 15; i++) {
          oversizedImportClock[`client_${i}`] = 10 + i;
        }
        expect(Object.keys(oversizedImportClock).length).toBe(15);

        opLogStoreSpy.getLatestFullStateOpEntry.and.returnValue(
          Promise.resolve({
            seq: 1,
            op: createOp({
              id: '019afd68-0050-7000-0000-000000000000',
              opType: OpType.SyncImport,
              clientId: 'client_0',
              entityType: 'ALL',
              vectorClock: oversizedImportClock,
            }),
            source: 'remote',
            syncedAt: Date.now(),
            appliedAt: Date.now(),
          }),
        );

        // New client K's op with clock based on the server's normalized import.
        // Server stored the import pruned to MAX, so K inherited the pruned version.
        // K inherits the top-10 entries (client_5..14, values 15..24) + own = 11.
        // Server prunes K's clock: drops client_5 (counter=15, lowest non-preserved),
        // keeps clientK.
        const kClock: Record<string, number> = {};
        for (let i = 6; i < 15; i++) {
          kClock[`client_${i}`] = 10 + i; // 9 entries from pruned import
        }
        kClock['clientK'] = 1;
        expect(Object.keys(kClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

        const opFromK = createOp({
          id: '019afd68-0100-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'clientK',
          entityId: 'task-1',
          vectorClock: kClock,
        });

        // Also test a genuinely concurrent op (from a client that existed before import)
        const concurrentOp = createOp({
          id: '019afd68-0080-7000-0000-000000000000',
          opType: OpType.Update,
          clientId: 'old_client',
          entityId: 'task-2',
          vectorClock: { old_client: 5 }, // no knowledge of import
        });

        const result = await service.filterOpsInvalidatedBySyncImport([
          opFromK,
          concurrentOp,
        ]);

        // K's op should be kept: clientK not in (normalized) import, shared keys >= import
        expect(result.validOps.map((op) => op.clientId)).toContain('clientK');
        // Concurrent op should be filtered: old_client has no import knowledge
        expect(result.invalidatedOps.map((op) => op.clientId)).toContain('old_client');
      });
    });
  });
});
