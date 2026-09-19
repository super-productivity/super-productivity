import {
  BlockedBlock,
  SVE,
  SVERepeatProjection,
  SVERepeatProjectionSplitContinued,
  SVESplitTaskContinued,
  SVESplitTaskStart,
} from '../../schedule/schedule.model';
import { TaskCopy, TaskWithoutReminder } from '../../tasks/task.model';
import { SVEType } from '../../schedule/schedule.const';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import {
  isContinuedTaskType,
  isFlowableEntryVE,
  isTaskDataType,
} from './is-schedule-types-type';
import { createViewEntriesForBlock } from './create-view-entries-for-block';

export const insertBlockedBlocksViewEntriesForSchedule = (
  // viewEntriesIn: SVETask[],
  viewEntriesIn: SVE[],
  blockedBlocks: BlockedBlock[],
  dayDate: string,
): void => {
  const viewEntries: SVE[] = viewEntriesIn;
  let veIndex: number = 0;

  blockedBlocks.forEach((blockedBlock) => {
    const viewEntriesToAddForBB: SVE[] = createViewEntriesForBlock(blockedBlock, dayDate);

    if (veIndex > viewEntries.length) {
      throw new Error('INDEX TOO LARGE');
    }
    // we don't have any tasks to split anymore, so we just insert
    if (veIndex === viewEntries.length) {
      viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
      // skip to end of added entries
      veIndex += viewEntriesToAddForBB.length;
    }

    for (; veIndex < viewEntries.length; ) {
      const viewEntry = viewEntries[veIndex];

      // block before all tasks
      // => just insert
      if (blockedBlock.end <= viewEntry.start) {
        viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
        veIndex += viewEntriesToAddForBB.length;
        break;
      }
      // block starts before task and lasts until after it starts
      // => move all following
      else if (blockedBlock.start <= viewEntry.start) {
        const currentListTaskStart = viewEntry.start;
        moveEntries(viewEntries, blockedBlock.end - currentListTaskStart, veIndex);
        viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
        veIndex += viewEntriesToAddForBB.length;
        break;
      } else {
        const timeLeft = viewEntry.duration;
        const veEnd = viewEntry.start + viewEntry.duration;

        // NOTE: blockedBlock.start > viewEntry.start is implicated by above checks
        // if (blockedBlock.start > viewEntry.start && blockedBlock.start < veEnd) {
        if (blockedBlock.start < veEnd) {
          if (isTaskDataType(viewEntry)) {
            const currentVE: SVESplitTaskStart =
              viewEntry as unknown as SVESplitTaskStart;
            const timeLeftOnTask = timeLeft;
            const timePlannedForSplitStart = blockedBlock.start - currentVE.start;
            const timePlannedForSplitContinued =
              timeLeftOnTask - timePlannedForSplitStart;
            currentVE.duration = timePlannedForSplitStart;

            const splitTask: TaskWithoutReminder = currentVE.data as TaskWithoutReminder;

            // update type of current
            currentVE.type = SVEType.SplitTask;

            const newSplitContinuedEntry: SVE = createSplitTask({
              start: blockedBlock.end,
              dayDate,
              task: splitTask,
              duration: timePlannedForSplitContinued,
              splitIndex: 0,
            });

            // move entries
            const blockedBlockDuration = blockedBlock.end - blockedBlock.start;
            moveEntries(viewEntries, blockedBlockDuration, veIndex + 1);

            // insert new entries
            viewEntries.splice(
              veIndex,
              0,
              ...viewEntriesToAddForBB,
              newSplitContinuedEntry,
            );
            // NOTE: we're not including a step for the current viewEntry as it might be split again
            veIndex += viewEntriesToAddForBB.length;
            break;
          } else if (isContinuedTaskType(viewEntry)) {
            const currentVE: SVESplitTaskContinued = viewEntry as any;
            const timeLeftForCompleteSplitTask = timeLeft;
            const timePlannedForSplitTaskBefore = blockedBlock.start - currentVE.start;
            const timePlannedForSplitTaskContinued =
              timeLeftForCompleteSplitTask - timePlannedForSplitTaskBefore;

            const splitInstances = viewEntries.filter(
              (entry) =>
                (entry.type === SVEType.SplitTaskContinuedLast ||
                  entry.type === SVEType.SplitTaskContinued) &&
                entry.data.id === currentVE.data.id,
            );
            // update type of current
            currentVE.type = SVEType.SplitTaskContinued;
            currentVE.duration -= timePlannedForSplitTaskContinued;

            const splitIndex = splitInstances.length;
            const newSplitContinuedEntry: SVE = createSplitTask({
              start: blockedBlock.end,
              task: currentVE.data,
              dayDate,
              duration: timePlannedForSplitTaskContinued,
              splitIndex,
            });

            // move entries
            // NOTE: Use time-based movement (not index-based) because earlier
            // splice() operations can scatter split-continued entries
            // non-contiguously in the array.  Time-based movement correctly
            // shifts all affected entries regardless of their array position.
            const blockedBlockDuration = blockedBlock.end - blockedBlock.start;
            moveAllEntriesAfterTime(
              viewEntries,
              blockedBlockDuration,
              blockedBlock.start,
            );

            // insert new entries
            viewEntries.splice(
              veIndex,
              0,
              ...viewEntriesToAddForBB,
              newSplitContinuedEntry,
            );
            // NOTE: we're not including a step for the current viewEntry as it might be split again
            veIndex += viewEntriesToAddForBB.length;
            break;
          } else if (
            viewEntry.type === SVEType.RepeatProjection ||
            viewEntry.type === SVEType.RepeatProjectionSplit
          ) {
            const currentVE: SVERepeatProjection = viewEntry as SVERepeatProjection;
            const taskRepeatCfg: TaskRepeatCfg = currentVE.data as TaskRepeatCfg;

            const timeLeftOnRepeatInstance = timeLeft;
            const timePlannedForSplitStart = blockedBlock.start - currentVE.start;
            const timePlannedForSplitContinued =
              timeLeftOnRepeatInstance - timePlannedForSplitStart;
            currentVE.duration = timePlannedForSplitStart;

            // update type of current
            // @ts-ignore
            currentVE.type = SVEType.RepeatProjectionSplit;

            const newSplitContinuedEntry: SVE = createSplitRepeat({
              start: blockedBlock.end,
              dayDate,
              taskRepeatCfg,
              duration: timePlannedForSplitContinued,
              splitIndex: 0,
              sourceOccurrenceDate:
                currentVE.sourceOccurrenceDate ?? currentVE.plannedForDay,
            });

            // move entries
            const blockedBlockDuration = blockedBlock.end - blockedBlock.start;
            moveEntries(viewEntries, blockedBlockDuration, veIndex + 1);

            // insert new entries
            viewEntries.splice(
              veIndex,
              0,
              ...viewEntriesToAddForBB,
              newSplitContinuedEntry,
            );
            // NOTE: we're not including a step for the current viewEntry as it might be split again
            veIndex += viewEntriesToAddForBB.length;
            break;
          } else if (
            viewEntry.type === SVEType.RepeatProjectionSplitContinued ||
            viewEntry.type === SVEType.RepeatProjectionSplitContinuedLast
          ) {
            const currentVE: SVERepeatProjectionSplitContinued =
              viewEntry as SVERepeatProjectionSplitContinued;
            const timeLeftForCompleteSplitRepeatCfgProjection = timeLeft;
            const timePlannedForSplitRepeatCfgProjectionBefore =
              blockedBlock.start - currentVE.start;
            const timePlannedForSplitRepeatCfgProjectionContinued =
              timeLeftForCompleteSplitRepeatCfgProjection -
              timePlannedForSplitRepeatCfgProjectionBefore;

            const splitInstances = viewEntries.filter(
              (entry) =>
                (entry.type === SVEType.RepeatProjectionSplitContinuedLast ||
                  entry.type === SVEType.RepeatProjectionSplitContinued) &&
                entry.data.id === currentVE.data.id,
            );
            // update type of current
            currentVE.type = SVEType.RepeatProjectionSplitContinued;
            currentVE.duration -= timePlannedForSplitRepeatCfgProjectionContinued;

            const splitIndex = splitInstances.length;
            const newSplitContinuedEntry: SVE = createSplitRepeat({
              start: blockedBlock.end,
              dayDate,
              taskRepeatCfg: currentVE.data,
              duration: timePlannedForSplitRepeatCfgProjectionContinued,
              splitIndex,
              sourceOccurrenceDate:
                currentVE.sourceOccurrenceDate ?? currentVE.plannedForDay,
            });

            // move entries
            // NOTE: Use time-based movement (not index-based) because earlier
            // splice() operations can scatter split-continued entries
            // non-contiguously in the array.  Time-based movement correctly
            // shifts all affected entries regardless of their array position.
            const blockedBlockDuration = blockedBlock.end - blockedBlock.start;
            moveAllEntriesAfterTime(
              viewEntries,
              blockedBlockDuration,
              blockedBlock.start,
            );

            // insert new entries
            viewEntries.splice(
              veIndex,
              0,
              ...viewEntriesToAddForBB,
              newSplitContinuedEntry,
            );
            // NOTE: we're not including a step for the current viewEntry as it might be split again
            veIndex += viewEntriesToAddForBB.length;
            break;
          } else {
            throw new Error('Invalid type given ' + viewEntry.type);
          }
        } else if (veIndex + 1 === viewEntries.length) {
          viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
          veIndex += viewEntriesToAddForBB.length + 1;
        } else {
          veIndex++;
        }
      }
    }
  });
};

