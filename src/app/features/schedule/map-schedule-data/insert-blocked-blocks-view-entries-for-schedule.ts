import {
  BlockedBlock,
  SVE,
  SVERepeatProjection,
  SVERepeatProjectionSplitContinued,
  SVESplitTaskContinued,
  SVESplitTaskStart,
} from '../../schedule/schedule.model';
import { formatDate } from '../../../util/format-date';
import { TaskCopy, TaskWithoutReminder } from '../../tasks/task.model';
import { SVEType } from '../../schedule/schedule.const';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import {
  isContinuedTaskType,
  isFlowableEntryVE,
  isTaskDataType,
} from './is-schedule-types-type';
import { createViewEntriesForBlock } from './create-view-entries-for-block';

// const debug = (...args: any): void => Log.log(...args);
const debug = (...args: any): void => undefined;

export const insertBlockedBlocksViewEntriesForSchedule = (
  // viewEntriesIn: SVETask[],
  viewEntriesIn: SVE[],
  blockedBlocks: BlockedBlock[],
  dayDate: string,
): void => {
  const viewEntries: SVE[] = viewEntriesIn;
  let veIndex: number = 0;
  debug('################__insertBlockedBlocksViewEntries()_START__################');
  debug(blockedBlocks.length + ' BLOCKS');
  debug('viewEntriesIn', JSON.parse(JSON.stringify(viewEntriesIn)));

  blockedBlocks.forEach((blockedBlock, blockIndex) => {
    debug(`**********BB:${blockIndex}***********`);

    const viewEntriesToAddForBB: SVE[] = createViewEntriesForBlock(blockedBlock, dayDate);

    if (veIndex > viewEntries.length) {
      throw new Error('INDEX TOO LARGE');
    }
    // we don't have any tasks to split anymore, so we just insert
    if (veIndex === viewEntries.length) {
      debug('JUST INSERT since no entries after');
      viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
      // skip to end of added entries
      veIndex += viewEntriesToAddForBB.length;
    }

    for (; veIndex < viewEntries.length; ) {
      const viewEntry = viewEntries[veIndex];
      debug(`------------ve:${veIndex}-------------`);
      debug(
        {
          BIndex: blockIndex,
          BStart: formatDate(new Date(blockedBlock.start), 'DD/MM H:mm'),
          BEnd: formatDate(new Date(blockedBlock.end), 'DD/MM H:mm'),
          BTypes: blockedBlock.entries.map((v) => v.type).join(', '),
          blockedBlock,
          viewEntriesToAddForBB,
        },
        {
          veIndex,
          veStart: formatDate(new Date(viewEntry.start), 'DD/MM H:mm'),
          viewEntry,
        },
        { viewEntriesLength: viewEntries.length },
        {
          viewEntries,
        },
      );
      debug(viewEntry.type + ': ' + (viewEntry as any)?.data?.title);

      // block before all tasks
      // => just insert
      if (blockedBlock.end <= viewEntry.start) {
        viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
        veIndex += viewEntriesToAddForBB.length;
        debug('AAA insert blocked block and skip index to after added entries');
        break;
      }
      // block starts before task and lasts until after it starts
      // => move all following
      else if (blockedBlock.start <= viewEntry.start) {
        const currentListTaskStart = viewEntry.start;
        moveEntries(viewEntries, blockedBlock.end - currentListTaskStart, veIndex);
        viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
        veIndex += viewEntriesToAddForBB.length;
        debug('BBB insert and move all following entries');
        break;
      } else {
        const timeLeft = viewEntry.duration;
        const veEnd = viewEntry.start + viewEntry.duration;
        debug(blockedBlock.start < veEnd, blockedBlock.start, veEnd);

        // NOTE: blockedBlock.start > viewEntry.start is implicated by above checks
        // if (blockedBlock.start > viewEntry.start && blockedBlock.start < veEnd) {
        if (blockedBlock.start < veEnd) {
          debug('CCC split');
          debug('SPLIT', viewEntry.type, '---', (viewEntry as any)?.data?.title);

          if (isTaskDataType(viewEntry)) {
            debug('CCC a) ' + viewEntry.type);

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
            debug('CCC b) ' + viewEntry.type);
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
            debug('CCC C) ' + viewEntry.type);
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
            debug('CCC D) ' + viewEntry.type);
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
          debug('DDD', veIndex, viewEntries.length, viewEntries[veIndex]);
          viewEntries.splice(veIndex, 0, ...viewEntriesToAddForBB);
          veIndex += viewEntriesToAddForBB.length + 1;
        } else {
          debug(
            'EEEE insert, since entry ends before blocked block',
            veIndex,
            viewEntries.length,
            viewEntries[veIndex],
          );
          veIndex++;
        }
      }
    }
  });
  debug('################__insertBlockedBlocksViewEntries()_END__#################');
};

const moveAllEntriesAfterTime = (
  viewEntries: SVE[],
  moveBy: number,
  startTime: number = 0,
): void => {
  viewEntries.forEach((viewEntry: any) => {
    if (viewEntry.start >= startTime && isFlowableEntryVE(viewEntry)) {
      debug(
        'MOVE_ENTRY2',
        viewEntry.data?.title,
        formatDate(new Date(viewEntry.start), 'DD/MM H:mm'),
        formatDate(new Date(viewEntry.start + moveBy), 'DD/MM H:mm'),
      );
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
      debug(
        i,
        'MOVE_ENTRY',
        viewEntry.data?.title,
        formatDate(new Date(viewEntry.start), 'DD/MM H:mm'),
        formatDate(new Date(viewEntry.start + moveBy), 'DD/MM H:mm'),
      );
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
}: {
  start: number;
  dayDate: string;
  taskRepeatCfg: TaskRepeatCfg;
  splitIndex: number;
  duration: number;
}): SVERepeatProjectionSplitContinued => {
  return {
    id: `${taskRepeatCfg.id}_${dayDate}_${splitIndex}`,
    start,
    type: SVEType.RepeatProjectionSplitContinuedLast,
    duration: duration,
    splitIndex,
    data: taskRepeatCfg,
    plannedForDay: dayDate,
  };
};
