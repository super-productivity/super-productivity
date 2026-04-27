import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import { deleteSection } from '../../../features/section/store/section.actions';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectAdapter,
} from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { ActionHandlerMap, removeTasksFromList, updateTags } from './task-shared-helpers';
import { OpLog } from '../../../core/log';

const collectAffectedTaskIds = (
  state: RootState,
  sectionId: string,
): { allIds: string[]; projectIds: string[] } => {
  const taskState = state[TASK_FEATURE_NAME];
  const projectIdSet = new Set<string>();
  const allIds: string[] = [];

  Object.values(taskState.entities).forEach((task) => {
    if (!task || task.sectionId !== sectionId) return;
    allIds.push(task.id);
    if (task.subTaskIds?.length) {
      allIds.push(...task.subTaskIds);
    }
    if (task.projectId) {
      projectIdSet.add(task.projectId);
    }
  });

  return { allIds, projectIds: Array.from(projectIdSet) };
};

const handleDeleteSection = (state: RootState, sectionId: string): RootState => {
  const { allIds, projectIds } = collectAffectedTaskIds(state, sectionId);

  if (allIds.length === 0) {
    return state;
  }

  // 1. Remove tasks (and their subtasks) from task state
  const newTaskState = taskAdapter.removeMany(allIds, state[TASK_FEATURE_NAME]);
  let updatedState: RootState = {
    ...state,
    [TASK_FEATURE_NAME]: {
      ...newTaskState,
      currentTaskId:
        newTaskState.currentTaskId && allIds.includes(newTaskState.currentTaskId)
          ? null
          : newTaskState.currentTaskId,
    },
  };

  // 2. Remove the deleted task IDs from each affected project's taskIds/backlogTaskIds
  const projectUpdates: Update<Project>[] = projectIds
    .filter((pid) => !!state[PROJECT_FEATURE_NAME].entities[pid])
    .map((pid) => {
      const project = state[PROJECT_FEATURE_NAME].entities[pid] as Project;
      return {
        id: pid,
        changes: {
          taskIds: removeTasksFromList(project.taskIds, allIds),
          backlogTaskIds: removeTasksFromList(project.backlogTaskIds, allIds),
        },
      };
    });

  if (projectUpdates.length > 0) {
    updatedState = {
      ...updatedState,
      [PROJECT_FEATURE_NAME]: projectAdapter.updateMany(
        projectUpdates,
        updatedState[PROJECT_FEATURE_NAME],
      ),
    };
  }

  // 3. Remove the deleted task IDs from any tag that referenced them (incl. TODAY_TAG)
  const allIdsSet = new Set(allIds);
  const affectedTagIds = (state[TAG_FEATURE_NAME].ids as string[]).filter((tagId) => {
    const tag = state[TAG_FEATURE_NAME].entities[tagId];
    if (!tag) return false;
    return tag.taskIds.some((taskId) => allIdsSet.has(taskId));
  });

  if (affectedTagIds.length > 0) {
    const tagUpdates: Update<Tag>[] = affectedTagIds.map((tagId) => {
      const tag = state[TAG_FEATURE_NAME].entities[tagId] as Tag;
      return {
        id: tagId,
        changes: {
          taskIds: removeTasksFromList(tag.taskIds, allIds),
        },
      };
    });
    updatedState = updateTags(updatedState, tagUpdates);
  }

  OpLog.log('sectionSharedMetaReducer: cascaded section deletion', {
    sectionId,
    deletedTaskIds: allIds,
  });

  return updatedState;
};

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [deleteSection.type]: () => {
    const { id } = action as ReturnType<typeof deleteSection>;
    return handleDeleteSection(state, id);
  },
});

export const sectionSharedMetaReducer: MetaReducer = (
  reducer: ActionReducer<any, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state, action);

    const rootState = state as RootState;
    const handlers = createActionHandlers(rootState, action);
    const handler = handlers[action.type];
    const updatedState = handler ? handler(rootState) : rootState;

    return reducer(updatedState, action);
  };
};
