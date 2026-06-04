import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { TaskRepeatCfg, toSyncSafeQuickSetting } from '../task-repeat-cfg.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

// Forward/mobile-compat clamp. The op-log replays the action *payload* (not the
// reduced state — see operation-capture.service.ts), so a reducer-level clamp
// would not keep an out-of-union quickSetting off the wire. Clamping in the
// action creators is the single boundary that does: every dispatcher (dialog,
// add-task-bar, future @+/REST paths) emits a payload old/mobile clients can
// typia-validate. The rich literal (incl. 'RRULE' / newer presets) stays in the
// dialog form only. Only touch a defined quickSetting, never invent one.
const _toPersistedCfg = (cfg: TaskRepeatCfg): TaskRepeatCfg => {
  if (!cfg.quickSetting) return cfg;
  const safe = toSyncSafeQuickSetting(cfg.quickSetting);
  return safe === cfg.quickSetting ? cfg : { ...cfg, quickSetting: safe };
};

const _toPersistedChanges = (changes: Partial<TaskRepeatCfg>): Partial<TaskRepeatCfg> => {
  if (!changes.quickSetting) return changes;
  const safe = toSyncSafeQuickSetting(changes.quickSetting);
  return safe === changes.quickSetting ? changes : { ...changes, quickSetting: safe };
};

export const addTaskRepeatCfgToTask = createAction(
  '[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task',
  (cfgProps: {
    taskId: string;
    taskRepeatCfg: TaskRepeatCfg;
    startTime?: string;
    remindAt?: string;
  }) => ({
    ...cfgProps,
    taskRepeatCfg: _toPersistedCfg(cfgProps.taskRepeatCfg),
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
    taskRepeatCfg: {
      ...cfgProps.taskRepeatCfg,
      changes: _toPersistedChanges(cfgProps.taskRepeatCfg.changes),
    },
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
    changes: _toPersistedChanges(cfgProps.changes),
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
