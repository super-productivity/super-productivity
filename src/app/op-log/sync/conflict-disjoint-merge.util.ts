/**
 * SPAP-14 — Pure disjoint-field auto-merge logic.
 *
 * When two clients concurrently edit the SAME entity but DIFFERENT (non-noise)
 * fields, whole-entity LWW would discard one side's real edit. SPAP-14 instead
 * KEEPS BOTH by synthesizing a single merged UPDATE whose delta is the union of
 * both sides' changed fields.
 *
 * Field patches (conflict-field-patch.util.ts) generalize this to fields both
 * sides wrote; this file keeps the shared field extraction and the disjoint
 * predicate that the commuting-crossing checks use.
 *
 * No Angular, no I/O — deterministic, so the merge decision and the extracted
 * fields are unit-testable in isolation. Determinism is the whole point: both
 * clients must extract the identical field set regardless of which one
 * resolves (key insertion order may differ between the author and wire shapes
 * of a restored clear — immaterial, since `updateOne` is order-independent).
 */

import { ActionType, isLwwUpdatePayload, OpType } from '../core/operation.types';
import type { Operation } from '../core/operation.types';
import {
  extractActionPayload,
  extractEntityFromPayload,
  extractUpdateChanges,
  isMultiEntityPayload,
} from '@sp/sync-core';
import { getOpEntityIds, isMultiEntityOperation } from '../util/get-op-entity-ids.util';
import { applyClearedFields } from '../../util/cleared-update-fields';

/** Metadata timestamps excluded from real-field overlap checks. */
export const NOISE_FIELDS: ReadonlySet<string> = new Set<string>([
  'modified',
  'lastModified',
  'created',
]);

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

/**
 * True when every field the side changed is a NOISE field (and the side is
 * decomposable at all — opaque ops carry real, non-extractable mutations).
 */
