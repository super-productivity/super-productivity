import { TaskRepeatCfg } from './task-repeat-cfg.model';

/**
 * Whether the recurring task dialog offers "Separate task" for this day:
 * only a future day of a series that does not repeat from its completion date.
 * Mirrors `canDetachInstance` there, for hints that point to that button.
 */
export const isRepeatPreviewSeparable = (
  cfg: Pick<TaskRepeatCfg, 'repeatFromCompletionDate'>,
  targetDate: string | undefined,
  todayStr: string,
): boolean => !cfg.repeatFromCompletionDate && !!targetDate && targetDate > todayStr;