const moveAllEntriesAfterTime = (
  viewEntries: SVE[],
  moveBy: number,
  startTime: number = 0,
): void => {
  viewEntries.forEach((viewEntry: any) => {
    if (viewEntry.start >= startTime && isFlowableEntryVE(viewEntry)) {
      viewEntry.start = viewEntry.start + moveBy;
    }
  });
};

const moveEntries = (
  viewEntries: SVE[],
  moveBy: number,
  startIndex: number = 0,
): void => {
  for (let i = startIndex; i < viewEntries.length; i++) {
    const viewEntry: any = viewEntries[i];
    if (isFlowableEntryVE(viewEntry)) {
      viewEntry.start = viewEntry.start + moveBy;
    }
  }
};

export const createSplitTask = ({
  start,
  dayDate,
  task,
  splitIndex,
  duration,
}: {
  start: number;
  dayDate: string;
  task: TaskCopy;
  splitIndex: number;
  duration: number;
}): SVESplitTaskContinued => {
  return {
    id: `${task.id}_${dayDate}_${splitIndex}`,
    start,
    type: SVEType.SplitTaskContinuedLast,
    duration,
    data: task,
  };
};

export const createSplitRepeat = ({
  start,
  dayDate,
  taskRepeatCfg,
  splitIndex,
  duration,
  sourceOccurrenceDate,
}: {
  start: number;
  dayDate: string;
  taskRepeatCfg: TaskRepeatCfg;
  splitIndex: number;
  duration: number;
  // the day the occurrence belongs to, which is not dayDate once a segment has
  // been pushed across midnight -- without it a tail resolves to its render day
  sourceOccurrenceDate?: string;
}): SVERepeatProjectionSplitContinued => {
  return {
    id: `${taskRepeatCfg.id}_${dayDate}_${splitIndex}`,
    start,
    type: SVEType.RepeatProjectionSplitContinuedLast,
    duration: duration,
    splitIndex,
    data: taskRepeatCfg,
    plannedForDay: dayDate,
    ...(sourceOccurrenceDate ? { sourceOccurrenceDate } : {}),
  };
};
