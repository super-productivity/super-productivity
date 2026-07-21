/**
 * SPAP-16 — Whole-dataset merge builder (pure, unit-testable).
 *
 * Given the diff (from `whole-dataset-diff.util`) plus the user's per-item picks,
 * builds the merged COMPLETE state that APPLY MERGE applies locally and then
 * force-uploads. The base is the LOCAL complete state (deep-cloned); only the
 * entities the picks touch are mutated:
 *
 *   - differing → LOCAL: keep local (no-op)   / REMOTE: replace with remote entity
 *   - onlyLocal → KEEP: keep (no-op)          / DISCARD: remove the entity
 *   - onlyRemote → ADD: insert remote entity  / SKIP: keep absent (no-op)
 *
 * Everything else (identical entities, non-reviewed singleton slices, archives)
 * is preserved verbatim from the local base, so the result is always a complete,
 * valid `AppDataComplete`.
 */

import {
  DifferingEntity,
  REVIEWABLE_MODELS,
  ReviewableEntityShape,
  WholeDatasetDiff,
} from './whole-dataset-diff.util';

const SHAPE_BY_MODEL_KEY: ReadonlyMap<string, ReviewableEntityShape> = new Map(
  REVIEWABLE_MODELS.map((m) => [m.modelKey, m.shape]),
);

/** Shape for a model key; adapter is the safe default for unknown keys. */
const shapeForModelKey = (modelKey: string): ReviewableEntityShape =>
  SHAPE_BY_MODEL_KEY.get(modelKey) ?? 'adapter';

export type DifferingPick = 'local' | 'remote';
export type OnlyLocalPick = 'keep' | 'discard';
export type OnlyRemotePick = 'add' | 'skip';

/** The user's decisions, keyed by `modelKey:entityId`. */
export interface MergePicks {
  differing: Record<string, DifferingPick>;
  onlyLocal: Record<string, OnlyLocalPick>;
  onlyRemote: Record<string, OnlyRemotePick>;
}

/** Stable composite key so picks survive across entity types. */
export const pickKey = (modelKey: string, entityId: string): string =>
  `${modelKey}:${entityId}`;

// ─────────────────────────────────────────────────────────────────────────────
// Preselection — newest-wins by entity `modified` timestamp.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Newest-wins default for one differing entity: REMOTE when the remote side was
 * modified strictly later, otherwise LOCAL (ties and missing-timestamp default
 * to keeping local).
 */
export const preselectDiffering = (e: DifferingEntity): DifferingPick =>
  e.remoteModified > e.localModified ? 'remote' : 'local';

/**
 * Builds the default picks for a whole diff:
 *   differing → newest-wins, onlyLocal → keep, onlyRemote → add.
 */
export const buildDefaultPicks = (diff: WholeDatasetDiff): MergePicks => {
  const differing: Record<string, DifferingPick> = {};
  for (const e of diff.differing) {
    differing[pickKey(e.modelKey, e.entityId)] = preselectDiffering(e);
  }
  const onlyLocal: Record<string, OnlyLocalPick> = {};
  for (const e of diff.onlyLocal) {
    onlyLocal[pickKey(e.modelKey, e.entityId)] = 'keep';
  }
  const onlyRemote: Record<string, OnlyRemotePick> = {};
  for (const e of diff.onlyRemote) {
    onlyRemote[pickKey(e.modelKey, e.entityId)] = 'add';
  }
  return { differing, onlyLocal, onlyRemote };
};

/** True when a pick differs from its newest-wins / keep / add default. */
export const isDifferingPickNonDefault = (
  e: DifferingEntity,
  pick: DifferingPick,
): boolean => pick !== preselectDiffering(e);

export const isOnlyLocalPickNonDefault = (pick: OnlyLocalPick): boolean =>
  pick !== 'keep';

export const isOnlyRemotePickNonDefault = (pick: OnlyRemotePick): boolean =>
  pick !== 'add';

// ─────────────────────────────────────────────────────────────────────────────
// Merge builder — mutate the local base per pick.
// ─────────────────────────────────────────────────────────────────────────────

type AnyState = Record<string, unknown>;
type EntityRecord = Record<string, unknown>;

const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const asRecord = (v: unknown): AnyState | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyState) : undefined;

/** Sets an entity into a model slice (creating the slice if needed). */
const setEntity = (
  state: AnyState,
  modelKey: string,
  shape: ReviewableEntityShape,
  entityId: string,
  entity: EntityRecord,
): void => {
  if (shape === 'adapter') {
    const slice = asRecord(state[modelKey]) ?? { ids: [], entities: {} };
    const ids = Array.isArray(slice['ids']) ? [...(slice['ids'] as string[])] : [];
    const entities = { ...(asRecord(slice['entities']) ?? {}) };
    if (!ids.includes(entityId)) {
      ids.push(entityId);
    }
    entities[entityId] = entity;
    state[modelKey] = { ...slice, ids, entities };
    return;
  }
  // array shape
  const arr = Array.isArray(state[modelKey])
    ? [...(state[modelKey] as EntityRecord[])]
    : [];
  const idx = arr.findIndex((item) => asRecord(item)?.['id'] === entityId);
  if (idx >= 0) {
    arr[idx] = entity;
  } else {
    arr.push(entity);
  }
  state[modelKey] = arr;
};

/** Removes an entity from a model slice (no-op when absent). */
const removeEntity = (
  state: AnyState,
  modelKey: string,
  shape: ReviewableEntityShape,
  entityId: string,
): void => {
  if (shape === 'adapter') {
    const slice = asRecord(state[modelKey]);
    if (!slice) {
      return;
    }
    const ids = Array.isArray(slice['ids'])
      ? (slice['ids'] as string[]).filter((id) => id !== entityId)
      : [];
    const entities = { ...(asRecord(slice['entities']) ?? {}) };
    delete entities[entityId];
    state[modelKey] = { ...slice, ids, entities };
    return;
  }
  if (Array.isArray(state[modelKey])) {
    state[modelKey] = (state[modelKey] as EntityRecord[]).filter(
      (item) => asRecord(item)?.['id'] !== entityId,
    );
  }
};

/**
 * Builds the merged complete state from the local base + diff + picks.
 * `localState` is treated as immutable — a deep clone is returned.
 */
export const buildMergedState = (
  localState: AnyState,
  diff: WholeDatasetDiff,
  picks: MergePicks,
): AnyState => {
  const merged = deepClone(localState);

  for (const e of diff.differing) {
    const pick = picks.differing[pickKey(e.modelKey, e.entityId)];
    if (pick === 'remote') {
      setEntity(
        merged,
        e.modelKey,
        shapeForModelKey(e.modelKey),
        e.entityId,
        deepClone(e.remote),
      );
    }
    // 'local' (default) → base already holds the local entity, no-op.
  }

  for (const e of diff.onlyLocal) {
    const pick = picks.onlyLocal[pickKey(e.modelKey, e.entityId)] ?? 'keep';
    if (pick === 'discard') {
      removeEntity(merged, e.modelKey, shapeForModelKey(e.modelKey), e.entityId);
    }
    // 'keep' (default) → no-op.
  }

  for (const e of diff.onlyRemote) {
    const pick = picks.onlyRemote[pickKey(e.modelKey, e.entityId)] ?? 'add';
    if (pick === 'add') {
      setEntity(
        merged,
        e.modelKey,
        shapeForModelKey(e.modelKey),
        e.entityId,
        deepClone(e.entity),
      );
    }
    // 'skip' → keep absent, no-op.
  }

  return merged;
};
