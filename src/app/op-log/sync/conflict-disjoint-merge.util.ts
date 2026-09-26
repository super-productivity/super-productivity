/**
 * SPAP-14 — Pure disjoint-field auto-merge logic.
 *
 * When two clients concurrently edit the SAME entity but DIFFERENT (non-noise)
 * fields, whole-entity LWW would discard one side's real edit. SPAP-14 instead
 * KEEPS BOTH by synthesizing a single merged UPDATE whose delta is the union of
 * both sides' changed fields.
 *
 * No Angular, no I/O — deterministic, so the merge decision and the synthesized
 * changes delta are unit-testable in isolation. Determinism is the whole point:
 * both clients must arrive at the identical field/value map regardless of
 * which one performs the merge (key insertion order may differ between the
 * author and wire shapes of a restored clear — immaterial, since the merged
 * ops carry separate ids and `updateOne` is order-independent). See
 * `synthesizeMergedChanges`.
 */

import { ActionType, OpType } from '../core/operation.types';
import type { Operation } from '../core/operation.types';
import {
  extractActionPayload,
  extractEntityFromPayload,
  extractUpdateChanges,
  isMultiEntityPayload,
} from '@sp/sync-core';
import { isMultiEntityOperation } from '../util/get-op-entity-ids.util';
import { applyClearedFields } from '../../util/cleared-update-fields';

/** Metadata timestamps excluded from real-field overlap checks. */
export const NOISE_FIELDS: ReadonlySet<string> = new Set<string>([
  'modified',
  'lastModified',
  'created',
]);

/** Identity of one side of the conflict for the deterministic noise tiebreak. */
export interface MergeSideMeta {
  /** Max timestamp across that side's ops. */
  timestamp: number;
  /** The client that authored that side. */
  clientId: string;
}

/**
 * The changed fields of ONE op, scoped to the entity currently in conflict.
 *
 * Single-entity ops use the adapter-shaped action payload
 * (`{ [payloadKey]: { id, changes } }` or a flat entity) first, then fall back
 * to capture-time `entityChanges` for reducers that don't follow that pattern
 * (e.g. TIME_TRACKING, syncTimeSpent). Multi-entity ops use only the matching
 * target-specific `entityChanges` entry; their generic action payload cannot be
 * safely attributed to one entity.
 *
 * Returns `{}` when neither source has anything — the op's mutation is encoded
 * in a domain-specific payload shape (e.g. `convertToSubTask`'s
 * `{ taskId, targetParentId, afterTaskId }`) that CANNOT be read as field
 * values. Such "opaque" ops still represent a real state change; callers must
 * treat empty-with-payload as unknown, not as "nothing changed" — see
 * `hasOpaqueChanges`.
 */
const asSafeUpdateChanges = (changes: unknown): Record<string, unknown> | undefined => {
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
    return undefined;
  }
  const record = changes as Record<string, unknown>;
  return 'id' in record ? undefined : record;
};

const extractOpChanges = (
  op: Operation,
  payloadKey: string,
  entityId: string,
): Record<string, unknown> => {
  const capturedChanges: Record<string, unknown> = {};
  if (isMultiEntityPayload(op.payload)) {
    let hasUnsafeTargetChange = false;
    for (const change of op.payload.entityChanges) {
      if (change.entityType !== op.entityType || change.entityId !== entityId) {
        continue;
      }

      const safeChanges =
        change.opType === OpType.Update ? asSafeUpdateChanges(change.changes) : undefined;
      if (!safeChanges) {
        hasUnsafeTargetChange = true;
        continue;
      }
      Object.assign(capturedChanges, safeChanges);
    }

    if (hasUnsafeTargetChange) {
      return {};
    }

    // A multi-entity op's adapter-shaped action payload is not inherently scoped
    // to the entity currently in conflict. Legacy state-diff capture, however,
    // recorded one EntityChange per affected entity. Prefer that target-specific
    // source exclusively; if it is absent, return {} so the op is treated as
    // opaque and falls back to whole-entity LWW instead of borrowing the primary
    // entity's fields.
    if (isMultiEntityOperation(op)) {
      return capturedChanges;
    }
  } else if (isMultiEntityOperation(op)) {
    // Old direct-format bulk payloads describe only their primary entity. They
    // cannot be projected onto an arbitrary sibling from entityIds.
    return {};
  }

  const entityPayload = extractEntityFromPayload(op.payload, payloadKey, entityId);
  const embeddedId = entityPayload?.['id'];
  // Adapter entities must positively identify the conflict target. Singleton
  // feature state is the sole exception: it uses the '*' sentinel and has no
  // embedded id by design.
  if (entityId !== '*' && embeddedId !== entityId) {
    return capturedChanges;
  }
  const adapterChanges = extractUpdateChanges(op.payload, payloadKey, entityId);
  const safeAdapterChanges = asSafeUpdateChanges(adapterChanges);
  if (safeAdapterChanges) {
    // Field CLEARS travel out-of-band (#9776): the author's op holds
    // `changes: { field: undefined }` (structured clone keeps it) while the
    // same op after a JSON wire round-trip holds `changes: {}` plus
    // `clearedFields: ['field']`. Restoring the cleared keys here makes both
    // clients extract the IDENTICAL field set — otherwise the author judges
    // the conflict merge-eligible while the receiver sees an opaque op and
    // falls back to whole-entity LWW, and the two resolve the same conflict
    // by different strategies (silent divergence).
    const restored = applyClearedFields(
      safeAdapterChanges,
      readClearedFields(op.payload),
    );
    if (Object.keys(restored).length > 0) {
      return restored;
    }
  }
  return capturedChanges;
};

