import { getDbDateStr } from '../../../util/get-db-date-str';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';
import { getNextRepeatOccurrence } from './get-next-repeat-occurrence.util';

// The next occurrence task creation would actually produce: it passes over
// skipped instances (deletedInstanceDates), so the preview must too.
// Monthly and yearly only move past a period's anchor once lastTaskCreationDay
// reaches it, so that is what each step advances. The start date is pinned
// because repeatFromCompletionDate would otherwise re-anchor on the skipped day.
export const getNextCreatedOccurrence = (
  cfg: TaskRepeatCfg,
  fromDate: Date,
): Date | null => {
  const skipped = cfg.deletedInstanceDates ?? [];
  const anchored: TaskRepeatCfg = {
    ...cfg,
    startDate: getEffectiveRepeatStartDate(cfg),
    repeatFromCompletionDate: false,
  };
  let next = getNextRepeatOccurrence(cfg, fromDate);
  for (
    let i = 0;
    next && i < skipped.length && skipped.includes(getDbDateStr(next));
    i++
  ) {
    next = getNextRepeatOccurrence(
      { ...anchored, lastTaskCreationDay: getDbDateStr(next) },
      next,
    );
  }
  return next;
};
