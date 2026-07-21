/**
 * SPAP-16 — Whole-dataset conflict diff (pure, unit-testable).
 *
 * Compares the LOCAL complete state (an `AppDataComplete`-shaped object read via
 * the same snapshot path force-upload uses) against the DOWNLOADED REMOTE
 * snapshot state, per reviewable entity type, producing three buckets:
 *
 *   - `differing`  — entities present on BOTH sides that differ in at least one
 *                    non-`NOISE_FIELDS` field (each with per-field local/remote
 *                    values and both full entity snapshots).
 *   - `onlyLocal`  — entities present locally but absent remotely.
 *   - `onlyRemote` — entities present remotely but absent locally.
 *
 * Entities whose ONLY differences are NOISE_FIELDS (last-modified/metadata
 * timestamps) are excluded from `differing` — nothing real was edited.
 *
 * No Angular / NgRx / IndexedDB dependencies. The two states are plain objects,
 * so this is trivially testable and reused by the review dialog + merge builder.
 */

import { EntityType } from '../core/operation.types';
import { NOISE_FIELDS } from './conflict-journal.model';

/** How a model slice stores its entities inside the complete-state object. */
export type ReviewableEntityShape = 'adapter' | 'array';

/** One reviewable model slice: its complete-state key, entity type and shape. */
export interface ReviewableModel {
  /** Key inside the `AppDataComplete` object (MODEL_CONFIGS key). */
  modelKey: string;
  entityType: EntityType;
  shape: ReviewableEntityShape;
}

/**
 * The reviewable model slices. DELIBERATELY limited to entity types with a clear
 * per-item identity (an `id`) and a user-facing content model — the ones a
 * per-item merge review can sensibly present. Singleton slices (globalConfig,
 * timeTracking, menuTree, planner) and archives are intentionally excluded: they
 * have no per-row identity and are not represented in the review list. They are
 * carried through unchanged from the local base in the merge builder.
 */
export const REVIEWABLE_MODELS: readonly ReviewableModel[] = [
  { modelKey: 'task', entityType: 'TASK', shape: 'adapter' },
  { modelKey: 'project', entityType: 'PROJECT', shape: 'adapter' },
  { modelKey: 'tag', entityType: 'TAG', shape: 'adapter' },
  { modelKey: 'note', entityType: 'NOTE', shape: 'adapter' },
  { modelKey: 'simpleCounter', entityType: 'SIMPLE_COUNTER', shape: 'adapter' },
  { modelKey: 'taskRepeatCfg', entityType: 'TASK_REPEAT_CFG', shape: 'adapter' },
  { modelKey: 'metric', entityType: 'METRIC', shape: 'adapter' },
  { modelKey: 'issueProvider', entityType: 'ISSUE_PROVIDER', shape: 'adapter' },
  { modelKey: 'section', entityType: 'SECTION', shape: 'adapter' },
  { modelKey: 'reminders', entityType: 'REMINDER', shape: 'array' },
] as const;

/** Per-field local/remote values for one field that differs between the sides. */
export interface WholeDatasetFieldDiff {
  field: string;
  localVal: unknown;
  remoteVal: unknown;
}

/** An entity present on both sides that differs in ≥1 non-noise field. */
export interface DifferingEntity {
  modelKey: string;
  entityType: EntityType;
  entityId: string;
  title: string;
  /** entity `modified` timestamp (0 when absent) — used for newest-wins. */
  localModified: number;
  remoteModified: number;
  /** Only the non-noise differing fields. */
  fieldDiffs: WholeDatasetFieldDiff[];
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
}

/** An entity present on exactly one side. */
export interface OnlySideEntity {
  modelKey: string;
  entityType: EntityType;
  entityId: string;
  title: string;
  modified: number;
  entity: Record<string, unknown>;
}

export interface WholeDatasetDiff {
  differing: DifferingEntity[];
  onlyLocal: OnlySideEntity[];
  onlyRemote: OnlySideEntity[];
}

type AnyState = Record<string, unknown> | undefined | null;
type EntityRecord = Record<string, unknown>;

const asRecord = (v: unknown): EntityRecord | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as EntityRecord) : undefined;

/**
 * Extracts an id→entity map from a single model slice for the given shape.
 * Tolerant of a missing / malformed slice (returns an empty map).
 */
