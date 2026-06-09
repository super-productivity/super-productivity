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
//
// Same boundary guards the monthly anchors: released clients typia-validate
// monthlyWeekOfMonth against 1|2|3|4|-1 and monthlyWeekday against 0..6
// (absent allowed). A `null` or out-of-union number leaking in from an
// untyped path (formly model, import, a converter bug) must never reach the
// wire — it would trip old clients' validation/repair flow. Normalize to
// `undefined`, which JSON.stringify drops.
const _isValidWeekOfMonth = (v: unknown): boolean =>
  v === -1 || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4);
const _isValidWeekday = (v: unknown): boolean =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6;

const _sanitizeAnchors = <T extends Partial<TaskRepeatCfg>>(cfg: T): T => {
  const w = cfg.monthlyWeekOfMonth as unknown;
  const d = cfg.monthlyWeekday as unknown;
  const wBad = w !== undefined && !_isValidWeekOfMonth(w);
  const dBad = d !== undefined && !_isValidWeekday(d);
  if (!wBad && !dBad) return cfg;
  return {
    ...cfg,
    ...(wBad ? { monthlyWeekOfMonth: undefined } : {}),
    ...(dBad ? { monthlyWeekday: undefined } : {}),
  };
};

// One persist-boundary transform for full cfgs and partial Update changes —
// two copies of this body would inevitably drift.
const _toPersisted = <T extends Partial<TaskRepeatCfg>>(cfg: T): T => {
  const out = _sanitizeAnchors(cfg);
  if (!out.quickSetting) return out;
  const safe = toSyncSafeQuickSetting(out.quickSetting);
  return safe === out.quickSetting ? out : { ...out, quickSetting: safe };
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
    taskRepeatCfg: _toPersisted(cfgProps.taskRepeatCfg),
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
      changes: _toPersisted(cfgProps.taskRepeatCfg.changes),
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
    changes: _toPersisted(cfgProps.changes),
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
