import {
  addTaskRepeatCfgToTask,
  deleteTaskRepeatCfg,
  deleteTaskRepeatCfgs,
  updateTaskRepeatCfg,
  updateTaskRepeatCfgs,
  upsertTaskRepeatCfg,
  deleteTaskRepeatCfgInstance,
} from './task-repeat-cfg.actions';
import { TaskRepeatCfg, TaskRepeatCfgState } from '../task-repeat-cfg.model';
import { createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { adapter } from './task-repeat-cfg.selectors';

export { TASK_REPEAT_CFG_FEATURE_NAME } from './task-repeat-cfg.selectors';

export const { selectIds, selectEntities, selectAll, selectTotal } =
  adapter.getSelectors();

export const initialTaskRepeatCfgState: TaskRepeatCfgState = adapter.getInitialState({
  // additional entity state properties
});

export const taskRepeatCfgReducer = createReducer<TaskRepeatCfgState>(
  initialTaskRepeatCfgState,

  on(loadAllData, (oldState, { appDataComplete }) =>
    appDataComplete.taskRepeatCfg ? appDataComplete.taskRepeatCfg : oldState,
  ),

  // delete all project tasks from tags on project delete
  on(TaskSharedActions.deleteProject, (state, { projectId }) => {
    const taskRepeatCfgs = state.ids.map((id) => state.entities[id] as TaskRepeatCfg);
    const allCfgIdsForProject = taskRepeatCfgs.filter(
      (cfg) => cfg.projectId === projectId,
    );
    return adapter.removeMany(
      allCfgIdsForProject.map((repeatCfg) => repeatCfg.id),
      state,
    );

    // const cfgsIdsToRemove: string[] = allCfgIdsForProject
    //   .filter((cfg) => !cfg.tagIds || cfg.tagIds.length === 0)
    //   .map((cfg) => cfg.id as string);
    // if (cfgsIdsToRemove.length > 0) {
    //   // this._taskRepeatCfgService.deleteTaskRepeatCfgsNoTaskCleanup(cfgsIdsToRemove);
    //   return adapter.removeMany(cfgsIdsToRemove, state);
    // }

    // const cfgsToUpdate: string[] = allCfgIdsForProject
    //   .filter((cfg) => cfg.tagIds && cfg.tagIds.length > 0)
    //   .map((taskRepeatCfg) => taskRepeatCfg.id as string);
    // if (cfgsToUpdate.length > 0) {
    //   // this._taskRepeatCfgService.updateTaskRepeatCfgs(cfgsToUpdate, { projectId: null });
    // }
  }),
  on(TaskSharedActions.deleteTaskRepeatCfg, (state, { taskRepeatCfgId }) =>
    adapter.removeOne(taskRepeatCfgId, state),
  ),

  // INTERNAL
  on(addTaskRepeatCfgToTask, (state, { taskRepeatCfg }) =>
    adapter.addOne(taskRepeatCfg, state),
  ),
  on(updateTaskRepeatCfg, (state, { taskRepeatCfg }) =>
    adapter.updateOne(taskRepeatCfg, state),
  ),
  on(upsertTaskRepeatCfg, (state, { taskRepeatCfg }) =>
    adapter.upsertOne(taskRepeatCfg, state),
  ),
  on(deleteTaskRepeatCfg, (state, { id }) => adapter.removeOne(id, state)),
  on(deleteTaskRepeatCfgs, (state, { ids }) => adapter.removeMany(ids, state)),
  on(updateTaskRepeatCfgs, (state, { ids, changes }) =>
    adapter.updateMany(
      ids.map((id) => ({
        id,
        changes,
      })),
      state,
    ),
  ),
  on(deleteTaskRepeatCfg, (state, { id }) => adapter.removeOne(id, state)),
  on(deleteTaskRepeatCfgInstance, (state, { repeatCfgId, dateStr }) => {
    const cfg = state.entities[repeatCfgId];
    if (!cfg) return state;

    const deletedDates = cfg.deletedInstanceDates || [];
    if (!deletedDates.includes(dateStr)) {
      return adapter.updateOne(
        {
          id: repeatCfgId,
          changes: {
            deletedInstanceDates: [...deletedDates, dateStr],
          },
        },
        state,
      );
    }
    return state;
  }),
);
