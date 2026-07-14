import type { SchemaMigration } from '../migration.types';

/**
 * Compatibility barrier for delete-wins project deletions.
 *
 * The state shape and historical operations are unchanged. New schema-v4
 * deleteProject operations carry an explicit payload marker; leaving older
 * operations untouched ensures they retain their original timestamp-based LWW
 * semantics after receiver-side migration.
 */
export const ProjectDeleteWinsBarrierMigration_v3v4: SchemaMigration = {
  fromVersion: 3,
  toVersion: 4,
  description: 'Gate marked project delete-wins conflict semantics',
  requiresOperationMigration: false,
  migrateState: (state: unknown): unknown => state,
};
