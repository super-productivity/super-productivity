import {
  deepEqual,
  extractUpdateChanges,
  OpType,
  type LwwResolvedConflict,
} from '@sp/sync-core';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import type { EntityConflict, Operation } from '../core/operation.types';
import { aggregateEntityConflict } from './conflict-field-patch.util';

type ResolvedConflict = LwwResolvedConflict<Operation, EntityConflict>;

/**
 * Task fields a user authors by hand. If an LWW resolution discards an UPDATE
 * that changed one of these, a real edit was silently dropped — worth
 * surfacing. Everything else a discarded op can touch (scheduling/due dates,
 * repeat config, archive/done state, ordering, time tracking, internal flags)
 * is routine self-healing that resolves correctly on its own.
 *
 * TASK-only by design (#8694): only tasks carry user-authored free text, and the
 * notice only names tasks. Widening to another entity type is NOT a one-liner —
 * it also needs the title lookup and the banner wording in
 * ConflictResolutionService to handle that type.
 *
 * Only fields that actually travel inside an `updateTask` change-set belong here.
 * Attachments are intentionally excluded: they are edited via dedicated
 * `[TaskAttachment] …` actions whose payload is `{ taskId, taskAttachment }`,
 * never `updateTask({ task: { changes: { attachments } } })`, so an entry here
 * would silently never match.
 */
const TASK_CONTENT_FIELDS: readonly string[] = ['title', 'notes', 'subTaskIds'];

const collectContentUpdates = (
  ops: Operation[],
  payloadKey: string,
): Map<string, unknown> => {
  const values = new Map<string, unknown>();
  for (const op of ops) {
    if (op.opType !== OpType.Update) continue;
    for (const [field, value] of Object.entries(
      extractUpdateChanges(op.payload, payloadKey),
    )) {
      if (TASK_CONTENT_FIELDS.includes(field)) values.set(field, value);
    }
  }
  return values;
};

export interface LwwContentConflict {
  entityId: string;
  /** The content fields the discarded edit(s) changed. */
  discardedFields: string[];
  /**
   * The title value the discarded edit set, when the discarded edit changed the
   * title. For a title conflict the current (kept) title is the *winning* value,
   * so naming the task by it alone gives the user nothing to double-check — this
   * is the value that was dropped, so the banner can show "kept X, discarded Y".
   * Absent when no discarded edit touched the title (or it only cleared it to
   * empty). The LAST non-empty discarded title in the batch wins — the user's
   * final rename (deterministic given op order). Never logged (#9).
   */
  discardedTitle?: string;
}

/**
 * From already-decided LWW resolutions, find the ones that discarded a genuine
 * task content edit.
 *
 * Pure and read-only — it never influences which ops were applied or rejected.
 *
 * The losing side (the rejected ops) is inspected via `extractUpdateChanges`,
 * which unwraps the standard `{ actionPayload: { task: { id, changes } } }` op
 * payload every captured op carries. Only UPDATE ops count — a discarded
 * create/delete/move is not a field-level edit loss. Results are de-duplicated
 * per task, since one task can produce several concurrent conflicts in a batch.
 */
export const findLwwContentConflicts = (
  resolutions: ResolvedConflict[],
  payloadKeyFor: (entityType: string) => string,
): LwwContentConflict[] => {
  // Detection emits one conflict per incoming op. A CREATE sibling can share
  // the same losing update as the retained UPDATE that carried its value.
  const groups = new Map<
    string,
    { winner: ResolvedConflict['winner']; conflicts: EntityConflict[] }
  >();
  for (const { winner, conflict } of resolutions) {
    if (conflict.entityType !== 'TASK') continue;
    const key = `${winner}:${conflict.entityId}`;
    const group = groups.get(key) ?? { winner, conflicts: [] };
    group.conflicts.push(conflict);
    groups.set(key, group);
  }
  const grouped = [...groups.values()].map(({ winner, conflicts }) => ({
    winner,
    conflict: aggregateEntityConflict(conflicts),
  }));
  return findContentConflicts(grouped, payloadKeyFor, false);
};

/**
 * A field patch keeps fields only one side wrote, so only overlapping writes
 * can discard content.
 */
export const findPatchContentConflicts = (
  patches: ResolvedConflict[],
  payloadKeyFor: (entityType: string) => string,
): LwwContentConflict[] => findContentConflicts(patches, payloadKeyFor, true);

const findContentConflicts = (
  resolutions: ResolvedConflict[],
  payloadKeyFor: (entityType: string) => string,
  isPatch: boolean,
): LwwContentConflict[] => {
  const byTask = new Map<string, { fields: Set<string>; discardedTitle?: string }>();

  for (const { winner, conflict } of resolutions) {
    if (conflict.entityType !== 'TASK') {
      continue;
    }
    const discardedOps = winner === 'remote' ? conflict.localOps : conflict.remoteOps;
    const retainedOps = winner === 'remote' ? conflict.remoteOps : conflict.localOps;
    const payloadKey = payloadKeyFor(conflict.entityType);
    const discarded = collectContentUpdates(discardedOps, payloadKey);
    if (discarded.size === 0) continue;
    const retained = collectContentUpdates(retainedOps, payloadKey);
    // A delete or synthetic LWW row can replace the readable update's value.
    const retainedValueMayBeReplaced = retainedOps.some(
      (op) => op.opType === OpType.Delete || isLwwUpdateActionType(op.actionType),
    );

    for (const [field, value] of discarded) {
      const retainedWroteField = retained.has(field);
      if (isPatch && !retainedWroteField) continue;
      if (
        retainedWroteField &&
        !retainedValueMayBeReplaced &&
        deepEqual(value, retained.get(field))
      )
        continue;
      const acc = byTask.get(conflict.entityId) ?? { fields: new Set<string>() };
      acc.fields.add(field);
      if (field === 'title' && typeof value === 'string' && value.trim().length) {
        acc.discardedTitle = value;
      }
      byTask.set(conflict.entityId, acc);
    }
  }

  return [...byTask].map(([entityId, { fields, discardedTitle }]) => ({
    entityId,
    discardedFields: [...fields],
    // Omit the key entirely when no title was discarded so routine callers and
    // tests keep the minimal { entityId, discardedFields } shape.
    ...(discardedTitle !== undefined ? { discardedTitle } : {}),
  }));
};
