import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { RRuleOccurrenceInput } from './rrule-occurrence.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { getRepeatInstanceExceptions } from './get-repeat-instance-exceptions.util';

/**
 * Adapts a `TaskRepeatCfg` to the decoupled RRULE occurrence engine input.
 * Only meaningful when `cfg.rrule` is set; callers guard on that first.
 * Per-instance exceptions map onto RFC 5545 EXDATE (skips + moved-from) and
 * RDATE (moved-to), so a rescheduled occurrence shows at its new day everywhere.
 */
export const taskRepeatCfgToRRuleInput = (cfg: TaskRepeatCfg): RRuleOccurrenceInput => {
  const { exdates, rdates } = getRepeatInstanceExceptions(cfg);
  return {
    rrule: cfg.rrule as string,
    startDate: getEffectiveRepeatStartDate(cfg),
    lastTaskCreationDay: getEffectiveLastTaskCreationDay(cfg) || undefined,
    exdates,
    rdates,
  };
};
