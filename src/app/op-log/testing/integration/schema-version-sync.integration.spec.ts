import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import {
  SchemaMigrationService,
  CURRENT_SCHEMA_VERSION,
} from '../../persistence/schema-migration.service';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';
import { createMinimalTaskPayload } from './helpers/operation-factory.helper';
import { MAX_VERSION_SKIP } from '@sp/shared-schema';

/**
 * Integration tests for Schema Version Sync.
 *
 * Verifies that operations with schema versions round-trip correctly
 * between clients and that SchemaMigrationService handles version
 * differences properly.
 */
describe('Schema Version Sync Integration', () => {
  let storeService: OperationLogStoreService;
  let migrationService: SchemaMigrationService;
  let server: MockSyncServer;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService, SchemaMigrationService],
    });
    storeService = TestBed.inject(OperationLogStoreService);
    migrationService = TestBed.inject(SchemaMigrationService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();

    server = new MockSyncServer();
  });

  describe('Operations with current schema version', () => {
    it('should round-trip operations with current schema version between clients', async () => {
      const clientA = new SimulatedClient('client-a', storeService);
      const clientB = new SimulatedClient('client-b', storeService);

      // Client A creates an operation (schemaVersion is set automatically)
      const op = await clientA.createLocalOp(
        'TASK',
        't1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('t1'),
      );

      // Verify operation has current schema version
      expect(op.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      // Client A uploads
      await clientA.sync(server);

      // Verify server has the op with correct version
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(1);
      expect(serverOps[0].op.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      // Client B downloads
      await clientB.sync(server);

      // Verify Client B's local copy has the correct version
      const allOps = await clientB.getAllOps();
      const receivedOp = allOps.find((e) => e.op.id === op.id);
      expect(receivedOp).toBeDefined();
      expect(receivedOp!.op.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should preserve schema version through multiple sync cycles', async () => {
      const clientA = new SimulatedClient('client-a', storeService);
      const clientB = new SimulatedClient('client-b', storeService);

      // Client A creates multiple operations
      await clientA.createLocalOp(
        'TASK',
        't1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('t1'),
      );
      await clientA.createLocalOp('TASK', 't1', OpType.Update, '[Task] Update Task', {
        title: 'Updated Task',
      });

      // Sync A -> server -> B
      await clientA.sync(server);
      await clientB.sync(server);

      // Verify both ops maintain their schema version
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(2);
      for (const serverOp of serverOps) {
        expect(serverOp.op.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      }
    });
  });

  describe('SchemaMigrationService.operationNeedsMigration', () => {
    it('should report no migration needed for current version operations', () => {
      const op: Operation = {
        id: 'test-op-1',
        clientId: 'test-client',
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 't1',
        payload: createMinimalTaskPayload('t1'),
        vectorClock: { testClient: 1 },
        timestamp: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      expect(migrationService.operationNeedsMigration(op)).toBe(false);
    });

    it('should report migration needed for old version operations', () => {
      if (CURRENT_SCHEMA_VERSION <= 1) {
        pending('Cannot test old versions when CURRENT_SCHEMA_VERSION is 1');
        return;
      }

      const op: Operation = {
        id: 'test-op-old',
        clientId: 'test-client',
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 't1',
        payload: createMinimalTaskPayload('t1'),
        vectorClock: { testClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      expect(migrationService.operationNeedsMigration(op)).toBe(true);
    });

    it('should treat operations without schemaVersion as version 1 (legacy)', () => {
      // Simulate a legacy operation without schemaVersion by deleting it after creation
      const op: Operation = {
        id: 'test-op-legacy',
        clientId: 'test-client',
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 't1',
        payload: createMinimalTaskPayload('t1'),
        vectorClock: { testClient: 1 },
        timestamp: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      // Remove schemaVersion to simulate legacy operation
      delete (op as unknown as Record<string, unknown>).schemaVersion;

      // If current version > 1, legacy ops need migration
      if (CURRENT_SCHEMA_VERSION > 1) {
        expect(migrationService.operationNeedsMigration(op)).toBe(true);
      } else {
        // If current version is 1, legacy ops are already at current version
        expect(migrationService.operationNeedsMigration(op)).toBe(false);
      }
    });
  });

  describe('Schema version compatibility', () => {
    it('should report current version correctly', () => {
      expect(migrationService.getCurrentVersion()).toBe(CURRENT_SCHEMA_VERSION);
      expect(typeof CURRENT_SCHEMA_VERSION).toBe('number');
      expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    });

    it('should define MAX_VERSION_SKIP as a positive number', () => {
      expect(typeof MAX_VERSION_SKIP).toBe('number');
      expect(MAX_VERSION_SKIP).toBeGreaterThan(0);
    });

    it('should not need migration for state at current version', () => {
      const cache = {
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: 0,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      expect(migrationService.needsMigration(cache)).toBe(false);
    });

    it('should need migration for state at old version', () => {
      if (CURRENT_SCHEMA_VERSION <= 1) {
        pending('Cannot test old versions when CURRENT_SCHEMA_VERSION is 1');
        return;
      }

      const cache = {
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: 0,
        schemaVersion: 1,
      };

      expect(migrationService.needsMigration(cache)).toBe(true);
    });

    it('should treat missing schemaVersion in state cache as needing migration', () => {
      if (CURRENT_SCHEMA_VERSION <= 1) {
        pending('Cannot test when CURRENT_SCHEMA_VERSION is 1 (legacy defaults to 1)');
        return;
      }

      const cache = {
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: 0,
        // No schemaVersion — legacy
      };

      expect(migrationService.needsMigration(cache)).toBe(true);
    });
  });

  describe('Migration of operations', () => {
    it('should return operation unchanged if already at current version', () => {
      const op: Operation = {
        id: 'test-op-current',
        clientId: 'test-client',
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 't1',
        payload: createMinimalTaskPayload('t1'),
        vectorClock: { testClient: 1 },
        timestamp: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      const result = migrationService.migrateOperation(op);
      expect(result).toEqual(op);
    });

    it('should batch-migrate operations filtering out dropped ones', () => {
      const ops: Operation[] = [
        {
          id: 'op-1',
          clientId: 'test-client',
          actionType: '[Task] Add Task' as ActionType,
          opType: OpType.Create,
          entityType: 'TASK',
          entityId: 't1',
          payload: createMinimalTaskPayload('t1'),
          vectorClock: { testClient: 1 },
          timestamp: Date.now(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
        },
        {
          id: 'op-2',
          clientId: 'test-client',
          actionType: '[Task] Update Task' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Updated' },
          vectorClock: { testClient: 2 },
          timestamp: Date.now(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
        },
      ];

      const migrated = migrationService.migrateOperations(ops);

      // All ops at current version should pass through unchanged
      expect(migrated.length).toBe(2);
      expect(migrated[0].id).toBe('op-1');
      expect(migrated[1].id).toBe('op-2');
    });
  });
});
