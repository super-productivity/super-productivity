/**
 * Minimal operation interface for migrations.
 *
 * This is a simplified version of the full `Operation` type from the main app.
 * We use primitives (strings) instead of enums/union types because:
 *
 * 1. **Package isolation**: This package is shared between the client app and
 *    super-sync-server. Importing from `src/app/` would create circular deps.
 *
 * 2. **Portability**: Migrations must be pure functions that run anywhere
 *    (server, tests, workers) without Angular or app-specific dependencies.
 *
 * 3. **Stability**: Using strings instead of enums means migrations won't
 *    break if OpType or EntityType values change in the main app.
 */
export interface OperationLike {
  id: string;
  /** High-level operation category (e.g., 'CRT', 'UPD', 'DEL') */
  opType: string;
  /** Entity type being modified (e.g., 'TASK', 'PROJECT', 'TAG') */
  entityType: string;
  entityId?: string;
  entityIds?: string[];
  payload: unknown;
  schemaVersion: number;
}

/**
 * Defines a schema migration from one version to the next.
 * Migrations must be pure functions with no external dependencies.
 */
export interface SchemaMigration {
  /** Source version this migration applies to */
  fromVersion: number;

  /** Target version after migration */
  toVersion: number;

  /** Human-readable description of what changed */
  description: string;

  /**
   * Transform a full state snapshot from fromVersion to toVersion.
   * Must be a pure function.
   * @param state - The state object (shape depends on fromVersion)
   * @returns Transformed state for toVersion
   */
  migrateState: (state: unknown) => unknown;

  /**
   * Transform an individual operation payload.
   * Return null to drop the operation entirely (e.g., for removed features).
   * Only required for non-additive changes (renames, removals, type changes).
   */
  migrateOperation?: (op: OperationLike) => OperationLike | null;

  /**
   * Explicit declaration that forces migration authors to think about
   * whether operations need migration. If true but migrateOperation
   * is undefined, validation fails at startup.
   */
  requiresOperationMigration: boolean;
}

/**
 * Result of a migration operation.
 */
export interface MigrationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  migratedFromVersion?: number;
  migratedToVersion?: number;
}

/**
 * State cache with schema version for migration tracking.
 */
export interface MigratableStateCache {
  state: unknown;
  schemaVersion?: number;
}