/**
 * The out-of-band cleared-keys list of a captured single-update action
 * (`clearedFieldsProps`), living beside the adapter payload inside
 * `actionPayload`. Junk-tolerant: anything that is not a string array reads as
 * absent (`applyClearedFields` re-validates each key).
 */
const readClearedFields = (payload: unknown): string[] | undefined => {
  const raw = extractActionPayload(payload)?.['clearedFields'];
  return Array.isArray(raw) ? (raw as string[]) : undefined;
};

/**
 * Union of the changed-field maps across a set of ops on one side.
 *
 * DELETE ops carry no meaningful field changes and are skipped —
 * though disjoint-merge eligibility already excludes any side with a DELETE.
 */
export const mergeChangedFields = (
  ops: Operation[],
  payloadKey: string,
  entityId: string,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const op of ops) {
    if (op.opType === OpType.Delete) {
      continue;
    }
    Object.assign(merged, extractOpChanges(op, payloadKey, entityId));
  }
  return merged;
};

/** True when this non-DELETE op's field-level delta cannot be extracted. */
export const isOpaqueChangeOp = (
  op: Operation,
  payloadKey: string,
  entityId: string,
): boolean =>
  op.opType !== OpType.Delete &&
  Object.keys(extractOpChanges(op, payloadKey, entityId)).length === 0;

/**
 * True when the side contains at least one op whose mutation is real but not
 * expressible as field values (see `extractOpChanges`). A side with opaque
 * changes must never be classified as "changed nothing real"
 * nor auto-merged (the synthesized entity would silently drop the opaque
 * mutation and the two clients would diverge).
 */
export const hasOpaqueChanges = (
  ops: Operation[],
  payloadKey: string,
  entityId: string,
): boolean => ops.some((op) => isOpaqueChangeOp(op, payloadKey, entityId));

/** The non-NOISE keys of a changed-field map. */
const nonNoiseKeys = (changes: Record<string, unknown>): string[] =>
  Object.keys(changes).filter((field) => !NOISE_FIELDS.has(field));

/**
 * True for an op whose mutation is a persistent additive DELTA on the task's
 * time fields rather than a field assignment: `syncTimeSpent` adds to
 * `timeSpentOnDay[date]`, `removeTimeSpent` subtracts from it clamping at zero.
 * Such a delta does not commute with an absolute write of the same fields, and
 * it can never be expressed as a merged patch (#10146, #10147).
 * `removeTimeSpent` is listed explicitly: its extraction happens to yield `{}`
 * (opaque) today, and nothing else keeps it out of a synthesized merge.
 */
export const isAdditiveTimeOp = (op: Operation): boolean =>
  op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT ||
  op.actionType === ActionType.TASK_REMOVE_TIME_SPENT;

/** The task fields a `syncTimeSpent` delta mutates once applied. */
const SYNC_TIME_SPENT_FIELDS: readonly string[] = ['timeSpent', 'timeSpentOnDay'];

