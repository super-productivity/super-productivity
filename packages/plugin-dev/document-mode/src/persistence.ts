/**
 * Document-mode keyed persistence (Stage A Phase 4).
 *
 * Before Stage A, every context's editor doc + the enabled-context set were
 * stuffed into one synced blob under the bare plugin id. Concurrent edits
 * across contexts on different devices LWW-collided at the blob level — one
 * side's whole-blob write wiped the other side's per-context changes.
 *
 * The keyed layout splits that into:
 *  - `meta`             — `{ enabledCtxIds: string[] }`, owned by background.ts
 *  - `doc:${ctxId}`     — the editor doc for one context, owned by editor.ts
 *  - `__meta__`         — internal migration stamp `{ migrated: 1 }`
 *
 * Each entry has its own LWW timestamp on the host, so a concurrent edit in
 * project A doesn't lose a concurrent edit in project B.
 *
 * The legacy single-blob entry is tombstoned (empty payload) after migration
 * so an offline device that still writes the old shape loses cleanly on
 * reconnect — see docs/plans/2026-05-23-stage-a-keyed-plugin-persistence.md
 * Phase 4 for the LWW rationale.
 */

import type { PluginAPI } from '@super-productivity/plugin-api';

const META_KEY = 'meta';
const MIGRATION_STAMP_KEY = '__meta__';
const DOC_KEY_PREFIX = 'doc:';

/** Key for a single context's editor doc. Pure so tests can verify. */
export const docKey = (ctxId: string): string => `${DOC_KEY_PREFIX}${ctxId}`;

interface MetaEntry {
  enabledCtxIds: string[];
}

interface MigrationStamp {
  migrated: 0 | 1;
}

interface LegacyBlob {
  docs?: Record<string, unknown>;
  enabledCtxIds?: string[];
  [extra: string]: unknown;
}

const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/**
 * Read the enabled-context set from the keyed meta entry. Returns an empty
 * array for a fresh install or a corrupt meta entry (the user can re-toggle).
 */
export const loadEnabledCtxIds = async (api: PluginAPI): Promise<string[]> => {
  const raw = await api.loadSyncedData(META_KEY);
  const parsed = safeParse<MetaEntry>(raw);
  return Array.isArray(parsed?.enabledCtxIds) ? parsed!.enabledCtxIds : [];
};

export const saveEnabledCtxIds = async (
  api: PluginAPI,
  enabledCtxIds: string[],
): Promise<void> => {
  await api.persistDataSynced(JSON.stringify({ enabledCtxIds }), META_KEY);
};

/**
 * Read one context's editor doc. Returns null when the entry is missing or
 * unparseable — caller falls back to a seed doc and (in editor.ts) gates
 * saves so the fallback can't overwrite a recoverable original.
 */
export const loadContextDoc = async (api: PluginAPI, ctxId: string): Promise<unknown> => {
  const raw = await api.loadSyncedData(docKey(ctxId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

export const saveContextDoc = async (
  api: PluginAPI,
  ctxId: string,
  doc: unknown,
): Promise<void> => {
  await api.persistDataSynced(JSON.stringify(doc), docKey(ctxId));
};

/**
 * One-shot migration from the legacy single-blob shape to keyed entries.
 *
 * Idempotent and crash-safe: a `__meta__` stamp guards re-runs after the
 * full sweep completes. If a previous run wrote `migrated: 0` but never
 * reached `migrated: 1` (process killed mid-way), the next call re-runs
 * the loop — each upsert is content-idempotent (same context → same doc),
 * so re-running costs op-log budget but doesn't corrupt state.
 *
 * Two devices migrating the same legacy data concurrently both write
 * identical keyed entries; LWW resolves deterministically per entity.
 */
export const migrateToKeyedPersistence = async (api: PluginAPI): Promise<void> => {
  const stampRaw = await api.loadSyncedData(MIGRATION_STAMP_KEY);
  const stamp = safeParse<MigrationStamp>(stampRaw);
  if (stamp?.migrated === 1) return;

  const legacyRaw = await api.loadSyncedData();
  if (!legacyRaw) {
    // No legacy data — either a fresh install or someone already tombstoned
    // the legacy entry. Either way, stamp success and exit.
    await api.persistDataSynced(JSON.stringify({ migrated: 1 }), MIGRATION_STAMP_KEY);
    return;
  }

  const parsed = safeParse<LegacyBlob>(legacyRaw);
  if (!parsed) {
    // Legacy blob is corrupt. Don't tombstone — that would destroy whatever
    // bytes are there, and we'd rather a future build with a fix have
    // something to recover from. Bail without stamping success so the
    // migration retries next session.
    return;
  }

  // Stamp the attempt FIRST so a crash before the split is detectable on
  // resume — `migrated: 0` means "we tried, retry the loop." Recovery is
  // simply re-running the loop; each upsert below is content-idempotent.
  await api.persistDataSynced(JSON.stringify({ migrated: 0 }), MIGRATION_STAMP_KEY);

  const docs = parsed.docs ?? {};
  // One oversized legacy doc must not block migration of every other context.
  // The host throws a synchronous Error from persistDataSynced when a payload
  // exceeds MAX_PLUGIN_DATA_SIZE; catch per-doc and skip — the original bytes
  // stay in the legacy blob (we suppress the tombstone below) so a future
  // build with a larger cap (or the user pruning the doc) can recover them.
  let anyDocSkipped = false;
  for (const [ctxId, doc] of Object.entries(docs)) {
    try {
      await api.persistDataSynced(JSON.stringify(doc), docKey(ctxId));
    } catch {
      anyDocSkipped = true;
    }
  }

  const enabledCtxIds = Array.isArray(parsed.enabledCtxIds) ? parsed.enabledCtxIds : [];
  await api.persistDataSynced(JSON.stringify({ enabledCtxIds }), META_KEY);

  if (!anyDocSkipped) {
    // Tombstone the legacy entry: an empty payload is a plugin-side
    // convention for "ignore". This gives LWW a winning side against any
    // offline device that still writes the old shape. Skipped when any
    // doc was too big to migrate — preserving the legacy bytes for recovery.
    await api.persistDataSynced('');
    await api.persistDataSynced(JSON.stringify({ migrated: 1 }), MIGRATION_STAMP_KEY);
  }
  // If anyDocSkipped: leave the stamp at {migrated: 0}. The next session
  // will retry, which is a no-op for already-written docs (content-idempotent)
  // and another skip for the oversized one. Stable failure mode without
  // data loss.
};
