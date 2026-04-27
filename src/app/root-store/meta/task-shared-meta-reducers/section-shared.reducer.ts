import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import {
  adapter as sectionAdapter,
  SECTION_FEATURE_NAME,
} from '../../../features/section/store/section.reducer';
import {
  Section,
  SectionContextType,
  SectionState,
} from '../../../features/section/section.model';
import { TaskSharedActions } from '../task-shared.actions';
import { deleteTag, deleteTags } from '../../../features/tag/store/tag.actions';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
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
  contextType: SectionContextType,
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
  contextType: SectionContextType,
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
    return handleContextDeletion(state, [projectId], 'PROJECT') as RootState;
  },
  [deleteTag.type]: () => {
    const { id } = action as ReturnType<typeof deleteTag>;
    return handleContextDeletion(state, [id], 'TAG') as RootState;
  },
  [deleteTags.type]: () => {
    const { ids } = action as ReturnType<typeof deleteTags>;
    return handleContextDeletion(state, ids, 'TAG') as RootState;
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
