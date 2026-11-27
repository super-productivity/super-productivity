/**
 * A local-win LWW row is built from this device's state BEFORE the download
 * that caused it. Nonconflicting remote ops of the same download that touch
 * the entity apply AFTER it here (they sort behind it), but its clock dominates
 * them, so every other device applies the row last and loses their fields
 * (e.g. a done toggle or project move that a waived time crossing let through
 * beside a delete). `foldFieldOps` carries plain title/notes edits into the
 * row; other fields were silently reverted everywhere but here.
 *
 * Compares the fields each row writes against this device's post-apply state
 * and returns, per stale row, the differing values for one follow-up `'patch'`
 * whose clock dominates the row and the touching ops, at the row's own winning
 * timestamp. Time fields stay out: deltas travel as their own ops.
 *
 * No Angular; state access and op creation are supplied by the caller.
 */

import { deepEqual, extractActionPayload } from '@sp/sync-core';
import { isLwwUpdatePayload } from '../core/operation.types';
import type { EntityType, Operation } from '../core/operation.types';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { NOISE_FIELDS, SYNC_TIME_SPENT_FIELDS } from './conflict-disjoint-merge.util';

export interface StaleRowPatch {
  row: Operation;
  touchingOps: Operation[];
  fields: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The fields a row writes on its receivers: a `'patch'` row's keys and
 * declared clears; every field of either side for a `'replace'` (`setOne`).
 */
const writtenFields = (
  row: Operation,
  values: Record<string, unknown>,
  state: Record<string, unknown>,
): string[] => {
  const payload = row.payload;
  if (isLwwUpdatePayload(payload) && payload.lwwUpdateMode === 'patch') {
    const cleared = Array.isArray(payload.clearedFields) ? payload.clearedFields : [];
    return [...Object.keys(values), ...cleared];
  }
  return [...Object.keys(values), ...Object.keys(state)];
};

/** The post-apply values of the fields `row` would revert, or undefined. */
const staleFields = (
  row: Operation,
  state: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const values = extractActionPayload(row.payload);
  const fields = [...new Set(writtenFields(row, values, state))].filter(
    (field) =>
      field !== 'id' &&
      !NOISE_FIELDS.has(field) &&
      !SYNC_TIME_SPENT_FIELDS.includes(field) &&
      !deepEqual(values[field], state[field]),
  );
  return fields.length > 0
    ? Object.fromEntries(fields.map((field) => [field, state[field]]))
    : undefined;
};

/**
 * One `StaleRowPatch` per local-win task LWW row that a same-batch applied
 * op declares and whose written fields differ from post-apply state. Rows
 * that are themselves in `appliedOps` (compensations, recreations) are
 * skipped: they entered state here, so a difference is reducer shaping, not a
 * lost remote edit.
 */
export const staleLocalWinRowPatches = async (
  rows: Operation[],
  appliedOps: Operation[],
  getState: (entityType: EntityType, entityId: string) => Promise<unknown>,
): Promise<StaleRowPatch[]> => {
  const patches: StaleRowPatch[] = [];
  const appliedIds = new Set(appliedOps.map((op) => op.id));
  for (const row of rows) {
    if (appliedIds.has(row.id)) continue;
    const entityId = row.entityId;
    // shortcut: tasks only (the observed loss) — other adapter types share the
    // shape, but singletons read the whole feature state and need their own diff
    if (row.entityType !== 'TASK' || !entityId || !isLwwUpdatePayload(row.payload)) {
      continue;
    }
    const touchingOps = appliedOps.filter(
      (op) => op.entityType === 'TASK' && getOpEntityIds(op).includes(entityId),
    );
    if (touchingOps.length === 0) continue;
    const state = await getState(row.entityType, entityId);
    const fields = isRecord(state) ? staleFields(row, state) : undefined;
    if (fields) patches.push({ row, touchingOps, fields });
  }
  return patches;
};
