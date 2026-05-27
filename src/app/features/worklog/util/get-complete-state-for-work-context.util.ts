import { WorkContext, WorkContextType } from '../../work-context/work-context.model';
import { Dictionary, EntityState } from '@ngrx/entity';
import { Task } from '../../tasks/task.model';
import { TODAY_TAG } from '../../tag/tag.const';
import { resolveDisplayTagIds } from '../../tasks/util/resolve-display-tag-ids.util';

export const getCompleteStateForWorkContext = (
  workContext: WorkContext,
  taskState: EntityState<Task>,
  archive: EntityState<Task>,
): {
  completeStateForWorkContext: EntityState<Task>;
  nonArchiveTaskIds: string[];
} => {
  const wid = workContext.id;

  if (wid === TODAY_TAG.id) {
    return {
      completeStateForWorkContext: {
        ids: [...(taskState.ids as string[]), ...(archive.ids as string[])],
        entities: {
          ...archive.entities,
          ...taskState.entities,
        },
      },
      nonArchiveTaskIds: taskState.ids as string[],
    };
  }

  const unarchivedIds: string[] =
    workContext.type === WorkContextType.TAG
      ? _filterIdsForTag(taskState, wid)
      : _filterIdsForProject(taskState, wid);

  const archivedIdsForTag: string[] =
    workContext.type === WorkContextType.TAG
      ? _filterIdsForTag(archive, wid)
      : _filterIdsForProject(archive, wid);

  const unarchivedEntities = _limitStateToIds(taskState, unarchivedIds);
  const archivedEntities = _limitStateToIds(archive, archivedIdsForTag);

  return {
    completeStateForWorkContext: {
      ids: [...unarchivedIds, ...archivedIdsForTag],
      entities: {
        ...unarchivedEntities,
        ...archivedEntities,
      },
    },
    nonArchiveTaskIds: unarchivedIds,
  };
};

const _filterIdsForProject = (
  state: EntityState<Task>,
  workContextId: string,
): string[] =>
  (state.ids as string[]).filter((id) => {
    const t = state.entities[id];
    if (!t) return false;
    if (t.parentId) {
      const parent = state.entities[t.parentId];
      return parent ? parent.projectId === workContextId : t.projectId === workContextId;
    }
    return t.projectId === workContextId;
  });

const _filterIdsForTag = (state: EntityState<Task>, workContextId: string): string[] =>
  (state.ids as string[]).filter((id) => {
    const t = state.entities[id];
    if (!t) return false;
    const parent = t.parentId ? state.entities[t.parentId] : undefined;
    return resolveDisplayTagIds(t, parent).includes(workContextId);
  });

const _limitStateToIds = (
  stateIn: EntityState<Task>,
  ids: string[],
): Dictionary<Task> => {
  const newState: any = {};
  ids.forEach((id) => {
    newState[id] = stateIn.entities[id];
  });
  return newState;

  // NOTE: this might be prettier, but is much much much much slower
  // return ids.reduce((acc, id) => ({
  //   ...acc,
  //   [id]: stateIn.entities[id]
  // }), {});
};
