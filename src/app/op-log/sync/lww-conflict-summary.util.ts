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
  resolutions: LwwResolvedConflict<Operation, EntityConflict>[],
  payloadKeyFor: (entityType: string) => string,
): LwwContentConflict[] => {
  const byTask = new Map<string, { fields: Set<string>; discardedTitle?: string }>();

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
      const changes = extractUpdateChanges(op.payload, payloadKey);
      for (const field of Object.keys(changes)) {
        if (!TASK_CONTENT_FIELDS.includes(field)) {
          continue;
        }
        const acc = byTask.get(conflict.entityId) ?? { fields: new Set<string>() };
        acc.fields.add(field);
        // Keep the LAST non-empty discarded title so the banner names the user's
        // final rename, not a stale intermediate one (offline A→B→C, all
        // discarded → show C). Ops are processed in append order, so a later
        // non-empty value overwrites an earlier one. See
        // LwwContentConflict.discardedTitle.
        if (field === 'title') {
          const value = (changes as { title?: unknown }).title;
          if (typeof value === 'string' && value.trim().length) {
            acc.discardedTitle = value;
          }
        }
        byTask.set(conflict.entityId, acc);
      }
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
