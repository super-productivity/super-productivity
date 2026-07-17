import type { SchemaMigration } from '../migration.types';

/**
 * Compatibility barrier for delete-wins project deletions.
 *
 * The state shape and historical operations are unchanged. New schema-v4
 * deleteProject operations carry an explicit payload marker; leaving older
 * operations untouched ensures they retain their original timestamp-based LWW
 * semantics after receiver-side migration.
 *
 * NOTE: released pre-v4 clients (v17.0.0–v18.14.0) apply v4 ops unmigrated
 * and treat the marker as an inert actionPayload key — they keep resolving
 * project-delete conflicts by timestamp LWW. The version stamp fences only
 * post-v18.14.0 receivers, which block newer-schema ops outright. See the bump
 * policy in schema-version.ts.
 */
export const ProjectDeleteWinsBarrierMigration_v3v4: SchemaMigration = {
  fromVersion: 3,
  toVersion: 4,
  description: 'Gate marked project delete-wins conflict semantics',
  requiresOperationMigration: false,
  migrateState: (state: unknown): unknown => state,
};