/**
 * The non-NOISE fields one side touches, for the disjointness test only, split
 * by how they are written: `absolute` fields are assigned a value, `additive`
 * fields only receive a `syncTimeSpent` delta. `undefined` when the side holds
 * an opaque op (its real mutation cannot be expressed as fields, so the side
 * must not be classified at all).
 *
 * A `syncTimeSpent` op is counted as touching `timeSpent`/`timeSpentOnDay`,
 * derived from its ACTION TYPE alone. Its wire `entityChanges` are either the
 * delta's arguments (`{ taskId, date, duration }`, direct writes) or empty
 * (deferred writes); neither names a task field, so read as-is they would make
 * the delta look disjoint from an absolute write of the very fields it mutates
 * (#10146) or opaque. The mapping lives here rather than in the captured
 * payload so the wire shape stays what released clients already read, and it is
 * deliberately NOT surfaced through `mergeChangedFields`: the delta's values
 * must never be applied as a field patch.
 */
const sideNonNoiseKeys = (
  ops: Operation[],
  payloadKey: string,
  entityId: string,
): { absolute: Set<string>; additive: Set<string> } | undefined => {
  const absolute = new Set<string>();
  const additive = new Set<string>();
  for (const op of ops) {
    if (op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT) {
      SYNC_TIME_SPENT_FIELDS.forEach((field) => additive.add(field));
      continue;
    }
    if (isOpaqueChangeOp(op, payloadKey, entityId)) {
      return undefined;
    }
    nonNoiseKeys(extractOpChanges(op, payloadKey, entityId)).forEach((field) =>
      absolute.add(field),
    );
  }
  return { absolute, additive };
};

/**
 * Deterministic tiebreak for a field both sides changed: the side with the
 * greater `(timestamp, clientId)`. Both clients compute the SAME global winner
 * because the comparison is over the two sides' identities, independent of which
 * side happens to be "local" on a given client.
 */
export const noiseTiebreakSide = (
  local: MergeSideMeta,
  remote: MergeSideMeta,
): 'local' | 'remote' => {
  if (local.timestamp !== remote.timestamp) {
    return local.timestamp > remote.timestamp ? 'local' : 'remote';
  }
  if (local.clientId !== remote.clientId) {
    return local.clientId > remote.clientId ? 'local' : 'remote';
  }
  // Same identity on both — value is identical either way; pick 'local'.
  return 'local';
};

/**
 * True iff this conflict is safe to resolve by a disjoint-field merge.
 *
 * Field-level conditions only (the caller separately excludes archive plans):
 *  - neither side contains a multi-entity op, because resolving one conflicted
 *    entity would reject the whole original op and drop its sibling updates.
 *    LOAD-BEARING beyond that rationale since #9426: for SCOPED_PLAN types the
 *    sibling loss is now handled, but `_preservePartiallyRejectedLocalBulkPlanOps`
 *    only sees conflicts routed to the plain-LWW `resolutions` list — a merged
 *    conflict bypasses it and would starve the scoped replacement. Do not relax
 *    this condition for those types without moving that grouping too;
 *  - neither side has a DELETE op;
 *  - BOTH sides changed at least one real (non-noise) field — if one side only
 *    bumped noise, nothing real is lost by LWW, so leave it to SPAP-13's `noise`
 *    classification;
 *  - the two sides' non-noise changed-field sets are DISJOINT, with a
 *    `syncTimeSpent` op counted as touching `timeSpent`/`timeSpentOnDay` (see
 *    `sideNonNoiseKeys`); fields only a delta touches on both sides do not
 *    collide, since two positive deltas commute (#10214). Callers that SYNTHESIZE a merged patch must still
 *    refuse additive time ops up front (`isAdditiveTimeOp`): this predicate only
 *    answers whether the two sides commute.
 */
