import { TaskWithDueTime } from '../../tasks/task.model';

import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { devError } from '../../../util/dev-error';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import {
  BlockedBlock,
  BlockedBlockType,
  ScheduleCalendarMapEntry,
  ScheduleLunchBreakCfg,
  ScheduleWorkStartEndCfg,
} from '../schedule.model';
import { selectTaskRepeatCfgsForExactDay } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { isSameDay } from '../../../util/is-same-day';
import { getDbDateStr } from '../../../util/get-db-date-str';
const PROJECTION_DAYS: number = 30;

export const createSortedBlockerBlocks = (
  scheduledTasks: TaskWithDueTime[],
  scheduledTaskRepeatCfgs: TaskRepeatCfg[],
  icalEventMap: ScheduleCalendarMapEntry[],
  workStartEndCfg?: ScheduleWorkStartEndCfg,
  lunchBreakCfg?: ScheduleLunchBreakCfg,
  now: number = Date.now(),
  nrOfDays: number = PROJECTION_DAYS,
  realNow?: number,
): BlockedBlock[] => {
  if (typeof now !== 'number') {
    throw new Error('No valid now given');
  }
  let blockedBlocks: BlockedBlock[] = [
    ...createBlockerBlocksForScheduledTasks(scheduledTasks),
    ...createBlockerBlocksForCalendarEvents(icalEventMap),
    ...createBlockerBlocksForScheduledRepeatProjections(
      now,
      nrOfDays,
      scheduledTaskRepeatCfgs,
      scheduledTasks,
      realNow,
    ),
    ...createBlockerBlocksForWorkStartEnd(now, nrOfDays, workStartEndCfg),
    ...createBlockerBlocksForLunchBreak(now, nrOfDays, lunchBreakCfg),
  ];

  blockedBlocks = mergeBlocksRecursively(blockedBlocks);
  blockedBlocks.sort((a, b) => a.start - b.start);
  // Log.log(
  //   blockedBlocks.map(({ start, end }) => ({
  //     // start,
  //     // end,
  //     s: new Date(start),
  //     e: new Date(end),
  //   })),
  // );
  // Log.log(blockedBlocks);

  return blockedBlocks;
};

const createBlockerBlocksForScheduledRepeatProjections = (
  now: number,
  nrOfDays: number,
  scheduledTaskRepeatCfgs: TaskRepeatCfg[],
  scheduledTasks: TaskWithDueTime[],
  realNow?: number,
): BlockedBlock[] => {
  const blockedBlocks: BlockedBlock[] = [];
  // Days that already have a concrete (timed) instance of a repeat cfg, keyed
  // by `${repeatCfgId}|${dayStr}`. Such days must not also render a projection
  // for the same cfg, or the schedule shows the real task AND its projection
  // (#7853). The today-skip below (i starts at 1) only ever covered today;
  // future-dated instances slipped through whenever the cfg's
  // lastTaskCreationDay lagged behind the instance's day.
  const concreteInstanceDays = new Set<string>();
  scheduledTasks.forEach((task) => {
    if (task.repeatCfgId) {
      concreteInstanceDays.add(`${task.repeatCfgId}|${getDbDateStr(task.dueWithTime)}`);
    }
  });

  const isViewingCurrentDay = realNow === undefined || isSameDay(realNow, now);
  let i: number = isViewingCurrentDay ? 1 : 0;
  while (i < nrOfDays) {
    // Calculate proper day start instead of adding 24-hour increments
    const nowDate = new Date(now);
    const targetDate = new Date(nowDate);
    targetDate.setDate(nowDate.getDate() + i);
    targetDate.setHours(0, 0, 0, 0);
    const currentDayTimestamp = targetDate.getTime();
    const currentDayStr = getDbDateStr(currentDayTimestamp);

    const allRepeatableTasksForDay = selectTaskRepeatCfgsForExactDay.projector(
      scheduledTaskRepeatCfgs,
      {
        dayDate: currentDayTimestamp,
      },
    );
    i++;

    allRepeatableTasksForDay.forEach((repeatCfg) => {
      if (concreteInstanceDays.has(`${repeatCfg.id}|${currentDayStr}`)) {
        return;
      }
      if (!repeatCfg.startTime || !isValidSplitTime(repeatCfg.startTime)) {
        devError('Timeline: Invalid or missing startTime for repeat projection');
        return;
      }
      const start = getDateTimeFromClockString(repeatCfg.startTime, currentDayTimestamp);
      const end = start + (repeatCfg.defaultEstimate || 0);
      blockedBlocks.push({
        start,
        end,
        entries: [
          {
            type: BlockedBlockType.ScheduledRepeatProjection,
            data: repeatCfg,
            start,
            end,
          },
        ],
      });
    });
  }

  return blockedBlocks;
};

const createBlockerBlocksForWorkStartEnd = (
  now: number,
  nrOfDays: number,
  workStartEndCfg?: ScheduleWorkStartEndCfg,
): BlockedBlock[] => {
  const blockedBlocks: BlockedBlock[] = [];

  if (!workStartEndCfg) {
    return blockedBlocks;
  }
  let i: number = 0;
  while (i < nrOfDays) {
    // Calculate proper day start instead of adding 24-hour increments
    const nowDate = new Date(now);
    const currentDate = new Date(nowDate);
    currentDate.setDate(nowDate.getDate() + i);
    currentDate.setHours(0, 0, 0, 0);
    const currentDayTimestamp = currentDate.getTime();

    const nextDate = new Date(nowDate);
    nextDate.setDate(nowDate.getDate() + i + 1);
    nextDate.setHours(0, 0, 0, 0);
    const nextDayTimestamp = nextDate.getTime();

    const start = getDateTimeFromClockString(
      workStartEndCfg.endTime,
      currentDayTimestamp,
    );
    const end = getDateTimeFromClockString(workStartEndCfg.startTime, nextDayTimestamp);
    blockedBlocks.push({
      start,
      end,
      entries: [
        {
          type: BlockedBlockType.WorkdayStartEnd,
          data: workStartEndCfg,
          start,
          end,
        },
      ],
    });
    i++;
  }

  return blockedBlocks;
};

