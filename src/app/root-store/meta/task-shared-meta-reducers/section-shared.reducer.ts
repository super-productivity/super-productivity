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
import { ActionHandlerMap } from './task-shared-helpers';

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
    // Older persisted sections may lack taskIds entirely; treat as empty.
    const taskIds = s.taskIds ?? [];
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
    const ids = s.taskIds ?? [];
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

const handleTaskDeletion = (
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

const createActionHandlers = (
  state: ExtendedState,
  action: Action,
): ActionHandlerMap => ({
  [TaskSharedActions.deleteTask.type]: () => {
    const { task } = action as ReturnType<typeof TaskSharedActions.deleteTask>;
    return handleTaskDeletion(state, [task.id]) as RootState;
  },
  [TaskSharedActions.deleteTasks.type]: () => {
    const { taskIds } = action as ReturnType<typeof TaskSharedActions.deleteTasks>;
    return handleTaskDeletion(state, taskIds) as RootState;
  },
  [TaskSharedActions.deleteProject.type]: () => {
    const { projectId } = action as ReturnType<typeof TaskSharedActions.deleteProject>;
    return handleContextDeletion(
      state,
      [projectId],
      WorkContextType.PROJECT,
    ) as RootState;
  },
  [deleteTag.type]: () => {
    const { id } = action as ReturnType<typeof deleteTag>;
    return handleContextDeletion(state, [id], WorkContextType.TAG) as RootState;
  },
  [deleteTags.type]: () => {
    const { ids } = action as ReturnType<typeof deleteTags>;
    return handleContextDeletion(state, ids, WorkContextType.TAG) as RootState;
  },
  [TaskSharedActions.moveToOtherProject.type]: () => {
    const { task, targetProjectId } = action as ReturnType<
      typeof TaskSharedActions.moveToOtherProject
    >;
    return handleMoveToOtherProject(state, task.id, targetProjectId) as RootState;
  },
  [TaskSharedActions.updateTask.type]: () => {
    const { task } = action as ReturnType<typeof TaskSharedActions.updateTask>;
    const tagIds = task.changes.tagIds;
    if (!Array.isArray(tagIds)) return state as RootState;
    return handleTaskTagsChange(state, task.id as string, tagIds) as RootState;
  },
  [TaskSharedActions.updateTasks.type]: () => {
    const { tasks } = action as ReturnType<typeof TaskSharedActions.updateTasks>;
    let next: ExtendedState = state;
    for (const u of tasks) {
      const tagIds = u.changes.tagIds;
      if (!Array.isArray(tagIds)) continue;
      next = handleTaskTagsChange(next, u.id as string, tagIds);
    }
    return next as RootState;
  },
  [TaskSharedActions.removeTasksFromTodayTag.type]: () => {
    const { taskIds } = action as ReturnType<
      typeof TaskSharedActions.removeTasksFromTodayTag
    >;
    return handleRemoveFromTodayTag(state, taskIds) as RootState;
  },
  [TaskSharedActions.localRemoveOverdueFromToday.type]: () => {
    const { taskIds } = action as ReturnType<
      typeof TaskSharedActions.localRemoveOverdueFromToday
    >;
    return handleRemoveFromTodayTag(state, taskIds) as RootState;
  },
});

// Action types this meta-reducer reacts to. Looked up in O(1) so the
// 99% of dispatches that don't match short-circuit before allocating
// the handler dispatch table.
const HANDLED_ACTION_TYPES: ReadonlySet<string> = new Set([
  TaskSharedActions.deleteTask.type,
  TaskSharedActions.deleteTasks.type,
  TaskSharedActions.deleteProject.type,
  deleteTag.type,
  deleteTags.type,
  TaskSharedActions.moveToOtherProject.type,
  TaskSharedActions.updateTask.type,
  TaskSharedActions.updateTasks.type,
  TaskSharedActions.removeTasksFromTodayTag.type,
  TaskSharedActions.localRemoveOverdueFromToday.type,
]);

export const sectionSharedMetaReducer: MetaReducer<RootState> = (
  reducer: ActionReducer<RootState, Action>,
) => {
  return (state: RootState | undefined, action: Action): RootState => {
    if (!state) return reducer(state, action);
    if (!HANDLED_ACTION_TYPES.has(action.type)) return reducer(state, action);

    const extendedState = state as ExtendedState;
    const handlers = createActionHandlers(extendedState, action);
    const handler = handlers[action.type];
    const updatedState = handler ? handler(extendedState) : extendedState;

    return reducer(updatedState, action);
  };
};
