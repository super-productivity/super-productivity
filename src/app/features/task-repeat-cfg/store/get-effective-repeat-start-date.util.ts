import { TaskRepeatCfg } from '../task-repeat-cfg.model';

export const getEffectiveRepeatStartDate = (
  cfg: Pick<
    TaskRepeatCfg,
    'repeatFromCompletionDate' | 'lastTaskCreationDay' | 'startDate'
  >,
): string => {
  if (cfg.repeatFromCompletionDate && cfg.lastTaskCreationDay) {
    return cfg.lastTaskCreationDay;
  }

  return cfg.startDate || '1970-01-01';
};
