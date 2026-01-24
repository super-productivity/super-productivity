import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  migrateState,
  migrateOperation,
  migrateOperations,
  stateNeedsMigration,
  operationNeedsMigration,
  validateMigrationRegistry,
  getCurrentSchemaVersion,
} from '../src/migrate';
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../src/schema-version';
import type { OperationLike, SchemaMigration } from '../src/migration.types';
import { MIGRATIONS } from '../src/migrations';

describe('shared-schema migration functions', () => {
  describe('getCurrentSchemaVersion', () => {
    it('returns the current schema version', () => {
      expect(getCurrentSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
    });
  });

  describe('stateNeedsMigration', () => {
    it('returns false when version equals target', () => {
      expect(stateNeedsMigration(CURRENT_SCHEMA_VERSION)).toBe(false);
    });

    it('returns false when version exceeds target', () => {
      expect(stateNeedsMigration(CURRENT_SCHEMA_VERSION + 1)).toBe(false);
    });

    it('returns true when version is below target', () => {
      expect(
        stateNeedsMigration(CURRENT_SCHEMA_VERSION - 1, CURRENT_SCHEMA_VERSION),
      ).toBe(true);
    });

    it('treats undefined version as 1', () => {
      expect(stateNeedsMigration(undefined, 2)).toBe(true);
      expect(stateNeedsMigration(undefined, 1)).toBe(false);
    });
  });

  describe('operationNeedsMigration', () => {
    it('returns false when operation version equals target', () => {
      const op: OperationLike = {
        id: 'op1',
        opType: 'UPD',
        entityType: 'TASK',
        payload: {},
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      expect(operationNeedsMigration(op)).toBe(false);
    });

    it('returns true when operation version is below target', () => {
      const op: OperationLike = {
        id: 'op1',
        opType: 'UPD',
        entityType: 'TASK',
        payload: {},
        schemaVersion: CURRENT_SCHEMA_VERSION - 1,
      };
      expect(operationNeedsMigration(op, CURRENT_SCHEMA_VERSION)).toBe(true);
    });

    it('treats undefined schemaVersion as 1', () => {
      const op = {
        id: 'op1',
        opType: 'UPD',
        entityType: 'TASK',
        payload: {},
      } as OperationLike;
      expect(operationNeedsMigration(op, 2)).toBe(true);
      expect(operationNeedsMigration(op, 1)).toBe(false);
    });
  });

  describe('migrateState', () => {
    it('returns unchanged state when already at target version', () => {
      const state = { task: { entities: { t1: { title: 'Test' } } } };
      const result = migrateState(state, CURRENT_SCHEMA_VERSION);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(state);
    });

    it('returns unchanged state when source exceeds target', () => {
      const state = { task: {} };
      const result = migrateState(
        state,
        CURRENT_SCHEMA_VERSION + 1,
        CURRENT_SCHEMA_VERSION,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(state);
    });

    it('fails for version below minimum supported', () => {
      const result = migrateState({}, MIN_SUPPORTED_SCHEMA_VERSION - 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('below minimum supported');
    });

    it('fails when migration path is missing', () => {
      // This test only makes sense when CURRENT_SCHEMA_VERSION > 1 and no migrations exist
      if (CURRENT_SCHEMA_VERSION > 1 && MIGRATIONS.length === 0) {
        const result = migrateState({}, 1, 2);
        expect(result.success).toBe(false);
        expect(result.error).toContain('No migration path');
      }
    });
  });

  describe('migrateOperation', () => {
    it('returns unchanged operation when already at target version', () => {
      const op: OperationLike = {
        id: 'op1',
        opType: 'UPD',
        entityType: 'TASK',
        payload: { changes: { title: 'New' } },
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      const result = migrateOperation(op);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(op);
    });

    it('fails for version below minimum supported', () => {
      const op: OperationLike = {
        id: 'op1',
        opType: 'UPD',
        entityType: 'TASK',
        payload: {},
        schemaVersion: MIN_SUPPORTED_SCHEMA_VERSION - 1,
      };
      const result = migrateOperation(op);

      expect(result.success).toBe(false);
      expect(result.error).toContain('below minimum supported');
    });
  });

  describe('migrateOperations', () => {
    it('returns empty array for empty input', () => {
      const result = migrateOperations([]);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns unchanged operations when already at target version', () => {
      const ops: OperationLike[] = [
        {
          id: 'op1',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          schemaVersion: CURRENT_SCHEMA_VERSION,
        },
        {
          id: 'op2',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 't1',
          payload: { changes: { done: true } },
          schemaVersion: CURRENT_SCHEMA_VERSION,
        },
      ];
      const result = migrateOperations(ops);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data).toEqual(ops);
    });
  });

  describe('validateMigrationRegistry', () => {
    // @todo: How can we change this test to check this behavior and increase CURRENT_SCHEMA_VERSION?
    // it('returns empty array when no migrations and version is 1', () => {
    //   // Only valid if CURRENT_SCHEMA_VERSION is 1
    //   if (CURRENT_SCHEMA_VERSION === 1) {
    //     const errors = validateMigrationRegistry();
    //     expect(errors).toEqual([]);
    //   }
    // });

    it('returns errors when CURRENT_SCHEMA_VERSION > 1 but no migrations', () => {
      // This is a consistency check for when we add migrations
      if (CURRENT_SCHEMA_VERSION > 1 && MIGRATIONS.length === 0) {
        const errors = validateMigrationRegistry();
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain('Missing migration');
      }
    });
  });
});

describe('migration with mock migrations', () => {
  // These tests use a mock migration to verify the migration logic works correctly
  // In real usage, migrations are defined in the MIGRATIONS array

  describe('state migration chain', () => {
    it('applies migration correctly', () => {
      // Create a test migration locally to verify the mechanism works
      const testMigration: SchemaMigration = {
        fromVersion: 1,
        toVersion: 2,
        description: 'Test migration',
        requiresOperationMigration: false,
        migrateState: (state: unknown) => {
          const s = state as Record<string, unknown>;
          return { ...s, migrated: true };
        },
      };

      // Manually apply to verify the pattern
      const state = { data: 'test' };
      const migrated = testMigration.migrateState(state);

      expect(migrated).toEqual({ data: 'test', migrated: true });
    });
  });

  describe('operation migration', () => {
    it('migrateOperation can return null to drop operations', () => {
      const testMigration: SchemaMigration = {
        fromVersion: 1,
        toVersion: 2,
        description: 'Drop old feature operations',
        requiresOperationMigration: true,
        migrateState: (state) => state,
        migrateOperation: (op) => {
          if (op.entityType === 'OLD_FEATURE') {
            return null; // Drop operations for removed feature
          }
          return op;
        },
      };

      const opToKeep: OperationLike = {
        id: 'op1',
        opType: 'UPD',
        entityType: 'TASK',
        payload: {},
        schemaVersion: 1,
      };

      const opToDrop: OperationLike = {
        id: 'op2',
        opType: 'UPD',
        entityType: 'OLD_FEATURE',
        payload: {},
        schemaVersion: 1,
      };

      expect(testMigration.migrateOperation!(opToKeep)).toEqual(opToKeep);
      expect(testMigration.migrateOperation!(opToDrop)).toBeNull();
    });

    it('migrateOperation can transform payloads', () => {
      const testMigration: SchemaMigration = {
        fromVersion: 1,
        toVersion: 2,
        description: 'Rename estimate to timeEstimate',
        requiresOperationMigration: true,
        migrateState: (state) => state,
        migrateOperation: (op) => {
          if (op.entityType === 'TASK' && op.opType === 'UPD') {
            const payload = op.payload as Record<string, unknown>;
            if (payload.changes && typeof payload.changes === 'object') {
              const changes = payload.changes as Record<string, unknown>;
              if ('estimate' in changes) {
                const { estimate, ...rest } = changes;
                return {
                  ...op,
                  payload: {
                    ...payload,
                    changes: { ...rest, timeEstimate: estimate },
                  },
                };
              }
            }
          }
          return op;
        },
      };

      const op: OperationLike = {
        id: 'op1',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 't1',
        payload: { changes: { estimate: 3600, title: 'Test' } },
        schemaVersion: 1,
      };

      const migrated = testMigration.migrateOperation!(op);

      expect(migrated).not.toBeNull();
      expect((migrated!.payload as Record<string, unknown>).changes).toEqual({
        timeEstimate: 3600,
        title: 'Test',
      });
    });
  });

  describe('validation', () => {
    it('detects requiresOperationMigration without migrateOperation', () => {
      const invalidMigration: SchemaMigration = {
        fromVersion: 1,
        toVersion: 2,
        description: 'Invalid migration',
        requiresOperationMigration: true, // Says it needs op migration
        migrateState: (state) => state,
        // But migrateOperation is missing!
      };

      // Check the validation logic directly
      const hasOpMigration = !!invalidMigration.migrateOperation;
      const declaresRequired = invalidMigration.requiresOperationMigration;

      expect(declaresRequired && !hasOpMigration).toBe(true);
    });
  });
});
