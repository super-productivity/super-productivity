import { extractUpdateChanges, isMultiEntityPayload, OpType } from './operation.types';
import type { MultiEntityPayload, Operation } from './operation.types';
import type { EntityConflictLike, LwwResolvedConflict } from './conflict-resolution';

/**
 * User-authored content fields, keyed by entity type.
 *
 * When an LWW resolution *discards* an UPDATE that touched one of these fields,
 * a real user edit was silently dropped — worth surfacing so the user can
 * double-check. Everything else a discarded op might touch (scheduling/due
 * dates, repeat config, archive/done state, ordering, time-tracking, internal
 * flags) is treated as "routine" self-healing that resolves correctly on its
 * own and needs no attention.
 *
 * Only TASK is covered for now: issue #8694 is about task edits, and keeping the
 * set tight avoids false-positive "you may have lost data" nudges (the app
 * manifesto favours staying quiet unless something genuinely needs attention).
 */
export const LWW_CONTENT_FIELDS_BY_ENTITY_TYPE: Record<string, readonly string[]> = {
  TASK: ['title', 'notes', 'subTaskIds', 'attachments'],
};

export interface LwwContentConflict {
  entityType: string;
  entityId: string;
  /** Content field keys whose value the discarded op(s) tried to change. */
  discardedFields: string[];
}

export interface LwwResolutionSummary {
  /** Resolutions where no user-content field was discarded (self-healing). */
  routineCount: number;
  /** Resolutions where a real user edit to a content field was discarded. */
  contentConflicts: LwwContentConflict[];
}

/**
 * Returns the field keys that a single op changed for `entityId`.
 *
 * Only UPDATE changes count — a discarded CREATE/DELETE/MOVE is not a
 * field-level edit loss (those are handled elsewhere, e.g. the "changes
 * discarded — deleted on another device" path). Handles both multi-entity
 * payloads (fields live in `entityChanges`) and single-entity UPDATE payloads.
 */
const getUpdatedFieldsForEntity = <TOp extends Operation<string>>(
  op: TOp,
  entityType: string,
  entityId: string,
  payloadKey: string,
): string[] => {
  if (isMultiEntityPayload(op.payload)) {
    const fields: string[] = [];
    for (const change of (op.payload as MultiEntityPayload).entityChanges) {
      if (
        change.opType === OpType.Update &&
        change.entityType === entityType &&
        change.entityId === entityId &&
        change.changes &&
        typeof change.changes === 'object'
      ) {
        fields.push(...Object.keys(change.changes as Record<string, unknown>));
      }
    }
    return fields;
  }
  if (op.opType !== OpType.Update) {
    return [];
  }
  return Object.keys(extractUpdateChanges(op.payload, payloadKey));
};

/**
 * Splits already-decided LWW resolutions into "routine self-healing" vs
 * "a real user content edit was discarded", without touching the resolution
 * decision itself.
 *
 * Pure and side-effect free: the loser of each resolution (the side whose ops
 * were rejected) is inspected for content-field changes. This lets the host
 * surface a plain-language summary of genuine losses while staying quiet about
 * routine reschedule/repeat/archive/done churn.
 */
export const summarizeLwwResolutions = <
  TOperation extends Operation<string>,
  TConflict extends EntityConflictLike<TOperation>,
>(
  resolutions: ReadonlyArray<LwwResolvedConflict<TOperation, TConflict>>,
  opts: { payloadKeyFor: (entityType: string) => string },
): LwwResolutionSummary => {
  let routineCount = 0;
  const contentConflicts: LwwContentConflict[] = [];

  for (const { winner, conflict } of resolutions) {
    const contentFields = LWW_CONTENT_FIELDS_BY_ENTITY_TYPE[conflict.entityType];
    // The losing side is the one whose ops are rejected — its changes are the
    // ones that got discarded.
    const discardedOps = winner === 'remote' ? conflict.localOps : conflict.remoteOps;

    const discardedContentFields = new Set<string>();
    if (contentFields && contentFields.length) {
      const payloadKey = opts.payloadKeyFor(conflict.entityType);
      for (const op of discardedOps) {
        for (const field of getUpdatedFieldsForEntity(
          op,
          conflict.entityType,
          conflict.entityId,
          payloadKey,
        )) {
          if (contentFields.includes(field)) {
            discardedContentFields.add(field);
          }
        }
      }
    }

    if (discardedContentFields.size > 0) {
      contentConflicts.push({
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        discardedFields: [...discardedContentFields],
      });
    } else {
      routineCount++;
    }
  }

  return { routineCount, contentConflicts };
};
