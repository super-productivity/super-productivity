import type { SchemaMigration } from '../migration.types';

/**
 * Compatibility barrier for synthetic LWW replacement payloads.
 *
 * Schema v3 introduces replacement-mode LWW envelopes whose omitted fields
 * are intentionally cleared. NOTE: this stamp does NOT stop released clients.
 * Every v17.0.0–v18.14.0 receiver tolerates ops up to schema 5 (old
 * MAX_VERSION_SKIP band) and applies them unmigrated: it ignores
 * `lwwUpdateMode` and applies the envelope's actionPayload via updateOne —
 * correct for 'patch' ops, and a near-replacement for 'replace' ops where
 * only omitted-to-clear fields fail to propagate. The stamp is a fence for
 * post-v18.14.0 receivers only, which block any newer-schema op outright. See the
 * bump policy in schema-version.ts before relying on a version fence.
 * Historical v2 operations retain their patch semantics when migrated.
 */
export const LwwReplacementBarrierMigration_v2v3: SchemaMigration = {
  fromVersion: 2,
  toVersion: 3,
  description: 'Gate replacement-mode LWW operations from older clients.',
  migrateState: (state: unknown): unknown => state,
  requiresOperationMigration: false,
};
