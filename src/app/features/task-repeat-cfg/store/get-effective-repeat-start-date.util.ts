import { TaskRepeatCfg } from '../task-repeat-cfg.model';

export const getEffectiveRepeatStartDate = (cfg: TaskRepeatCfg): string => {
  // After completion the schedule counts from lastTaskCreationDay (the last
  // completion or copy), unless the start date was moved past it (#11266).
  if (
    cfg.repeatFromCompletionDate &&
    cfg.lastTaskCreationDay &&
    (cfg.startDate || '') <= cfg.lastTaskCreationDay
  ) {
    return cfg.lastTaskCreationDay;
  }

  return cfg.startDate || '1970-01-01';
};
