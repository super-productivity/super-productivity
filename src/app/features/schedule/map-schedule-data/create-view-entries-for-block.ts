import { BlockedBlock, BlockedBlockType, SVE } from '../schedule.model';
import { SVEType } from '../schedule.const';
import { nanoid } from 'nanoid';

export const createViewEntriesForBlock = (
  blockedBlock: BlockedBlock,
  dayDate: string,
): SVE[] => {
  const viewEntriesForBock: SVE[] = [];
  blockedBlock.entries.forEach((entry) => {
    if (entry.type === BlockedBlockType.ScheduledTask) {
      const scheduledTask = entry.data;
      viewEntriesForBock.push({
        // NOTE: first should be unique
        id: scheduledTask.id,
        start: entry.start,
        type: SVEType.ScheduledTask,
        data: scheduledTask,
        duration: entry.end - entry.start,
      });
    } else if (entry.type === BlockedBlockType.ScheduledRepeatProjection) {
      const repeatCfg = entry.data;
      viewEntriesForBock.push({
        id: repeatCfg.id + '_' + dayDate,
        start: entry.start,
        type: SVEType.ScheduledRepeatProjection,
        data: repeatCfg,
        duration: repeatCfg.defaultEstimate || 0,
        plannedForDay: dayDate,
        ...(entry.sourceOccurrenceDate
          ? { sourceOccurrenceDate: entry.sourceOccurrenceDate }
          : {}),
      });
    } else if (entry.type === BlockedBlockType.CalendarEvent) {
      const calendarEvent = entry.data;
      viewEntriesForBock.push({
        id: (calendarEvent.id || nanoid()) + '_' + dayDate,
        start: entry.start,
        type: SVEType.CalendarEvent,
        data: {
          ...calendarEvent,
          icon: 'event',
        },
        duration: calendarEvent.duration,
      });
    } else if (entry.type === BlockedBlockType.LunchBreak) {
      viewEntriesForBock.push({
        id: 'LUNCH_BREAK' + '_' + dayDate,
        start: entry.start,
        type: SVEType.LunchBreak,
        data: entry.data,
        duration: entry.end - entry.start,
      });
    } else if (entry.type === BlockedBlockType.ScheduledTaskSplit) {
      const scheduledTask = entry.data;
      viewEntriesForBock.push({
        id: scheduledTask.id + '_' + dayDate,
        start: entry.start,
        type: SVEType.SplitTaskContinuedLast,
        data: scheduledTask,
        duration: entry.end - entry.start,
      });
    } else if (entry.type === BlockedBlockType.ScheduledRepeatProjectionSplit) {
      const repeatCfg = entry.data;
      viewEntriesForBock.push({
        id: repeatCfg.id + '_' + dayDate,
        splitIndex: 0,
        start: entry.start,
        type: SVEType.RepeatProjectionSplitContinuedLast,
        data: repeatCfg,
        duration: entry.end - entry.start,
        plannedForDay: dayDate,
        ...(entry.sourceOccurrenceDate
          ? { sourceOccurrenceDate: entry.sourceOccurrenceDate }
          : {}),
      });
    }
  });
  viewEntriesForBock.sort((a, b) => a.start - b.start);

  return viewEntriesForBock;
};
