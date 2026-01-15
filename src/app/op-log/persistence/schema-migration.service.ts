import { Injectable } from '@angular/core';
import { Operation, VectorClock } from '../core/operation.types';
import { OpLog } from '../../core/log';
import {
  CURRENT_SCHEMA_VERSION as SHARED_CURRENT_SCHEMA_VERSION,
  MAX_VERSION_SKIP as SHARED_MAX_VERSION_SKIP,
  MIN_SUPPORTED_SCHEMA_VERSION as SHARED_MIN_SUPPORTED_SCHEMA_VERSION,
  MIGRATIONS,
  migrateState,
  migrateOperation as sharedMigrateOperation,
  stateNeedsMigration,
  operationNeedsMigration as sharedOperationNeedsMigration,
  validateMigrationRegistry,
  type SchemaMigration,
  type OperationLike,
} from '@sp/shared-schema';

// Re-export shared constants for backwards compatibility
export const CURRENT_SCHEMA_VERSION = SHARED_CURRENT_SCHEMA_VERSION;
export const MAX_VERSION_SKIP = SHARED_MAX_VERSION_SKIP;
export const MIN_SUPPORTED_SCHEMA_VERSION = SHARED_MIN_SUPPORTED_SCHEMA_VERSION;

// Re-export types
export type { SchemaMigration };

/**
 * Interface for state cache that may need migration.
 */
export interface MigratableStateCache {
  state: unknown;
  lastAppliedOpSeq: number;
  vectorClock: VectorClock;
  compactedAt: number;
  schemaVersion?: number; // Optional for backward compatibility with old caches
}

/**
 * Service responsible for migrating state cache snapshots and operations
 * between schema versions.
 *
 * This is an Angular wrapper around the shared schema migration functions
 * from @sp/shared-schema package.
 *
 * When the application's state structure changes (e.g., new fields, renamed properties),
 * migrations ensure old snapshots and operations can be upgraded to work with new code.
 *
 * Migration strategy for state (A.7.1):
 * 1. Load snapshot from SUP_OPS
 * 2. Check if schemaVersion < CURRENT_SCHEMA_VERSION
 * 3. If so, run migrations sequentially until current version
 * 4. Save migrated snapshot back to SUP_OPS
 * 5. Continue with normal hydration
 *
 * Migration strategy for operations (A.7.13):
 * 1. Load tail ops after snapshot
 * 2. For each op where op.schemaVersion < CURRENT_SCHEMA_VERSION:
 *    - Run migrateOperation() to transform payload
 *    - Drop op if migration returns null
 * 3. Apply migrated ops to migrated state
 *
 * @see docs/ai/sync/operation-log-architecture.md A.7
 */
@Injectable({ providedIn: 'root' })
export class SchemaMigrationService {
  constructor() {
    // Validate migration registry on startup (A.7.15)
    this._validateMigrationRegistry();
  }

  /**
   * Validates that all migrations with requiresOperationMigration=true
   * have a migrateOperation function defined.
   */
  private _validateMigrationRegistry(): void {
    const errors = validateMigrationRegistry();
    if (errors.length > 0) {
      throw new Error(
        `SchemaMigrationService: Invalid migration registry:\n${errors.join('\n')}`,
      );
    }
  }

  /**
   * Migrates a state cache to the current schema version if needed.
   * Returns the migrated cache, or the original if no migration was needed.
   */
  migrateStateIfNeeded(cache: MigratableStateCache): MigratableStateCache {
    // Handle old caches that don't have schemaVersion
    const currentVersion = cache.schemaVersion ?? 1;

    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      // Already at current version
      return {
        ...cache,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
    }

    OpLog.normal(
      `SchemaMigrationService: Migrating state from v${currentVersion} to v${CURRENT_SCHEMA_VERSION}`,
    );

    const result = migrateState(cache.state, currentVersion, CURRENT_SCHEMA_VERSION);

    if (!result.success) {
      throw new Error(`SchemaMigrationService: ${result.error}`);
    }

    OpLog.normal(
      `SchemaMigrationService: State migration complete. Now at v${CURRENT_SCHEMA_VERSION}`,
    );

    return {
      ...cache,
      state: result.data,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * @deprecated Use migrateStateIfNeeded instead
   */
  migrateIfNeeded(cache: MigratableStateCache): MigratableStateCache {
    return this.migrateStateIfNeeded(cache);
  }

  /**
   * Migrates a single operation to the current schema version if needed.
   * Returns null if the operation should be dropped (e.g., for removed features).
   *
   * @param op - The operation to migrate
   * @returns The migrated operation, or null if it should be dropped
   */
  migrateOperation(op: Operation): Operation | null {
    const opVersion = op.schemaVersion ?? 1;

    if (opVersion >= CURRENT_SCHEMA_VERSION) {
      return op;
    }

    // Convert to OperationLike for the shared function
    const opLike: OperationLike = {
      id: op.id,
      opType: op.opType,
      entityType: op.entityType,
      entityId: op.entityId,
      entityIds: op.entityIds,
      payload: op.payload,
      schemaVersion: opVersion,
    };

    const result = sharedMigrateOperation(opLike, CURRENT_SCHEMA_VERSION);

    if (!result.success) {
      throw new Error(`SchemaMigrationService: ${result.error}`);
    }

    if (result.data === null || result.data === undefined) {
      return null;
    }

    // Merge migrated fields back into the original operation
    return {
      ...op,
      opType: result.data.opType as Operation['opType'],
      entityType: result.data.entityType as Operation['entityType'],
      entityId: result.data.entityId,
      payload: result.data.payload,
      schemaVersion: result.data.schemaVersion,
    };
  }

  /**
   * Migrates an array of operations, filtering out any that should be dropped.
   *
   * @param ops - The operations to migrate
   * @returns Array of migrated operations (dropped operations excluded)
   */
  migrateOperations(ops: Operation[]): Operation[] {
    const migrated: Operation[] = [];

    for (const op of ops) {
      const migratedOp = this.migrateOperation(op);
      if (migratedOp !== null) {
        migrated.push(migratedOp);
      } else {
        OpLog.normal(
          `SchemaMigrationService: Dropped operation ${op.id} (${op.actionType}) during migration`,
        );
      }
    }

    return migrated;
  }

  /**
   * Returns true if the cache needs migration.
   */
  needsMigration(cache: MigratableStateCache): boolean {
    return stateNeedsMigration(cache.schemaVersion, CURRENT_SCHEMA_VERSION);
  }

  /**
   * Returns true if the operation needs migration.
   */
  operationNeedsMigration(op: Operation): boolean {
    return sharedOperationNeedsMigration(
      {
        id: op.id,
        opType: op.opType,
        entityType: op.entityType,
        payload: op.payload,
        schemaVersion: op.schemaVersion ?? 1,
      },
      CURRENT_SCHEMA_VERSION,
    );
  }

  /**
   * Returns the current schema version.
   */
  getCurrentVersion(): number {
    return CURRENT_SCHEMA_VERSION;
  }

  /**
   * Returns all registered migrations (for debugging/testing).
   */
  getMigrations(): readonly SchemaMigration[] {
    return MIGRATIONS;
  }
}
