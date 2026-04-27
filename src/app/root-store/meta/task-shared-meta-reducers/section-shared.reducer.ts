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
import { ActionHandlerMap } from './task-shared-helpers';

interface ExtendedState extends RootState {
  [SECTION_FEATURE_NAME]?: SectionState;
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
  sectionState: SectionState | undefined,
  removedTaskIds: string[],
): SectionState | undefined => {
  if (!sectionState || removedTaskIds.length === 0) return sectionState;

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
  sectionState: SectionState | undefined,
  contextIds: string[],
  contextType: WorkContextType,
): SectionState | undefined => {
  if (!sectionState || contextIds.length === 0) return sectionState;

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
 * Remove `taskIds` from any section whose owning context appears in
 * `contextIds` and matches `contextType`. Used when a task leaves a
 * project (moveToOtherProject) or a tag (updateTask removing a tagId)
 * — the task's sectionId in the old context becomes stale.
 */
const cleanupTaskIdsInContexts = (
  sectionState: SectionState | undefined,
  taskIds: string[],
  contextIds: string[],
  contextType: WorkContextType,
): SectionState | undefined => {
  if (!sectionState || taskIds.length === 0 || contextIds.length === 0) {
    return sectionState;
  }

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

const handleTaskDeletion = (
  state: ExtendedState,
  primaryTaskIds: string[],
): ExtendedState => {
  const affectedIds = collectAffectedTaskIds(state, primaryTaskIds);
  const updatedSectionState = cleanupSectionTaskIds(
    state[SECTION_FEATURE_NAME],
    affectedIds,
  );
  if (updatedSectionState === state[SECTION_FEATURE_NAME]) {
    return state;
  }
  return {
    ...state,
    [SECTION_FEATURE_NAME]: updatedSectionState,
  } as ExtendedState;
};

const handleContextDeletion = (
  state: ExtendedState,
  contextIds: string[],
  contextType: WorkContextType,
): ExtendedState => {
  const updatedSectionState = removeSectionsByContext(
    state[SECTION_FEATURE_NAME],
    contextIds,
    contextType,
  );
  if (updatedSectionState === state[SECTION_FEATURE_NAME]) {
    return state;
  }
  return {
    ...state,
    [SECTION_FEATURE_NAME]: updatedSectionState,
  } as ExtendedState;
};

const collectTaskAndSubtaskIds = (state: ExtendedState, taskId: string): string[] => {
  const t = state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
  if (!t) return [taskId];
  if (!t.subTaskIds?.length) return [taskId];
  return [taskId, ...t.subTaskIds];
};

/**
 * Task is moving from its current project to `targetProjectId`. Strip the
 * task (and its subtasks) from any project-scoped section in the old
 * project; tag-scoped sections are unaffected because tag membership
 * doesn't change on a project move.
 */
const handleMoveToOtherProject = (
  state: ExtendedState,
  taskId: string,
  targetProjectId: string,
): ExtendedState => {
  const t = state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
  const oldProjectId = t?.projectId;
  if (!oldProjectId || oldProjectId === targetProjectId) return state;

  const affectedTaskIds = collectTaskAndSubtaskIds(state, taskId);
  const updatedSectionState = cleanupTaskIdsInContexts(
    state[SECTION_FEATURE_NAME],
    affectedTaskIds,
    [oldProjectId],
    WorkContextType.PROJECT,
  );
  if (updatedSectionState === state[SECTION_FEATURE_NAME]) return state;
  return {
    ...state,
    [SECTION_FEATURE_NAME]: updatedSectionState,
  } as ExtendedState;
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

  const updatedSectionState = cleanupTaskIdsInContexts(
    state[SECTION_FEATURE_NAME],
    [taskId],
    removedTagIds,
    WorkContextType.TAG,
  );
  if (updatedSectionState === state[SECTION_FEATURE_NAME]) return state;
  return {
    ...state,
    [SECTION_FEATURE_NAME]: updatedSectionState,
  } as ExtendedState;
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
});

export const sectionSharedMetaReducer: MetaReducer = (
  reducer: ActionReducer<any, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state, action);

    const extendedState = state as ExtendedState;
    const handlers = createActionHandlers(extendedState, action);
    const handler = handlers[action.type];
    const updatedState = handler ? handler(extendedState) : extendedState;

    return reducer(updatedState, action);
  };
};
