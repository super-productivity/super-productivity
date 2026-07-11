import { EntityType } from './operation.types';
import { DEFAULT_TASK } from '../../features/tasks/task.model';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../../features/project/project.const';
import { DEFAULT_TAG } from '../../features/tag/tag.const';
import { EMPTY_SIMPLE_COUNTER } from '../../features/simple-counter/simple-counter.const';

/**
 * Per-entity-type fallback used when an LWW Update recreates an entity that
 * was deleted locally (issue #7330). When the LWW payload is partial — e.g.
 * from `_convertToLWWUpdatesIfNeeded`'s fallback path or a local DELETE op
 * that carried only `{id}` — the recreated entity would otherwise fail Typia
 * validation and dead-end the user on the "Repair attempted but failed"
 * dialog. The two fields play distinct roles:
 *
 * - `defaults` is the source of truth for the actual backfill. The
 *   meta-reducer recreate path spreads the WHOLE object
 *   (`{ ...defaults, ...nonNullPayloadFields }`), so every entity type listed
 *   here gets drift-resistant recreate backfill for free, regardless of
 *   `requiredKeys`.
 * - `requiredKeys` drives only (a) the meta-reducer's diagnostic warn (which
 *   missing schema-required fields to name in the log) and (b) the per-type
 *   on-disk heal branch in `auto-fix-typia-errors.ts`. Only TASK and
 *   SIMPLE_COUNTER have such a branch today; PROJECT/TAG rely on the generic
 *   recreate backfill alone, so their `requiredKeys` feed only the warn.
 *   List the schema-required fields that are NOT already coerced by an
 *   earlier generic branch in `autoFixTypiaErrors` (booleans → false,
 *   nullable → null) — mirroring TASK's curated list.
 *
 * IMPORTANT: adding a new type here gives you the generic recreate backfill,
 * but the on-disk DEFENSE-IN-DEPTH heal stays absent until you ALSO add a
 * matching branch in `auto-fix-typia-errors.ts` (or generalize that file).
 * Membership here ALSO opts the type into SPAP-14 disjoint-field auto-merge:
 * `ConflictResolutionService._tryCreateDisjointMergeOp` refuses fallback-less
 * types because its partial merged op must survive this recreate path. That is
 * safe by construction (recreate-safe ⇒ merge-recreate-safe), but know that an
 * entry here enables merging for the type too.
 *
 * TASK is the type the original report hit; PROJECT and TAG are defense in
 * depth because they share the same recreate code path. SIMPLE_COUNTER was
 * added after #7330 recurred on it: a concurrent delete-vs-update across
 * devices recreated a counter with `type === undefined`, which typia rejects
 * and dataRepair/auto-fix had no rule for, leaving the user stuck on the
 * "Repair attempted but failed" dialog. Defaults come from
 * EMPTY_SIMPLE_COUNTER. KNOWN LIMITATION: `type` is unrecoverable from a
 * `{id}`-only delete, so the counter comes back as ClickCounter and disabled
 * (`isEnabled: false`) on the deleting device only — the holder keeps its real
 * type via `updateOne` merge, so the fleet diverges on `type`. Acceptable vs.
 * the previous dead-end; a full fix needs a tombstone (snapshot) delete op.
 * NOTE, TASK_REPEAT_CFG, METRIC, ISSUE_PROVIDER still fall through to the
 * legacy behavior — add an entry here when there is evidence the
 * partial-payload path fires for them.
 *
 * The TASK entry layers `INBOX_PROJECT.id` on top of `DEFAULT_TASK` because
 * `DEFAULT_TASK` Omits `projectId` (it varies per task), but `TaskCopy`
 * declares it required. Call sites also guard INBOX existence at runtime
 * (it can be absent in a corrupted import) — see `lwwUpdateMetaReducer` and
 * `autoFixTypiaErrors`.
 */
export type RecreateFallback = {
  defaults: Record<string, unknown>;
  requiredKeys: readonly string[];
};

export const RECREATE_FALLBACK: Partial<Record<EntityType, RecreateFallback>> = {
  TASK: {
    defaults: { ...DEFAULT_TASK, projectId: INBOX_PROJECT.id },
    requiredKeys: [
      'title',
      'timeSpentOnDay',
      'tagIds',
      'subTaskIds',
      'attachments',
      'projectId',
    ],
  },
  PROJECT: { defaults: DEFAULT_PROJECT, requiredKeys: ['title', 'taskIds'] },
  TAG: { defaults: DEFAULT_TAG, requiredKeys: ['title', 'taskIds'] },
  SIMPLE_COUNTER: {
    defaults: EMPTY_SIMPLE_COUNTER,
    // Curated like TASK: omit `icon` (nullable, healed by the undefined→null
    // branch), `isEnabled`/`isOn` (booleans, healed by the falsey→false
    // branch). Listing them would also make the meta-reducer warn misreport a
    // legitimately-null `icon` as "missing". `defaults` still backfills them.
    requiredKeys: ['title', 'type', 'countOnDay'],
  },
};
