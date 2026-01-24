import type { SchemaMigration } from '../migration.types';
import { MiscToTasksSettingsMigration_v1v2 } from './misc-to-tasks-settings-migration-v1-to-v2';

/**
 * Registry of all schema migrations.
 * Migrations are applied sequentially from the source version.
 *
 * To add a new migration:
 * 1. Increment CURRENT_SCHEMA_VERSION in schema-version.ts
 * 2. Create migration file (e.g., v1-to-v2.ts)
 * 3. Add to this array
 *
 * Example migration:
 * ```typescript
 * {
 *   fromVersion: 1,
 *   toVersion: 2,
 *   description: 'Rename task.estimate to task.timeEstimate',
 *   requiresOperationMigration: true,
 *   migrateState: (state) => {
 *     // Transform state structure
 *   },
 *   migrateOperation: (op) => {
 *     // Transform operation payload, or return null to drop
 *   },
 * }
 * ```
 */
export const MIGRATIONS: SchemaMigration[] = [MiscToTasksSettingsMigration_v1v2];
