import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const addTaskRepeatCfgToTask = createAction(
  '[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task',
  (cfgProps: {
    taskId: string;
    taskRepeatCfg: TaskRepeatCfg;
    startTime?: string;
    remindAt?: string;
  }) => ({
    ...cfgProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK_REPEAT_CFG',
      entityId: cfgProps.taskRepeatCfg.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const updateTaskRepeatCfg = createAction(
  '[TaskRepeatCfg] Update TaskRepeatCfg',
  (cfgProps: {
    taskRepeatCfg: Update<TaskRepeatCfg>;
    isAskToUpdateAllTaskInstances?: boolean;
  }) => ({
    ...cfgProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK_REPEAT_CFG',
      entityId: cfgProps.taskRepeatCfg.id as string,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const updateTaskRepeatCfgs = createAction(
  '[TaskRepeatCfg] Update multiple TaskRepeatCfgs',
  (cfgProps: { ids: string[]; changes: Partial<TaskRepeatCfg> }) => ({
    ...cfgProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK_REPEAT_CFG',
      entityIds: cfgProps.ids,
      opType: OpType.Update,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

// Upsert is typically used for sync/import, so no persistence metadata
export const upsertTaskRepeatCfg = createAction(
  '[TaskRepeatCfg] Upsert TaskRepeatCfg',
  props<{ taskRepeatCfg: TaskRepeatCfg }>(),
);

export const deleteTaskRepeatCfg = createAction(
  '[TaskRepeatCfg] Delete TaskRepeatCfg',
  (cfgProps: { id: string }) => ({
    ...cfgProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK_REPEAT_CFG',
      entityId: cfgProps.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteTaskRepeatCfgs = createAction(
  '[TaskRepeatCfg] Delete multiple TaskRepeatCfgs',
  (cfgProps: { ids: string[] }) => ({
    ...cfgProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK_REPEAT_CFG',
      entityIds: cfgProps.ids,
      opType: OpType.Delete,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteTaskRepeatCfgInstance = createAction(
  '[TaskRepeatCfg] Delete Single Instance',
  (cfgProps: { repeatCfgId: string; dateStr: string }) => ({
    ...cfgProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK_REPEAT_CFG',
      entityId: cfgProps.repeatCfgId,
      opType: OpType.Update, // Deleting an instance updates the cfg's excluded dates
    } satisfies PersistentActionMeta,
  }),
);
