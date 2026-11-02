import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

/** True when `date` falls after the config's inclusive `repeatUntilDay` (#10091). */
export const isAfterRepeatUntilDay = (cfg: TaskRepeatCfg, date: Date): boolean =>
  !!cfg.repeatUntilDay && getDbDateStr(date) > cfg.repeatUntilDay;

/** `date`, or the config's `repeatUntilDay` at noon when `date` is past it. */
export const capDateAtRepeatUntilDay = (cfg: TaskRepeatCfg, date: Date): Date => {
  if (!cfg.repeatUntilDay || !isAfterRepeatUntilDay(cfg, date)) {
    return date;
  }
  const endDay = dateStrToUtcDate(cfg.repeatUntilDay);
  endDay.setHours(12, 0, 0, 0);
  return endDay;
};