export const isDisjointMergeEligible = (params: {
  localOps: Operation[];
  remoteOps: Operation[];
  payloadKey: string;
  entityId: string;
}): boolean => {
  const { localOps, remoteOps, payloadKey, entityId } = params;

  const hasMultiEntityOp = [...localOps, ...remoteOps].some((op) =>
    isMultiEntityOperation(op),
  );
  if (hasMultiEntityOp) return false;

  if (localOps.some((op) => op.opType === OpType.Delete)) return false;
  if (remoteOps.some((op) => op.opType === OpType.Delete)) return false;

  // A side with opaque ops has real changes the merge could not carry over —
  // synthesizing from the extracted fields alone would drop them (and the two
  // clients would synthesize DIFFERENT entities). Fall back to LWW instead.
  const local = sideNonNoiseKeys(localOps, payloadKey, entityId);
  const remote = sideNonNoiseKeys(remoteOps, payloadKey, entityId);
  if (local === undefined || remote === undefined) return false;
  const isEmpty = (side: typeof local): boolean =>
    side.absolute.size === 0 && side.additive.size === 0;
  if (isEmpty(local) || isEmpty(remote)) return false;

  // Positive deltas on both sides commute (#10214); an absolute write of a
  // field collides with any write of it on the other side.
  const absoluteCollides = (a: typeof local, b: typeof local): boolean =>
    [...a.absolute].some((field) => b.absolute.has(field) || b.additive.has(field));
  return !absoluteCollides(local, remote) && !absoluteCollides(remote, local);
};

/**
 * True when a crossing involving a `syncTimeSpent` delta commutes, i.e.
 * applying both sides as-is is lossless and convergent. A delta can never be
 * expressed as a merged patch (`isAdditiveTimeOp`), so for such a crossing
 * whole-entity LWW would drop one device's tracked time or edit (#10214).
 */
export const isCommutingTimeDeltaCrossing = (params: {
  localOps: Operation[];
  remoteOps: Operation[];
  payloadKey: string;
  entityId: string;
}): boolean =>
  [...params.localOps, ...params.remoteOps].some(
    (op) => op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
  ) && isDisjointMergeEligible(params);

/**
 * Synthesizes the merged CHANGES DELTA — the union of both sides' changed
 * fields, applied on top of each client's current entity by `updateOne` (a
 * shallow MERGE, not a replace). This is the SINGLE source of truth both clients
 * must converge on.
 *
 * IMPORTANT — why a delta and NOT a full-entity snapshot: the delta is derived
 * purely from the two conflicting sides' ops, so both clients compute the
 * byte-identical map regardless of the rest of their entity state. A full-entity
 * snapshot (`{...currentEntity}`) would drag along fields NEITHER side touched;
 * if such an untouched field momentarily differs between the two clients (an
 * ordinary staggered-sync race — e.g. one client already applied a third
 * device's edit the other has not), the two synthesized snapshots differ, tie
 * under LWW at the identical `max(timestamp)`, and diverge PERMANENTLY. Carrying
 * only the changed fields makes the merged ops identical and leaves every
 * untouched field to its own op/LWW.
 *
 * Convergence: for every non-noise field the value is the same (disjoint sets →
 * each field owned by exactly one side); for every noise field both pick the
 * same global `(timestamp, clientId)` tiebreak winner. Therefore the delta is
 * identical on both clients.
 */
export const synthesizeMergedChanges = (
  localChanges: Record<string, unknown>,
  remoteChanges: Record<string, unknown>,
  localMeta: MergeSideMeta,
  remoteMeta: MergeSideMeta,
): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};

  // Union of both sides' real (non-noise) fields. The two sets are guaranteed
  // disjoint (isDisjointMergeEligible), so neither overwrites the other.
  for (const [key, value] of Object.entries(localChanges)) {
    if (!NOISE_FIELDS.has(key)) {
      changes[key] = value;
    }
  }
  for (const [key, value] of Object.entries(remoteChanges)) {
    if (!NOISE_FIELDS.has(key)) {
      changes[key] = value;
    }
  }

  // Resolve every noise field either side changed, deterministically, so both
  // clients write the identical value (not each their own).
  const winner = noiseTiebreakSide(localMeta, remoteMeta);
  const noiseFields = new Set<string>(
    [...Object.keys(localChanges), ...Object.keys(remoteChanges)].filter((field) =>
      NOISE_FIELDS.has(field),
    ),
  );
  for (const field of noiseFields) {
    const localHas = field in localChanges;
    const remoteHas = field in remoteChanges;
    if (localHas && remoteHas) {
      changes[field] = winner === 'local' ? localChanges[field] : remoteChanges[field];
    } else if (localHas) {
      changes[field] = localChanges[field];
    } else {
      changes[field] = remoteChanges[field];
    }
  }

  return changes;
};
