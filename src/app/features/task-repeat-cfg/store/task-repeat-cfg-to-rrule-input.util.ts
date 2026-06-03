import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { RRuleOccurrenceInput } from './rrule-occurrence.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';

/**
 * Adapts a `TaskRepeatCfg` to the decoupled RRULE occurrence engine input.
 * Only meaningful when `cfg.rrule` is set; callers guard on that first.
 * Skipped instances (`deletedInstanceDates`) map onto RFC 5545 EXDATEs.
 */
export const taskRepeatCfgToRRuleInput = (cfg: TaskRepeatCfg): RRuleOccurrenceInput => ({
  rrule: cfg.rrule as string,
  startDate: getEffectiveRepeatStartDate(cfg),
  lastTaskCreationDay: getEffectiveLastTaskCreationDay(cfg) || undefined,
  exdates: cfg.deletedInstanceDates,
});
