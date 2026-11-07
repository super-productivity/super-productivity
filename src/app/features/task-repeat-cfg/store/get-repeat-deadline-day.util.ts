import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getDiffInDays } from '../../../util/get-diff-in-days';

// Deadline day for the occurrence on `dueStr`, keeping the cfg's due→deadline
export const getRepeatDeadlineDay = (
  cfg: Pick<TaskRepeatCfg, 'deadlineOffsetDays'>,
  dueStr: string,
): string | undefined => {
  const offset = cfg.deadlineOffsetDays;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    return undefined;
  }
  const date = dateStrToUtcDate(dueStr);
  date.setDate(date.getDate() + offset);
  return getDbDateStr(date);
};

export const getDeadlineOffsetDays = (
  startDay: string,
  deadlineDay: string | null | undefined,
): number | undefined => {
  if (!deadlineDay) {
    return undefined;
  }
  const offset = getDiffInDays(dateStrToUtcDate(startDay), dateStrToUtcDate(deadlineDay));
  return offset >= 0 ? offset : undefined;
};
