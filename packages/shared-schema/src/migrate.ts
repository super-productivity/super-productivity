import { MIGRATIONS } from './migrations/index';
import { CURRENT_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from './schema-version';
import type { MigrationResult, OperationLike, SchemaMigration } from './migration.types';

/**
 * Find a migration that transforms from the given version.
 */
function findMigration(fromVersion: number): SchemaMigration | undefined {
  return MIGRATIONS.find((m) => m.fromVersion === fromVersion);
}

/**
 * Check if a state needs migration.
 */
export function stateNeedsMigration(
  schemaVersion: number | undefined,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): boolean {
  const version = schemaVersion ?? 1;
  return version < targetVersion;
}

/**
 * Check if an operation needs migration.
 */
export function operationNeedsMigration(
  op: OperationLike,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): boolean {
  const version = op.schemaVersion ?? 1;
  return version < targetVersion;
}

/**
 * Migrate state from sourceVersion to targetVersion.
 * Pure function - no side effects.
 *
 * @param state - The state object to migrate
 * @param sourceVersion - Current version of the state
 * @param targetVersion - Target version (defaults to CURRENT_SCHEMA_VERSION)
 * @returns Migration result with transformed state or error
 */
export function migrateState(
  state: unknown,
  sourceVersion: number,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): MigrationResult<unknown> {
  // Validate source version
  if (sourceVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return {
      success: false,
      error: `Source version ${sourceVersion} is below minimum supported ${MIN_SUPPORTED_SCHEMA_VERSION}`,
    };
  }

  // Already at or past target version
  if (sourceVersion >= targetVersion) {
    return { success: true, data: state };
  }

  let currentState = state;
  let version = sourceVersion;

  // Apply migrations sequentially
  while (version < targetVersion) {
    const migration = findMigration(version);
    if (!migration) {
      return {
        success: false,
        error: `No migration path from version ${version} to ${version + 1}`,
        migratedFromVersion: sourceVersion,
        migratedToVersion: version,
      };
    }

    try {
      currentState = migration.migrateState(currentState);
      version = migration.toVersion;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Migration v${migration.fromVersion}->v${migration.toVersion} failed: ${errorMessage}`,
        migratedFromVersion: sourceVersion,
        migratedToVersion: version,
      };
    }
  }

  return {
    success: true,
    data: currentState,
    migratedFromVersion: sourceVersion,
    migratedToVersion: version,
  };
}

/**
 * Migrate a single operation from its version to targetVersion.
 * Returns null if the operation should be dropped (e.g., removed feature).
 * Pure function - no side effects.
 *
 * @param op - The operation to migrate
 * @param targetVersion - Target version (defaults to CURRENT_SCHEMA_VERSION)
 * @returns Migration result with transformed operation, null, or error
 */
export function migrateOperation(
  op: OperationLike,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): MigrationResult<OperationLike | null> {
  const sourceVersion = op.schemaVersion ?? 1;

  // Validate source version
  if (sourceVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return {
      success: false,
      error: `Operation schema version ${sourceVersion} is below minimum supported ${MIN_SUPPORTED_SCHEMA_VERSION}`,
    };
  }

  // Already at or past target version
  if (sourceVersion >= targetVersion) {
    return { success: true, data: op };
  }

  let currentOp: OperationLike | null = { ...op };
  let version = sourceVersion;

  // Apply migrations sequentially
  while (version < targetVersion && currentOp !== null) {
    const migration = findMigration(version);
    if (!migration) {
      return {
        success: false,
        error: `No migration path from version ${version} to ${version + 1}`,
        migratedFromVersion: sourceVersion,
        migratedToVersion: version,
      };
    }

    try {
      if (migration.migrateOperation) {
        currentOp = migration.migrateOperation(currentOp);
        if (currentOp !== null) {
          // Update version on the migrated operation
          currentOp = { ...currentOp, schemaVersion: migration.toVersion };
        }
      } else {
        // No operation migration defined - just update version
        currentOp = { ...currentOp, schemaVersion: migration.toVersion };
      }
      // Track version even if operation was dropped (null)
      // This ensures migratedToVersion reflects where we actually stopped
      version = migration.toVersion;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Operation migration v${migration.fromVersion}->v${migration.toVersion} failed: ${errorMessage}`,
        migratedFromVersion: sourceVersion,
        migratedToVersion: version,
      };
    }
  }

  return {
    success: true,
    data: currentOp,
    migratedFromVersion: sourceVersion,
    migratedToVersion: version,
  };
}

/**
 * Migrate an array of operations.
 * Drops operations that return null from migration.
 *
 * @param ops - Array of operations to migrate
 * @param targetVersion - Target version (defaults to CURRENT_SCHEMA_VERSION)
 * @returns Array of migrated operations (dropped operations excluded)
 */
export function migrateOperations(
  ops: OperationLike[],
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): MigrationResult<OperationLike[]> {
  const migrated: OperationLike[] = [];
  let droppedCount = 0;

  for (const op of ops) {
    const result = migrateOperation(op, targetVersion);
    if (!result.success) {
      return {
        success: false,
        error: `Failed to migrate operation ${op.id}: ${result.error}`,
      };
    }

    if (result.data !== null && result.data !== undefined) {
      migrated.push(result.data);
    } else {
      droppedCount++;
    }
  }

  return {
    success: true,
    data: migrated,
    migratedFromVersion: ops.length > 0 ? (ops[0].schemaVersion ?? 1) : 1,
    migratedToVersion: targetVersion,
  };
}

/**
 * Validate the migration registry at startup.
 * Returns an array of error messages (empty if valid).
 */
export function validateMigrationRegistry(): string[] {
  const errors: string[] = [];

  for (const migration of MIGRATIONS) {
    // Check requiresOperationMigration consistency
    if (migration.requiresOperationMigration && !migration.migrateOperation) {
      errors.push(
        `Migration v${migration.fromVersion}->v${migration.toVersion} declares ` +
          `requiresOperationMigration=true but migrateOperation is not defined`,
      );
    }

    // Check version ordering
    if (migration.toVersion !== migration.fromVersion + 1) {
      errors.push(
        `Migration v${migration.fromVersion}->v${migration.toVersion} has invalid version jump ` +
          `(expected toVersion = ${migration.fromVersion + 1})`,
      );
    }
  }

  // Check for gaps in migration chain
  const versions = new Set(MIGRATIONS.map((m) => m.fromVersion));
  for (let v = MIN_SUPPORTED_SCHEMA_VERSION; v < CURRENT_SCHEMA_VERSION; v++) {
    if (!versions.has(v)) {
      errors.push(
        `Missing migration from version ${v} to ${v + 1}. ` +
          `Current version is ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
  }

  // Check for duplicate fromVersions
  const seenVersions = new Map<number, number>();
  for (const migration of MIGRATIONS) {
    const count = seenVersions.get(migration.fromVersion) ?? 0;
    seenVersions.set(migration.fromVersion, count + 1);
    if (count > 0) {
      errors.push(`Duplicate migration for version ${migration.fromVersion}`);
    }
  }

  return errors;
}

/**
 * Get the current schema version.
 */
export function getCurrentSchemaVersion(): number {
  return CURRENT_SCHEMA_VERSION;
}