const extractEntities = (
  slice: unknown,
  shape: ReviewableEntityShape,
): Map<string, EntityRecord> => {
  const out = new Map<string, EntityRecord>();
  if (shape === 'adapter') {
    const rec = asRecord(slice);
    const entities = asRecord(rec?.['entities']);
    if (!entities) {
      return out;
    }
    for (const [id, ent] of Object.entries(entities)) {
      const e = asRecord(ent);
      if (e) {
        out.set(id, e);
      }
    }
    return out;
  }
  // array shape: slice is Array<{ id, ... }>
  if (Array.isArray(slice)) {
    for (const item of slice) {
      const e = asRecord(item);
      const id = e?.['id'];
      if (e && typeof id === 'string') {
        out.set(id, e);
      }
    }
  }
  return out;
};

const numField = (e: EntityRecord, field: string): number => {
  const v = e[field];
  return typeof v === 'number' ? v : 0;
};

const modifiedOf = (e: EntityRecord): number => numField(e, 'modified');

const titleOf = (e: EntityRecord, fallbackId: string): string => {
  const t = e['title'] ?? e['name'];
  return typeof t === 'string' && t.length > 0 ? t : fallbackId;
};

/** Structural value equality for plain JSON-ish field values. */
const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  // NaN-safe + deep structural via stable stringify. Field values here are
  // plain data (strings, numbers, arrays, nested plain objects).
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/**
 * Computes the non-noise field diffs between two entity snapshots. Returns the
 * list of differing fields (excluding NOISE_FIELDS). An empty result means the
 * two entities are equal apart from noise.
 */
const computeFieldDiffs = (
  local: EntityRecord,
  remote: EntityRecord,
): WholeDatasetFieldDiff[] => {
  const fields = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  const diffs: WholeDatasetFieldDiff[] = [];
  for (const field of fields) {
    if (NOISE_FIELDS.has(field)) {
      continue;
    }
    if (!valuesEqual(local[field], remote[field])) {
      diffs.push({ field, localVal: local[field], remoteVal: remote[field] });
    }
  }
  return diffs;
};

/**
 * Diffs the local complete state against the remote snapshot state across all
 * reviewable model slices. `models` is injectable for testing but defaults to
 * the production `REVIEWABLE_MODELS`.
 */
export const computeWholeDatasetDiff = (
  localState: AnyState,
  remoteState: AnyState,
  models: readonly ReviewableModel[] = REVIEWABLE_MODELS,
): WholeDatasetDiff => {
  const local = asRecord(localState) ?? {};
  const remote = asRecord(remoteState) ?? {};

  const differing: DifferingEntity[] = [];
  const onlyLocal: OnlySideEntity[] = [];
  const onlyRemote: OnlySideEntity[] = [];

  for (const model of models) {
    const localMap = extractEntities(local[model.modelKey], model.shape);
    const remoteMap = extractEntities(remote[model.modelKey], model.shape);

    for (const [id, localEnt] of localMap) {
      const remoteEnt = remoteMap.get(id);
      if (!remoteEnt) {
        onlyLocal.push({
          modelKey: model.modelKey,
          entityType: model.entityType,
          entityId: id,
          title: titleOf(localEnt, id),
          modified: modifiedOf(localEnt),
          entity: localEnt,
        });
        continue;
      }
      const fieldDiffs = computeFieldDiffs(localEnt, remoteEnt);
      if (fieldDiffs.length === 0) {
        // Identical, or differ only in NOISE_FIELDS → not a real conflict.
        continue;
      }
      differing.push({
        modelKey: model.modelKey,
        entityType: model.entityType,
        entityId: id,
        title: titleOf(localEnt, id) || titleOf(remoteEnt, id),
        localModified: modifiedOf(localEnt),
        remoteModified: modifiedOf(remoteEnt),
        fieldDiffs,
        local: localEnt,
        remote: remoteEnt,
      });
    }

    for (const [id, remoteEnt] of remoteMap) {
      if (localMap.has(id)) {
        continue;
      }
      onlyRemote.push({
        modelKey: model.modelKey,
        entityType: model.entityType,
        entityId: id,
        title: titleOf(remoteEnt, id),
        modified: modifiedOf(remoteEnt),
        entity: remoteEnt,
      });
    }
  }

  return { differing, onlyLocal, onlyRemote };
};

/** Header counts derived straight from the diff (NOT vector-clock sums). */
export interface WholeDatasetDiffCounts {
  differing: number;
  onlyLocal: number;
  onlyRemote: number;
  /** Total reviewable items across all three buckets. */
  total: number;
}

export const countWholeDatasetDiff = (
  diff: WholeDatasetDiff,
): WholeDatasetDiffCounts => ({
  differing: diff.differing.length,
  onlyLocal: diff.onlyLocal.length,
  onlyRemote: diff.onlyRemote.length,
  total: diff.differing.length + diff.onlyLocal.length + diff.onlyRemote.length,
});
