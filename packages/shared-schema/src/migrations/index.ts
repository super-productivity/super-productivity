import type { SchemaMigration } from '../migration.types';
import { MiscToTasksSettingsMigration_v1v2 } from './misc-to-tasks-settings-migration-v1-to-v2';
import { LwwReplacementBarrierMigration_v2v3 } from './lww-replacement-barrier-v2-to-v3';
import { ProjectDeleteWinsBarrierMigration_v3v4 } from './project-delete-wins-barrier-v3-to-v4';

/**
 * Registry of all schema migrations.
 * Migrations are applied sequentially from the source version.
 *
 * To add a new migration:
 * 0. STOP — do you actually need a version bump? A bump is a near-one-way fence:
 *    it hard-blocks every lagging post-v18.14.0 client (frozen cursor) and can't
 *    be undone once ops carry the new version. If old clients can apply the op
 *    unmigrated, gate the new semantics on a payload marker (envelope pattern)
 *    and DON'T bump. Only bump for a transforming migration (renamed/removed
 *    field, dropped op) or a semantic you must hard-fence. See the Bump Policy in
 *    schema-version.ts and operation-log-architecture.md §A.7.11. (v4/#9009 was
 *    bumped for a marker-only change that didn't need it — don't repeat that.)
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
export const MIGRATIONS: SchemaMigration[] = [
  MiscToTasksSettingsMigration_v1v2,
  LwwReplacementBarrierMigration_v2v3,
  ProjectDeleteWinsBarrierMigration_v3v4,
];
