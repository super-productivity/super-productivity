import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import {
  adapter as sectionAdapter,
  SECTION_FEATURE_NAME,
} from '../../../features/section/store/section.reducer';
import { Section, SectionState } from '../../../features/section/section.model';
import { TaskSharedActions } from '../task-shared.actions';
import { deleteTag, deleteTags } from '../../../features/tag/store/tag.actions';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Task } from '../../../features/tasks/task.model';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';

/**
 * IMPORTANT — Phase 3.5 placement is load-bearing.
 *
 * This meta-reducer reads `state.task.entities[id]` (for projectId,
 * tagIds, subTaskIds) BEFORE `taskSharedCrudMetaReducer` strips deleted
 * tasks or applies updates. If anyone moves it below Phase 4, the
 * `handleMoveToOtherProject` and `handleTaskTagsChange` handlers will
 * silently no-op because state already reflects the new values.
 *
 * The registry's validateMetaReducerOrdering() pins the position.
 */
interface ExtendedState extends RootState {
  [SECTION_FEATURE_NAME]: SectionState;
}

type Handler = (state: ExtendedState, action: Action) => ExtendedState;

const collectAffectedTaskIds = (
  state: ExtendedState,
  primaryTaskIds: string[],
): string[] => {
  const taskState = state[TASK_FEATURE_NAME];
  const all = new Set<string>(primaryTaskIds);
  for (const id of primaryTaskIds) {
    const t = taskState.entities[id];
    if (t?.subTaskIds?.length) {
      for (const sub of t.subTaskIds) all.add(sub);
    }
  }
  return Array.from(all);
};

/**
 * Walk `taskIds` once removing entries in `removedSet`. Returns `null`
 * when nothing was removed so callers can keep the original array
 * reference, avoiding the `.some` + `.filter` double-walk.
 */
const filterRemovingTaskIds = (
  taskIds: string[],
  removedSet: Set<string>,
): string[] | null => {
  let next: string[] | null = null;
  for (let i = 0; i < taskIds.length; i++) {
    const id = taskIds[i];
    if (removedSet.has(id)) {
      if (next === null) next = taskIds.slice(0, i);
    } else if (next !== null) {
      next.push(id);
    }
  }
  return next;
};

const cleanupSectionTaskIds = (
  sectionState: SectionState,
  removedTaskIds: string[],
): SectionState => {
  if (removedTaskIds.length === 0) return sectionState;

  const removedSet = new Set(removedTaskIds);
  const updates: Update<Section>[] = [];

  // Iterate `state.ids` directly — `Object.values(entities)` allocates
  // a fresh array on every dispatch, which adds up under op-log replay.
  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s) continue;
    const filtered = filterRemovingTaskIds(s.taskIds, removedSet);
    if (filtered !== null) {
      updates.push({ id: s.id, changes: { taskIds: filtered } });
    }
  }

  if (!updates.length) return sectionState;
  return sectionAdapter.updateMany(updates, sectionState);
};

const removeSectionsByContext = (
  sectionState: SectionState,
  contextIds: string[],
  contextType: WorkContextType,
): SectionState => {
  if (contextIds.length === 0) return sectionState;

  const contextIdSet = new Set(contextIds);
  const idsToRemove: string[] = [];
  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s) continue;
    if (s.contextType === contextType && contextIdSet.has(s.contextId)) {
      idsToRemove.push(s.id);
    }
  }

  if (!idsToRemove.length) return sectionState;
  return sectionAdapter.removeMany(idsToRemove, sectionState);
};

/**
 * Strip `taskIds` from any section whose owning context appears in
 * `contextIds` and matches `contextType`. Used when a task leaves a
 * project (moveToOtherProject) or a tag (updateTask removing a tagId)
 * — the task's section membership in the old context becomes stale.
 */
