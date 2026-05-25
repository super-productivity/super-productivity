import { EntityType } from './operation.types';
import { DEFAULT_TASK } from '../../features/tasks/task.model';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../../features/project/project.const';
import { DEFAULT_TAG } from '../../features/tag/tag.const';

/**
 * Per-entity-type fallback used when an LWW Update recreates an entity that
 * was deleted locally (issue #7330). When the LWW payload is partial — e.g.
 * from `_convertToLWWUpdatesIfNeeded`'s fallback path or a local DELETE op
 * that carried only `{id}` — `defaults` fills in required fields so the
 * recreated entity passes Typia validation and the user does not dead-end on
 * the "Repair attempted but failed" dialog. `requiredKeys` drives both:
 * (a) the diagnostic warn in the meta-reducer (fires only for missing
 * schema-required fields) and (b) the auto-fix branch in
 * `auto-fix-typia-errors.ts` (covers exactly the same fields, sourcing
 * default values from `defaults` so the two layers cannot drift).
 *
 * Pairing both fields per type makes the lockstep invariant structural: a new
 * entity type added to the registry must declare both at once.
 *
 * TASK is the type the original report hit; PROJECT and TAG are defense in
 * depth because they share the same recreate code path. NOTE,
 * SIMPLE_COUNTER, TASK_REPEAT_CFG, METRIC, ISSUE_PROVIDER fall through to the
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
};
