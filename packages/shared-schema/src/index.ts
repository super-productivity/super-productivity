// Schema version constants
export {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_VERSION_SKIP,
} from './schema-version';

// Types
export type {
  OperationLike,
  SchemaMigration,
  MigrationResult,
  MigratableStateCache,
} from './migration.types';

// Migration functions
export {
  migrateState,
  migrateOperation,
  migrateOperations,
  stateNeedsMigration,
  operationNeedsMigration,
  validateMigrationRegistry,
  getCurrentSchemaVersion,
} from './migrate';

// Migration registry (for inspection/debugging)
export { MIGRATIONS } from './migrations/index';

// Vector clock types and comparison (shared between client and server)
export type { VectorClock, VectorClockComparison } from './vector-clock';
export { compareVectorClocks, mergeVectorClocks } from './vector-clock';

// Entity types (shared between client and server)
export type { EntityType } from './entity-types';
export { ENTITY_TYPES } from './entity-types';