const removeTaskIdsFromContextSections = (
  sectionState: SectionState,
  taskIds: string[],
  contextIds: string[],
  contextType: WorkContextType,
): SectionState => {
  if (taskIds.length === 0 || contextIds.length === 0) return sectionState;

  const taskIdSet = new Set(taskIds);
  const contextIdSet = new Set(contextIds);
  const updates: Update<Section>[] = [];

  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s) continue;
    if (s.contextType !== contextType) continue;
    if (!contextIdSet.has(s.contextId)) continue;
    const filtered = filterRemovingTaskIds(s.taskIds, taskIdSet);
    if (filtered !== null) {
      updates.push({ id: s.id, changes: { taskIds: filtered } });
    }
  }

  if (!updates.length) return sectionState;
  return sectionAdapter.updateMany(updates, sectionState);
};

const withSectionStateUpdate = (
  state: ExtendedState,
  next: SectionState,
): ExtendedState =>
  next === state[SECTION_FEATURE_NAME]
    ? state
    : ({ ...state, [SECTION_FEATURE_NAME]: next } as ExtendedState);

const handleTaskRemoval = (
  state: ExtendedState,
  primaryTaskIds: string[],
): ExtendedState => {
  const affectedIds = collectAffectedTaskIds(state, primaryTaskIds);
  return withSectionStateUpdate(
    state,
    cleanupSectionTaskIds(state[SECTION_FEATURE_NAME], affectedIds),
  );
};

const handleContextDeletion = (
  state: ExtendedState,
  contextIds: string[],
  contextType: WorkContextType,
): ExtendedState =>
  withSectionStateUpdate(
    state,
    removeSectionsByContext(state[SECTION_FEATURE_NAME], contextIds, contextType),
  );

/**
 * Task is moving from its current project to `targetProjectId`. Strip
 * the task (and its subtasks) from any project-scoped section in the
 * old project; tag-scoped sections are unaffected because tag
 * membership doesn't change on a project move.
 */
const handleMoveToOtherProject = (
  state: ExtendedState,
  taskId: string,
  targetProjectId: string,
): ExtendedState => {
  const t = state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
  const oldProjectId = t?.projectId;
  if (!oldProjectId || oldProjectId === targetProjectId) return state;

  const affectedTaskIds = collectAffectedTaskIds(state, [taskId]);
  return withSectionStateUpdate(
    state,
    removeTaskIdsFromContextSections(
      state[SECTION_FEATURE_NAME],
      affectedTaskIds,
      [oldProjectId],
      WorkContextType.PROJECT,
    ),
  );
};

/**
 * Action-specific handler for the explicit bulk "remove from TODAY"
 * actions. Pre-empts the post-reducer diff so callers that pass an
 * action payload (rather than relying on inner-reducer state mutation)
 * still get cleanup. The diff below catches the same flow when state
 * actually changes, so the two are idempotent: applying the same
 * removal twice is a no-op.
 */
const handleRemoveFromTodayTag = (
  state: ExtendedState,
  taskIds: string[],
): ExtendedState => {
  const affectedTaskIds = collectAffectedTaskIds(state, taskIds);
  return withSectionStateUpdate(
    state,
    removeTaskIdsFromContextSections(
      state[SECTION_FEATURE_NAME],
      affectedTaskIds,
      [TODAY_TAG.id],
      WorkContextType.TAG,
    ),
  );
};

/**
 * Diff-based TODAY_TAG.taskIds cleanup. TODAY is virtual — `task.tagIds`
 * never contains `'TODAY'`, so `handleTaskTagsChange` cannot catch it,
 * and the set of reducers that mutate `TODAY_TAG.taskIds` is too broad
 * to enumerate by action type (scheduleTaskWithTime, planTaskForDay,
 * unscheduleTask, short-syntax day moves, undo paths, lww conflict
 * resolution, …).
 *
 * Compares pre/post `TODAY_TAG.taskIds` after the inner reducer ran;
 * any id that left TODAY is stripped from TODAY-context sections.
 *
 * Cheap path: short-circuits on tag-state reference equality (no tag
 * mutation → no diff), then on TODAY entity reference equality, then on
 * taskIds reference equality. Only when all three changed do we walk
 * the arrays.
 */
