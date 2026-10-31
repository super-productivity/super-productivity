import type { TaskRepeatCfg, TaskRepeatCfgCopy } from '../task-repeat-cfg.model';
import { getEffectiveLastTaskCreationDay } from '../store/get-effective-last-task-creation-day.util';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

type ResumeFields = Pick<
  TaskRepeatCfgCopy,
  'isPaused' | 'repeatFromCompletionDate' | 'lastTaskCreationDay' | 'lastTaskCreation'
>;

/**
 * Resuming a paused fixed schedule must not add the dates that passed while it
 * was paused: the next creation would otherwise make the newest of them an
 * overdue copy (getNewestPossibleDueDate). So resuming moves the creation
 * cursor to the logical yesterday, in the same update as `isPaused: false`
 * (one intent, one op), and today's occurrence still gets created.
 *
 * The cursor only ever moves forward: moving it back would re-create a copy
 * that was already created and archived or skipped today.
 *
 * Not for after-completion schedules: there the cursor is the anchor the next
 * date is counted from, and moving it would re-phase the series.
 */
export const getResumeCursorChanges = (
  initial: ResumeFields,
  final: Pick<TaskRepeatCfgCopy, 'isPaused' | 'repeatFromCompletionDate'>,
  logicalYesterdayStr: string,
): Pick<TaskRepeatCfgCopy, 'lastTaskCreationDay' | 'lastTaskCreation'> | null => {
  const isResume = initial.isPaused && !final.isPaused;
  if (!isResume || final.repeatFromCompletionDate) {
    return null;
  }
  const cursor = getEffectiveLastTaskCreationDay(initial as TaskRepeatCfg);
  if (cursor && cursor >= logicalYesterdayStr) {
    return null;
  }
  return {
    lastTaskCreationDay: logicalYesterdayStr,
    // noon, like the creation timestamps the engine writes (DST-safe)
    lastTaskCreation: dateStrToUtcDate(logicalYesterdayStr).setHours(12, 0, 0, 0),
  };
};
