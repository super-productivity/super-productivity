import type { SchemaMigration } from '../migration.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Compatibility barrier for synthetic LWW replacement payloads, plus an idle
 * config backfill.
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
 *
 * State transform: v2 snapshots (v18.14 and earlier) can lack
 * `globalConfig.idle.isSuppressIdleDuringFocusMode`, which #8965 added as a
 * required field WITHOUT its own schema bump. The v4 state validator requires
 * it, and the migration path validates the raw snapshot BEFORE the loadAllData
 * reducer can fill its default — so on upgrade the whole snapshot fails
 * validation and hydration aborts. Backfill the opt-in default (false) here to
 * match DEFAULT_GLOBAL_CONFIG.idle, but only when the field is not already a
 * boolean so an existing user choice is never clobbered. A missing `idle`
 * section is left to the reducer's own default merge.
 *
 * The hardcoded `false` is intentionally decoupled from DEFAULT_GLOBAL_CONFIG:
 * a migration must freeze the historical default even if the live default later
 * changes (and shared-schema cannot import app code).
 */
export const LwwReplacementBarrierMigration_v2v3: SchemaMigration = {
  fromVersion: 2,
  toVersion: 3,
  description:
    'Gate replacement-mode LWW operations; backfill idle.isSuppressIdleDuringFocusMode default.',
  migrateState: (state: unknown): unknown => {
    if (!isRecord(state)) {
      return state;
    }
    const globalConfig = state.globalConfig;
    if (!isRecord(globalConfig)) {
      return state;
    }
    const idle = globalConfig.idle;
    if (!isRecord(idle) || typeof idle.isSuppressIdleDuringFocusMode === 'boolean') {
      return state;
    }
    return {
      ...state,
      globalConfig: {
        ...globalConfig,
        idle: { ...idle, isSuppressIdleDuringFocusMode: false },
      },
    };
  },
  requiresOperationMigration: false,
};