const diffRemovedTodayTaskIds = (prev: RootState, next: RootState): string[] | null => {
  // Caller (sectionSharedMetaReducer) guards against undefined slices,
  // so prev/next here always have a hydrated tag slice.
  const prevTagState = prev[TAG_FEATURE_NAME];
  const nextTagState = next[TAG_FEATURE_NAME];
  if (prevTagState === nextTagState) return null;
  const prevToday = prevTagState.entities[TODAY_TAG.id];
  const nextToday = nextTagState.entities[TODAY_TAG.id];
  if (prevToday === nextToday) return null;
  const prevIds = prevToday?.taskIds;
  const nextIds = nextToday?.taskIds;
  if (prevIds === nextIds || !prevIds?.length) return null;
  const nextSet = nextIds ? new Set(nextIds) : new Set<string>();
  const removed: string[] = [];
  for (const id of prevIds) {
    if (!nextSet.has(id)) removed.push(id);
  }
  return removed.length ? removed : null;
};

const applyTodayTagSectionCleanup = (
  state: RootState,
  removedTaskIds: string[],
): RootState => {
  const extState = state as ExtendedState;
  const sectionState = extState[SECTION_FEATURE_NAME];
  const cleaned = removeTaskIdsFromContextSections(
    sectionState,
    removedTaskIds,
    [TODAY_TAG.id],
    WorkContextType.TAG,
  );
  if (cleaned === sectionState) return state;
  return { ...extState, [SECTION_FEATURE_NAME]: cleaned } as RootState;
};

/**
 * Task's tagIds were updated. For each tag the task no longer carries,
 * strip the task id from any section owned by that tag.
 */
const handleTaskTagsChange = (
  state: ExtendedState,
  taskId: string,
  newTagIds: string[],
): ExtendedState => {
  const t = state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
  if (!t) return state;
  const oldTagIds = t.tagIds ?? [];
  const newSet = new Set(newTagIds);
  const removedTagIds = oldTagIds.filter((id) => !newSet.has(id));
  if (!removedTagIds.length) return state;

  return withSectionStateUpdate(
    state,
    removeTaskIdsFromContextSections(
      state[SECTION_FEATURE_NAME],
      [taskId],
      removedTagIds,
      WorkContextType.TAG,
    ),
  );
};

/**
 * Bulk variant: aggregate (taskId → removedTagIds) pairs across the
 * batch first, then sweep sections once instead of N times. Builds a
 * `tagId → tasks-that-left-this-tag` map and applies all updates in a
 * single `adapter.updateMany`.
 */
const handleBulkTaskTagsChange = (
  state: ExtendedState,
  updates: ReadonlyArray<{ taskId: string; newTagIds: string[] }>,
): ExtendedState => {
  const taskState = state[TASK_FEATURE_NAME];
  const removedByTag = new Map<string, Set<string>>();

  for (const { taskId, newTagIds } of updates) {
    const t = taskState.entities[taskId] as Task | undefined;
    if (!t) continue;
    const oldTagIds = t.tagIds ?? [];
    if (!oldTagIds.length) continue;
    const newSet = new Set(newTagIds);
    for (const tagId of oldTagIds) {
      if (newSet.has(tagId)) continue;
      const bucket = removedByTag.get(tagId);
      if (bucket) {
        bucket.add(taskId);
      } else {
        removedByTag.set(tagId, new Set([taskId]));
      }
    }
  }

  if (removedByTag.size === 0) return state;

  const sectionState = state[SECTION_FEATURE_NAME];
  const sectionUpdates: Update<Section>[] = [];

  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s || s.contextType !== WorkContextType.TAG) continue;
    const removedTaskSet = removedByTag.get(s.contextId);
    if (!removedTaskSet) continue;
    const filtered = filterRemovingTaskIds(s.taskIds, removedTaskSet);
    if (filtered !== null) {
      sectionUpdates.push({ id: s.id, changes: { taskIds: filtered } });
    }
  }

  if (!sectionUpdates.length) return state;
  return withSectionStateUpdate(
    state,
    sectionAdapter.updateMany(sectionUpdates, sectionState),
  );
};

