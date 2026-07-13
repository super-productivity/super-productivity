import type { SchemaMigration } from '../migration.types';

/**
 * Compatibility barrier for synthetic LWW replacement payloads.
 *
 * Schema v3 introduces replacement-mode LWW envelopes whose omitted fields
 * are intentionally cleared. A v2 client ignores the mode and applies those
 * payloads as patches, which can silently diverge. No stored state shape needs
 * transformation, but stamping all newly produced operations as v3 makes v2
 * clients stop at the existing newer-schema gate instead of misapplying them.
 * Historical v2 operations retain their patch semantics when migrated.
 */
export const LwwReplacementBarrierMigration_v2v3: SchemaMigration = {
  fromVersion: 2,
  toVersion: 3,
  description: 'Gate replacement-mode LWW operations from older clients.',
  migrateState: (state: unknown): unknown => state,
  requiresOperationMigration: false,
};