export const isNoiseOnlySide = (
  ops: Operation[],
  payloadKey: string,
  entityId: string,
): boolean => {
  if (ops.some((op) => op.opType === OpType.Delete)) {
    return false;
  }
  if (hasOpaqueChanges(ops, payloadKey, entityId)) {
    return false;
  }
  const changedFields = Object.keys(mergeChangedFields(ops, payloadKey, entityId));
  return (
    changedFields.length > 0 && changedFields.every((field) => NOISE_FIELDS.has(field))
  );
};

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
export const SYNC_TIME_SPENT_FIELDS: readonly string[] = ['timeSpent', 'timeSpentOnDay'];

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
export const sideNonNoiseKeys = (
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
 * Task fields that ops of other entity types also write in their reducers
 * (tag and project deletion, planner moves), unseen by task-level checks.
 */
const CROSS_ENTITY_TASK_FIELDS: readonly string[] = [
  'tagIds',
  'projectId',
  'parentId',
  'dueDay',
  'dueWithTime',
];

/**
 * True when these ops may write a task field that ops of other entity types
 * also write, or when an op's fields cannot be told (opaque, e.g. a planner op
 * that declares the task). A `syncTimeSpent` delta only touches time fields.
 */
export const touchesCrossEntityTaskFields = (
  ops: Operation[],
  payloadKey: string,
  entityId: string,
): boolean => {
  const side = sideNonNoiseKeys(ops, payloadKey, entityId);
  return !side || CROSS_ENTITY_TASK_FIELDS.some((field) => side.absolute.has(field));
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
  isTimeDeltaBesideTimelessRow(params) ||
  isTimeDeltaBesideTimelessOps(params.localOps, params.remoteOps, params) ||
  isTimeDeltaBesideTimelessOps(params.remoteOps, params.localOps, params) ||
  ([...params.localOps, ...params.remoteOps].some(
    (op) => op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
  ) &&
    isDisjointMergeEligible(params));

/**
 * True when every local op is a `syncTimeSpent` delta and every remote op is
 * an LWW resolution row (patch or snapshot another device built) of this one
 * task that writes no time field (#10421, #10408). The delta then adds to
 * whatever the row leaves, so both apply as they are.
 *
 * Only which top-level keys a `'patch'` row writes or clears is read, never
 * its values; no op is built from the row and rows never merge (decision 5a
 * in docs/sync-and-op-log/lww-field-level-resolution.md). A patch that writes
 * or clears `timeSpent`/`timeSpentOnDay` keeps whole-entity LWW, and so does
 * every `'replace'` row: `setOne` rewrites all fields, time included, whatever
 * keys it carries.
 */
const isTimeDeltaBesideTimelessRow = ({
  localOps,
  remoteOps,
  entityId,
}: {
  localOps: Operation[];
  remoteOps: Operation[];
  entityId: string;
}): boolean =>
  localOps.length > 0 &&
  remoteOps.length > 0 &&
  localOps.every((op) => op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT) &&
  remoteOps.every((op) => {
    const payload = op.payload;
    if (
      op.entityType !== 'TASK' ||
      op.opType !== OpType.Update ||
      !isLwwUpdatePayload(payload) ||
      payload.lwwUpdateMode !== 'patch'
    ) {
      return false;
    }
    const ids = getOpEntityIds(op);
    const keys = [
      ...Object.keys(payload.actionPayload),
      ...(Array.isArray(payload.clearedFields) ? payload.clearedFields : []),
    ];
    return (
      ids.length === 1 &&
      ids[0] === entityId &&
      !SYNC_TIME_SPENT_FIELDS.some((field) => keys.includes(field))
    );
  });

/**
 * Opaque single-task actions admitted as writing no time field of the task
 * they declare (#10378). `planTasksForToday` writes `dueDay`, `remindAt`,
 * `dueWithTime`, the Today order and planner days; its spec runs the reducer
 * to prove it. Every other opaque op may write time (`roundTimeSpentForDay`
 * does) and keeps whole-entity LWW.
 */
export const TIMELESS_OPAQUE_TASK_ACTIONS: ReadonlySet<string> = new Set<string>([
  ActionType.TASK_SHARED_PLAN_FOR_TODAY,
]);

/**
 * True when `op` provably writes no time field of task `entityId`: a
 * non-DELETE op declaring only that task, neither an LWW row nor an additive
 * time op, that reads as fields none of which is a time field, or is an
 * opaque action admitted in `TIMELESS_OPAQUE_TASK_ACTIONS`.
 */
export const writesNoTaskTime = (
  op: Operation,
  payloadKey: string,
  entityId: string,
): boolean => {
  const ids = getOpEntityIds(op);
  if (
    op.entityType !== 'TASK' ||
    op.opType === OpType.Delete ||
    isLwwUpdatePayload(op.payload) ||
    isAdditiveTimeOp(op) ||
    ids.length !== 1 ||
    ids[0] !== entityId
  ) {
    return false;
  }
  if (isOpaqueChangeOp(op, payloadKey, entityId)) {
    return TIMELESS_OPAQUE_TASK_ACTIONS.has(op.actionType);
  }
  const changes = extractOpChanges(op, payloadKey, entityId);
  return !SYNC_TIME_SPENT_FIELDS.some((field) => field in changes);
};

/**
 * True when `deltaSide` is only `syncTimeSpent` deltas and every op of
 * `otherSide` is a delta too or writes no time field of the task
 * (`writesNoTaskTime`), including timeless patch rows checked by their keys.
 * The deltas add to whatever the other side leaves, so
 * both apply as they are. Unlike `isDisjointMergeEligible` this admits an
 * other side holding a timeless opaque op: tracking an unscheduled task emits
 * `planTasksForToday` beside its delta, which made two devices' concurrent
 * time on one task lose to whole-entity LWW (#10378).
 */
const isTimeDeltaBesideTimelessOps = (
  deltaSide: Operation[],
  otherSide: Operation[],
  { payloadKey, entityId }: { payloadKey: string; entityId: string },
): boolean =>
  deltaSide.length > 0 &&
  otherSide.length > 0 &&
  deltaSide.every(isSyncTimeSpentDelta) &&
  otherSide.every(
    (op) =>
      isSyncTimeSpentDelta(op) ||
      isTimeDeltaBesideTimelessRow({
        localOps: deltaSide,
        remoteOps: [op],
        entityId,
      }) ||
      writesNoTaskTime(op, payloadKey, entityId),
  );

const isSyncTimeSpentDelta = (op: Operation): boolean =>
  op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT;