/**
 * Single source of truth for which actions trigger section cleanup.
 * The meta-reducer looks up the handler directly — adding an entry here
 * is the only step needed to react to a new action type. Keeping action
 * types and handlers in one map prevents the drift bug where a type was
 * registered but its handler wasn't (or vice versa).
 *
 * KNOWN FOLLOW-UPs:
 *
 * - `batchUpdateForProject` (plugin API) can update tagIds and delete
 *   tasks within its single-action transform, so sections owned by
 *   tags the plugin removed don't get pruned. Handling it here
 *   requires walking the operations array, which is non-trivial.
 *
 * - LWW conflict-resolution (`lwwUpdateMetaReducer`) syncs
 *   project.taskIds / tag.taskIds / parent.subTaskIds when an LWW
 *   update changes a task's projectId / tagIds / parentId, but does
 *   NOT touch project- or non-TODAY-tag-context section.taskIds. The
 *   diff below catches TODAY-context drift; other contexts can leak
 *   phantom task references until the next `dataRepair` pass clears
 *   them. Visible impact is bounded: `undoneTasksBySection`
 *   intersects against current task lists, so phantoms don't render —
 *   they only bloat the op-log.
 */
const ACTION_HANDLERS: Record<string, Handler> = {
  [TaskSharedActions.deleteTask.type]: (state, action) => {
    const { task } = action as ReturnType<typeof TaskSharedActions.deleteTask>;
    return handleTaskRemoval(state, [task.id]);
  },
  [TaskSharedActions.deleteTasks.type]: (state, action) => {
    const { taskIds } = action as ReturnType<typeof TaskSharedActions.deleteTasks>;
    return handleTaskRemoval(state, taskIds);
  },
  [TaskSharedActions.moveToArchive.type]: (state, action) => {
    // Archived tasks are pulled out of the live task store, so any
    // section that referenced them would otherwise hold a stale id
    // until a dataRepair pass cleared it. Restore is intentionally NOT
    // a counterpart action: the task comes back without a section, the
    // user re-categorizes manually (mirrors how restore drops tagIds
    // for tags that no longer exist).
    //
    // Union payload-subTasks with state-subTasks so cleanup is robust
    // under both threat models: (a) replay where the parent entity is
    // already gone from state (payload carries the tree), and (b)
    // callers who dispatch with an empty `subTasks` array (state
    // lookup is the only signal).
    const { tasks } = action as ReturnType<typeof TaskSharedActions.moveToArchive>;
    const idSet = new Set<string>();
    for (const t of tasks) {
      idSet.add(t.id);
      if (t.subTasks?.length) for (const st of t.subTasks) idSet.add(st.id);
    }
    const stateExpanded = collectAffectedTaskIds(
      state,
      tasks.map((t) => t.id),
    );
    for (const id of stateExpanded) idSet.add(id);
    return withSectionStateUpdate(
      state,
      cleanupSectionTaskIds(state[SECTION_FEATURE_NAME], Array.from(idSet)),
    );
  },
  [TaskSharedActions.deleteProject.type]: (state, action) => {
    const { projectId, allTaskIds } = action as ReturnType<
      typeof TaskSharedActions.deleteProject
    >;
    // Two-step in a single reducer pass:
    //   1. drop sections owned by the deleted project
    //   2. strip the deleted task ids from any remaining (tag-context)
    //      sections — task.reducer cascades removeMany(allTaskIds), so
    //      tag sections that held shared tasks would otherwise keep
    //      stale ids forever.
    const afterContextRemoval = handleContextDeletion(
      state,
      [projectId],
      WorkContextType.PROJECT,
    );
    if (!allTaskIds.length) return afterContextRemoval;
    return withSectionStateUpdate(
      afterContextRemoval,
      cleanupSectionTaskIds(afterContextRemoval[SECTION_FEATURE_NAME], allTaskIds),
    );
  },
  [deleteTag.type]: (state, action) => {
    const { id } = action as ReturnType<typeof deleteTag>;
    return handleContextDeletion(state, [id], WorkContextType.TAG);
  },
  [deleteTags.type]: (state, action) => {
    const { ids } = action as ReturnType<typeof deleteTags>;
    return handleContextDeletion(state, ids, WorkContextType.TAG);
  },
  [TaskSharedActions.moveToOtherProject.type]: (state, action) => {
    const { task, targetProjectId } = action as ReturnType<
      typeof TaskSharedActions.moveToOtherProject
    >;
    return handleMoveToOtherProject(state, task.id, targetProjectId);
  },
  [TaskSharedActions.updateTask.type]: (state, action) => {
    const { task } = action as ReturnType<typeof TaskSharedActions.updateTask>;
    const tagIds = task.changes.tagIds;
    if (!Array.isArray(tagIds)) return state;
    return handleTaskTagsChange(state, task.id as string, tagIds);
  },
  [TaskSharedActions.updateTasks.type]: (state, action) => {
    const { tasks } = action as ReturnType<typeof TaskSharedActions.updateTasks>;
    const tagChanges: { taskId: string; newTagIds: string[] }[] = [];
    for (const u of tasks) {
      const tagIds = u.changes.tagIds;
      if (Array.isArray(tagIds)) {
        tagChanges.push({ taskId: u.id as string, newTagIds: tagIds });
      }
    }
    if (!tagChanges.length) return state;
    return handleBulkTaskTagsChange(state, tagChanges);
  },
  [TaskSharedActions.removeTasksFromTodayTag.type]: (state, action) => {
    const { taskIds } = action as ReturnType<
      typeof TaskSharedActions.removeTasksFromTodayTag
    >;
    return handleRemoveFromTodayTag(state, taskIds);
  },
  [TaskSharedActions.localRemoveOverdueFromToday.type]: (state, action) => {
    const { taskIds } = action as ReturnType<
      typeof TaskSharedActions.localRemoveOverdueFromToday
    >;
    return handleRemoveFromTodayTag(state, taskIds);
  },
};

