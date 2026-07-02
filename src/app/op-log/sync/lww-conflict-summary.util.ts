import { extractUpdateChanges, OpType, type LwwResolvedConflict } from '@sp/sync-core';
import type { EntityConflict, Operation } from '../core/operation.types';

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

export interface LwwContentConflict {
  entityId: string;
  /** The content fields the discarded edit(s) changed. */
  discardedFields: string[];
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
  resolutions: LwwResolvedConflict<Operation, EntityConflict>[],
  payloadKeyFor: (entityType: string) => string,
): LwwContentConflict[] => {
  const fieldsByTask = new Map<string, Set<string>>();

  for (const { winner, conflict } of resolutions) {
    if (conflict.entityType !== 'TASK') {
      continue;
    }
    // The losing side is the one whose ops are rejected — its changes are the
    // ones that got discarded.
    const discardedOps = winner === 'remote' ? conflict.localOps : conflict.remoteOps;
    const payloadKey = payloadKeyFor(conflict.entityType);

    for (const op of discardedOps) {
      if (op.opType !== OpType.Update) {
        continue;
      }
      for (const field of Object.keys(extractUpdateChanges(op.payload, payloadKey))) {
        if (TASK_CONTENT_FIELDS.includes(field)) {
          const fields = fieldsByTask.get(conflict.entityId) ?? new Set<string>();
          fields.add(field);
          fieldsByTask.set(conflict.entityId, fields);
        }
      }
    }
  }

  return [...fieldsByTask].map(([entityId, fields]) => ({
    entityId,
    discardedFields: [...fields],
  }));
};
