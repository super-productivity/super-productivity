import { TaskRepeatCfg, TaskRepeatCfgCopy } from '../task-repeat-cfg.model';
import { distinctUntilChangedObject } from '../../../util/distinct-until-changed-object';

type RepeatCfgInput = Partial<TaskRepeatCfgCopy> | TaskRepeatCfg;

/**
 * Returns only fields that differ between initial and final.
 * The dialog uses this so the dispatched Update<TaskRepeatCfg> contains
 * actual changes — not every field of the form. Downstream effects
 * (rescheduleTaskOnRepeatCfgUpdate$) filter by `field in changes`, so
 * sending unchanged fields incorrectly triggers rescheduling (issue #7373).
 */
export const getTaskRepeatCfgChanges = (
  initial: RepeatCfgInput,
  final: RepeatCfgInput,
): Partial<TaskRepeatCfgCopy> => {
  const changes: Partial<TaskRepeatCfgCopy> = {};
  const keys = new Set<keyof TaskRepeatCfgCopy>([
    ...(Object.keys(initial) as (keyof TaskRepeatCfgCopy)[]),
    ...(Object.keys(final) as (keyof TaskRepeatCfgCopy)[]),
  ]);
  keys.delete('id');
  for (const key of keys) {
    if (!distinctUntilChangedObject(initial[key], final[key])) {
      (changes as Record<string, unknown>)[key] = final[key];
    }
  }
  return changes;
};