export const sectionSharedMetaReducer: MetaReducer<RootState> = (
  reducer: ActionReducer<RootState, Action>,
) => {
  return (state: RootState | undefined, action: Action): RootState => {
    if (!state) return reducer(state, action);
    // Boot/hydration guard: skip section-side cleanup until every slice
    // it touches is hydrated. The original crash report came through
    // the diff path, but every action handler here also dereferences
    // task / section / tag slices and would crash the same way on
    // partial state. Per-handler guards are redundant once this is in.
    const ext = state as ExtendedState;
    if (!ext[TASK_FEATURE_NAME] || !ext[TAG_FEATURE_NAME] || !ext[SECTION_FEATURE_NAME]) {
      return reducer(state, action);
    }
    const handler = ACTION_HANDLERS[action.type];
    const preState = handler ? handler(ext, action) : state;
    const next = reducer(preState, action);
    // Post-reducer TODAY_TAG.taskIds diff catches every flow that
    // removes ids from TODAY without going through a known action.
    // See diffRemovedTodayTaskIds for the residual-gap rationale.
    const removedFromToday = diffRemovedTodayTaskIds(state, next);
    if (!removedFromToday) return next;
    // Also expand subtasks: a parent task can leave TODAY while its
    // subtasks linger in section.taskIds if the section ever held them
    // (which it shouldn't, but defend against historical data).
    const affected = collectAffectedTaskIds(next as ExtendedState, removedFromToday);
    return applyTodayTagSectionCleanup(next, affected);
  };
};
