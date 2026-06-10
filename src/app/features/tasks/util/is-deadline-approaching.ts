import { Task } from '../task.model';
import { isDBDateStr, getDbDateStr } from '../../../util/get-db-date-str';

const APPROACHING_DAYS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dayNumFromDbStr = (dbDateStr: string): number => {
  const [year, month, day] = dbDateStr.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
};

export const isDeadlineApproaching = (task: Task, todayStr: string): boolean => {
  if (task.isDone) return false;

  const todayDayNum = dayNumFromDbStr(todayStr);

  if (task.deadlineWithTime) {
    if (task.deadlineWithTime < Date.now()) return false;
    const deadlineDayNum = dayNumFromDbStr(getDbDateStr(task.deadlineWithTime));
    return deadlineDayNum - todayDayNum <= APPROACHING_DAYS;
  }

  if (task.deadlineDay && isDBDateStr(task.deadlineDay)) {
    if (task.deadlineDay < todayStr) return false;
    const deadlineDayNum = dayNumFromDbStr(task.deadlineDay);
    return deadlineDayNum - todayDayNum <= APPROACHING_DAYS;
  }

  return false;
};
