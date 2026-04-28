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

const cleanupSectionTaskIds = (
  sectionState: SectionState,
  removedTaskIds: string[],
): SectionState => {
  if (removedTaskIds.length === 0) return sectionState;

  const removedSet = new Set(removedTaskIds);
  const updates: Update<Section>[] = [];

  Object.values(sectionState.entities).forEach((s) => {
    if (!s) return;
    const taskIds = s.taskIds;
    if (taskIds.some((id) => removedSet.has(id))) {
      updates.push({
        id: s.id,
        changes: { taskIds: taskIds.filter((id) => !removedSet.has(id)) },
      });
    }
  });

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
  Object.values(sectionState.entities).forEach((s) => {
    if (!s) return;
    if (s.contextType === contextType && contextIdSet.has(s.contextId)) {
      idsToRemove.push(s.id);
    }
  });

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

  Object.values(sectionState.entities).forEach((s) => {
    if (!s) return;
    if (s.contextType !== contextType) return;
    if (!contextIdSet.has(s.contextId)) return;
    const ids = s.taskIds;
    if (!ids.some((id) => taskIdSet.has(id))) return;
    updates.push({
      id: s.id,
      changes: { taskIds: ids.filter((id) => !taskIdSet.has(id)) },
    });
  });

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
 * A bulk "remove from TODAY" action (removeTasksFromTodayTag /
 * localRemoveOverdueFromToday) fired. TODAY is virtual — `task.tagIds`
 * doesn't contain `'TODAY'`, so `handleTaskTagsChange` won't catch it.
 * Strip the affected tasks (and their subtasks) from any TODAY-context
 * section so they don't reappear there next time the task is planned for
 * today.
 *
 * RESIDUAL GAP — the following reducers also mutate `TODAY_TAG.taskIds`
 * directly without dispatching either bulk-remove action, so a task
 * that leaves TODAY via these paths can leave a stale id in a TODAY
 * section's `taskIds`:
 *  - task-shared-scheduling.reducer.ts: scheduleTaskWithTime,
 *    reScheduleTaskWithTime (when not isSkipAutoRemoveFromToday),
 *    unscheduleTask
 *  - planner-shared.reducer.ts: planTaskForDay (when moving away from
 *    today), removeTaskFromTodayTagAndPlanner, planner cleanup paths
 *  - short-syntax-shared.reducer.ts: short-syntax day moves
 *  - task-shared-crud.reducer.ts: undo paths that re-insert/remove
 *  - lww-update.meta-reducer.ts: conflict-resolution replacements
 * Accurate detection per-action requires duplicating each reducer's
 * dueDay/dueWithTime decision logic. The clean fix is a separate
 * Phase 6.5 meta-reducer that diffs `TODAY_TAG.taskIds` pre/post the
 * inner reducer call and strips removed ids from TODAY-context
 * sections — captured for follow-up.
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
 * Single source of truth for which actions trigger section cleanup.
 * The meta-reducer looks up the handler directly — adding an entry here
 * is the only step needed to react to a new action type. Keeping action
 * types and handlers in one map prevents the drift bug where a type was
 * registered but its handler wasn't (or vice versa).
 *
 * KNOWN FOLLOW-UP — `batchUpdateForProject` (plugin API) can update
 * tagIds and delete tasks within its single-action transform, so
 * sections owned by tags the plugin removed don't get pruned. Handling
 * it here requires walking the operations array, which is non-trivial.
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
    const { tasks } = action as ReturnType<typeof TaskSharedActions.moveToArchive>;
    return handleTaskRemoval(
      state,
      tasks.map((t) => t.id),
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
    let next: ExtendedState = state;
    for (const u of tasks) {
      const tagIds = u.changes.tagIds;
      if (!Array.isArray(tagIds)) continue;
      next = handleTaskTagsChange(next, u.id as string, tagIds);
    }
    return next;
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
    const handler = ACTION_HANDLERS[action.type];
    if (!handler) return reducer(state, action);
    return reducer(handler(state as ExtendedState, action), action);
  };
};
