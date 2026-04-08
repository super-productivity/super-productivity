import { TaskWithDueTime } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import {
  BlockedBlockByDayMap,
  BlockedBlockEntry,
  BlockedBlockType,
  ScheduleCalendarMapEntry,
  ScheduleLunchBreakCfg,
  ScheduleWorkStartEndCfg,
} from '../schedule.model';
import { createSortedBlockerBlocks } from './create-sorted-blocker-blocks';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getDiffInDays } from '../../../util/get-diff-in-days';

// TODO improve to even better algo for createSortedBlockerBlocks
const NR_OF_DAYS = 10;

export const createBlockedBlocksByDayMap = (
  scheduledTasks: TaskWithDueTime[],
  scheduledTaskRepeatCfgs: TaskRepeatCfg[],
  icalEventMap: ScheduleCalendarMapEntry[],
  workStartEndCfg?: ScheduleWorkStartEndCfg,
  lunchBreakCfg?: ScheduleLunchBreakCfg,
  now?: number,
  nrOfDays: number = NR_OF_DAYS,
  realNow?: number,
): BlockedBlockByDayMap => {
  const allBlockedBlocks = createSortedBlockerBlocks(
    scheduledTasks,
    scheduledTaskRepeatCfgs,
    icalEventMap,
    workStartEndCfg,
    lunchBreakCfg,
    now,
    nrOfDays,
    realNow,
  );
  // Log.log(allBlockedBlocks);

  const blockedBlocksByDay: BlockedBlockByDayMap = {};

  allBlockedBlocks.forEach((block) => {
    const dayStartDateStr = getDbDateStr(block.start);
    const startDayEndBoundaryTs = new Date(block.start).setHours(24, 0, 0, 0);

    if (!blockedBlocksByDay[dayStartDateStr]) {
      blockedBlocksByDay[dayStartDateStr] = [];
    }
    const nrOfExtraDaysToSpawn = getDiffInDays(
      new Date(block.start),
      new Date(block.end),
    );

    const splitEntriesBlockStart = createEntriesForDay(
      block.entries,
      startDayEndBoundaryTs,
    );

    // cut off block to fit into dayEND boundary
    blockedBlocksByDay[dayStartDateStr].push({
      ...block,
      end: Math.min(startDayEndBoundaryTs, block.end),
      entries: splitEntriesBlockStart.entriesBeforeEnd,
    });

    // spawn an extra day if needed
    if (nrOfExtraDaysToSpawn > 0) {
      let entriesForNextDay: BlockedBlockEntry[] = splitEntriesBlockStart.entriesAfterEnd;
      for (let i = 0; i < nrOfExtraDaysToSpawn; i++) {
        const curDateTs = new Date(block.start).setDate(
          new Date(block.start).getDate() + i + 1,
        );
        const dayStr = getDbDateStr(curDateTs);
        const dayStartBoundaryTs = new Date(curDateTs).setHours(0, 0, 0, 0);
        const dayEndBoundaryTs = new Date(curDateTs).setHours(24, 0, 0, 0);

        if (!blockedBlocksByDay[dayStr]) {
          blockedBlocksByDay[dayStr] = [];
        }
        const { entriesBeforeEnd, entriesAfterEnd } = createEntriesForDay(
          entriesForNextDay,
          dayEndBoundaryTs,
        );
        entriesForNextDay = entriesAfterEnd;
        blockedBlocksByDay[dayStr].push({
          ...block,
          entries: entriesBeforeEnd,
          start: dayStartBoundaryTs,
          end: Math.min(dayEndBoundaryTs, block.end),
        });
      }
    }
  });

  return blockedBlocksByDay;
};
const createEntriesForDay = (
  entries: BlockedBlockEntry[],
  dayEnd: number,
): {
  entriesBeforeEnd: BlockedBlockEntry[];
  entriesAfterEnd: BlockedBlockEntry[];
} => {
  const entriesBeforeEnd: BlockedBlockEntry[] = [];
  const entriesAfterEnd: BlockedBlockEntry[] = [];

  entries.forEach((entry) => {
    if (entry.start < dayEnd && entry.end > dayEnd) {
      if (entry.type === 'WorkdayStartEnd') {
        entriesBeforeEnd.push(entry);
        entriesAfterEnd.push(entry);
      } else if (entry.type === 'LunchBreak') {
        throw new Error('Lunch breaks should never span into next day');
      } else {
        const { before, after } = splitEntry(entry, dayEnd);
        entriesBeforeEnd.push(before);
        entriesAfterEnd.push(after);
      }
    } else if (entry.start < dayEnd) {
      entriesBeforeEnd.push(entry);
    } else {
      entriesAfterEnd.push(entry);
    }
  });

  return { entriesBeforeEnd, entriesAfterEnd };
};

// TODO maybe create a split scheduled type
const splitEntry = (
  entry: BlockedBlockEntry,
  splitAt: number,
): { before: BlockedBlockEntry; after: BlockedBlockEntry } => {
  const afterType = (() => {
    switch (entry.type) {
      case BlockedBlockType.WorkdayStartEnd:
        return BlockedBlockType.WorkdayStartEnd;
      case BlockedBlockType.ScheduledTask:
      case BlockedBlockType.ScheduledTaskSplit:
        return BlockedBlockType.ScheduledTaskSplit;
      case BlockedBlockType.ScheduledRepeatProjection:
      case BlockedBlockType.ScheduledRepeatProjectionSplit:
        return BlockedBlockType.ScheduledRepeatProjectionSplit;
      case BlockedBlockType.CalendarEvent:
        return BlockedBlockType.CalendarEvent;
      default: {
        throw new Error('Unknown entry type');
      }
    }
  })();
  return {
    before: {
      ...entry,
      end: splitAt,
    },
    after: {
      ...entry,
      start: splitAt,
      type: afterType,
    } as BlockedBlockEntry,
  };
};