const createBlockerBlocksForLunchBreak = (
  now: number,
  nrOfDays: number,
  lunchBreakCfg?: ScheduleLunchBreakCfg,
): BlockedBlock[] => {
  const blockedBlocks: BlockedBlock[] = [];

  if (!lunchBreakCfg) {
    return blockedBlocks;
  }
  let i: number = 0;
  while (i < nrOfDays) {
    // Calculate proper day start instead of adding 24-hour increments
    const nowDate = new Date(now);
    const targetDate = new Date(nowDate);
    targetDate.setDate(nowDate.getDate() + i);
    targetDate.setHours(0, 0, 0, 0);
    const currentDayTimestamp = targetDate.getTime();

    const start = getDateTimeFromClockString(
      lunchBreakCfg.startTime,
      currentDayTimestamp,
    );
    const end = getDateTimeFromClockString(lunchBreakCfg.endTime, currentDayTimestamp);
    blockedBlocks.push({
      start,
      end,
      entries: [
        {
          type: BlockedBlockType.LunchBreak,
          data: lunchBreakCfg,
          start,
          end,
        },
      ],
    });
    i++;
  }

  return blockedBlocks;
};

const createBlockerBlocksForScheduledTasks = (
  scheduledTasks: TaskWithDueTime[],
): BlockedBlock[] => {
  const blockedBlocks: BlockedBlock[] = [];
  scheduledTasks.forEach((task) => {
    const start = task.dueWithTime;
    // const end = task.due + Math.max(getTimeLeftForTask(task), 1);
    const end = task.dueWithTime + getTimeLeftForTask(task);

    let wasMerged = false;
    for (const blockedBlock of blockedBlocks) {
      if (isOverlappingBlock({ start, end }, blockedBlock)) {
        blockedBlock.start = Math.min(start, blockedBlock.start);
        blockedBlock.end = Math.max(end, blockedBlock.end);
        blockedBlock.entries.push({
          start,
          end,
          type: BlockedBlockType.ScheduledTask,
          data: task,
        });
        wasMerged = true;
        break;
      }
    }

    if (!wasMerged) {
      blockedBlocks.push({
        start,
        end,
        entries: [
          {
            start,
            end,
            type: BlockedBlockType.ScheduledTask,
            data: task,
          },
        ],
      });
    }
  });

  return blockedBlocks;
};

const createBlockerBlocksForCalendarEvents = (
  icalEventMap: ScheduleCalendarMapEntry[],
): BlockedBlock[] => {
  const blockedBlocks: BlockedBlock[] = [];
  icalEventMap.forEach((icalMapEntry) => {
    icalMapEntry.items.forEach((calEv) => {
      // Skip all-day events - they don't block time slots
      if (calEv.isAllDay) {
        return;
      }

      const start = calEv.start;
      const end = calEv.start + calEv.duration;

      let wasMerged = false;
      for (const blockedBlock of blockedBlocks) {
        if (isOverlappingBlock({ start, end }, blockedBlock)) {
          blockedBlock.start = Math.min(start, blockedBlock.start);
          blockedBlock.end = Math.max(end, blockedBlock.end);
          blockedBlock.entries.push({
            start,
            end,
            type: BlockedBlockType.CalendarEvent,
            data: { ...calEv },
          });
          wasMerged = true;
          break;
        }
      }

      if (!wasMerged) {
        blockedBlocks.push({
          start,
          end,
          entries: [
            {
              start,
              end,
              type: BlockedBlockType.CalendarEvent,
              data: { ...calEv },
            },
          ],
        });
      }
    });
  });

  return blockedBlocks;
};

// Merge overlapping blocks using an efficient O(n log n) algorithm
// Sort by start time, then single-pass merge of consecutive overlapping blocks
const mergeBlocksRecursively = (blockedBlocks: BlockedBlock[]): BlockedBlock[] => {
  if (blockedBlocks.length <= 1) {
    return blockedBlocks;
  }

  // Sort by start time
  blockedBlocks.sort((a, b) => a.start - b.start);

  const merged: BlockedBlock[] = [blockedBlocks[0]];

  for (let i = 1; i < blockedBlocks.length; i++) {
    const current = blockedBlocks[i];
    const last = merged[merged.length - 1];

    // Check if current block overlaps or touches the last merged block
    // Two blocks overlap/touch if current.start <= last.end
    if (current.start <= last.end) {
      // Merge: extend end time and combine entries
      last.end = Math.max(last.end, current.end);
      last.entries = last.entries.concat(current.entries);
    } else {
      // No overlap, add as new block
      merged.push(current);
    }
  }

  // Sort entries within each merged block by start time for consistent ordering
  for (const block of merged) {
    block.entries.sort((a, b) => a.start - b.start);
  }

  return merged;
};

const isOverlappingBlock = (
  { start, end }: { start: number; end: number },
  blockedBlock: BlockedBlock,
): boolean => {
  return (
    (start >= blockedBlock.start && start <= blockedBlock.end) || // start is between block
    (end >= blockedBlock.start && end <= blockedBlock.end)
  ); // end is between block;
};
