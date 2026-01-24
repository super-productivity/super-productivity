import { TestBed } from '@angular/core/testing';
import {
  SchemaMigrationService,
  MigratableStateCache,
  CURRENT_SCHEMA_VERSION,
} from './schema-migration.service';
import { ActionType, Operation, OpType } from '../core/operation.types';

describe('SchemaMigrationService', () => {
  let service: SchemaMigrationService;

  const createMockCache = (
    schemaVersion?: number,
    state: unknown = { testData: 'value' },
  ): MigratableStateCache => ({
    state,
    lastAppliedOpSeq: 100,
    vectorClock: { testClient: 10 },
    compactedAt: Date.now(),
    schemaVersion,
  });

  const createMockOperation = (
    id: string,
    schemaVersion: number = CURRENT_SCHEMA_VERSION,
  ): Operation => ({
    id,
    actionType: '[Test] Action' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-123',
    payload: { title: 'Test' },
    clientId: 'testClient',
    vectorClock: { testClient: 1 },
    timestamp: Date.now(),
    schemaVersion,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SchemaMigrationService],
    });
    service = TestBed.inject(SchemaMigrationService);
  });

  describe('getCurrentVersion', () => {
    it('should return the current schema version', () => {
      expect(service.getCurrentVersion()).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should return 2 as the current version', () => {
      // Current implementation is at version 2 after migration from MiscConfig to TasksConfig
      expect(service.getCurrentVersion()).toBe(2);
    });
  });

  describe('getMigrations', () => {
    it('should return an array of migrations', () => {
      const migrations = service.getMigrations();
      expect(Array.isArray(migrations)).toBeTrue();
    });

    it('should return empty array for initial version', () => {
      // No migrations defined yet for version 1
      const migrations = service.getMigrations(1, 1);
      expect(migrations.length).toBe(0);
    });
  });

  describe('needsMigration', () => {
    it('should return false for cache at current version', () => {
      const cache = createMockCache(CURRENT_SCHEMA_VERSION);
      expect(service.needsMigration(cache)).toBeFalse();
    });

    it('should return true for cache with undefined schemaVersion (defaults to 1)', () => {
      const cache = createMockCache(undefined);
      // When schemaVersion is undefined, it defaults to 1
      // Since CURRENT_SCHEMA_VERSION is 2, migration is needed
      expect(service.needsMigration(cache)).toBeTrue();
    });

    it('should return true for cache with older version', () => {
      const cache = createMockCache(1); // Version 1 is older than current version 2
      expect(service.needsMigration(cache)).toBeTrue();
    });
  });

  describe('operationNeedsMigration', () => {
    it('should return false for operation at current version', () => {
      const op = createMockOperation('op-1', CURRENT_SCHEMA_VERSION);
      expect(service.operationNeedsMigration(op)).toBeFalse();
    });

    it('should return true for operation with undefined schemaVersion (defaults to 1)', () => {
      const op = createMockOperation('op-1');
      op.schemaVersion = undefined as any;
      // Since CURRENT_SCHEMA_VERSION is 2, migration is needed
      expect(service.operationNeedsMigration(op)).toBeTrue();
    });

    it('should return true for operation with older version', () => {
      const op = createMockOperation('op-1', 1);
      expect(service.operationNeedsMigration(op)).toBeTrue();
    });
  });

  describe('migrateStateIfNeeded', () => {
    it('should return cache unchanged if already at current version', () => {
      const cache = createMockCache(CURRENT_SCHEMA_VERSION);
      const result = service.migrateStateIfNeeded(cache);

      expect(result.state).toEqual(cache.state);
      expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should set schemaVersion if undefined', () => {
      const cache = createMockCache(undefined);
      const result = service.migrateStateIfNeeded(cache);

      expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should preserve other cache properties', () => {
      const cache = createMockCache(CURRENT_SCHEMA_VERSION);
      const result = service.migrateStateIfNeeded(cache);

      expect(result.lastAppliedOpSeq).toBe(cache.lastAppliedOpSeq);
      expect(result.vectorClock).toEqual(cache.vectorClock);
      expect(result.compactedAt).toBe(cache.compactedAt);
    });
  });

  describe('migrateOperation', () => {
    it('should return operation unchanged if at current version', () => {
      const op = createMockOperation('op-1', CURRENT_SCHEMA_VERSION);
      const result = service.migrateOperation(op);

      expect(result).toEqual(op);
    });

    it('should handle operation with undefined schemaVersion', () => {
      const op = createMockOperation('op-1');
      op.schemaVersion = undefined as any;
      const result = service.migrateOperation(op);

      // Should return the operation (with undefined treated as version 1)
      expect(result).not.toBeNull();
    });
  });

  describe('migrateOperations', () => {
    it('should return empty array for empty input', () => {
      const result = service.migrateOperations([]);
      expect(result).toEqual([]);
    });

    it('should return all operations if none need migration', () => {
      const ops = [
        createMockOperation('op-1', CURRENT_SCHEMA_VERSION),
        createMockOperation('op-2', CURRENT_SCHEMA_VERSION),
        createMockOperation('op-3', CURRENT_SCHEMA_VERSION),
      ];

      const result = service.migrateOperations(ops);

      expect(result.length).toBe(3);
      expect(result[0].id).toBe('op-1');
      expect(result[1].id).toBe('op-2');
      expect(result[2].id).toBe('op-3');
    });

    it('should preserve operation order', () => {
      const ops = [
        createMockOperation('op-a', CURRENT_SCHEMA_VERSION),
        createMockOperation('op-b', CURRENT_SCHEMA_VERSION),
        createMockOperation('op-c', CURRENT_SCHEMA_VERSION),
      ];

      const result = service.migrateOperations(ops);

      expect(result.map((op) => op.id)).toEqual(['op-a', 'op-b', 'op-c']);
    });
  });

  describe('migrateIfNeeded (deprecated)', () => {
    it('should be an alias for migrateStateIfNeeded', () => {
      const cache = createMockCache(CURRENT_SCHEMA_VERSION);

      const result1 = service.migrateIfNeeded(cache);
      const result2 = service.migrateStateIfNeeded(cache);

      expect(result1.state).toEqual(result2.state);
      expect(result1.schemaVersion).toBe(result2.schemaVersion);
    });
  });
});
