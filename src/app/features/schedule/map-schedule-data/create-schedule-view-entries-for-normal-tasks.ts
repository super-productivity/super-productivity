import {
  TaskWithoutReminder,
  TaskWithPlannedForDayIndication,
} from '../../tasks/task.model';
import { SVETask } from '../schedule.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { SCHEDULE_TASK_MIN_DURATION_IN_MS, SVEType } from '../schedule.const';

export const createScheduleViewEntriesForNormalTasks = (
  startTime: number,
  tasks: (TaskWithoutReminder | TaskWithPlannedForDayIndication)[],
): SVETask[] => {
  let lastTime: number | undefined;
  let prevTask: TaskWithoutReminder;

  const viewEntries: SVETask[] = [];
  tasks.forEach((task, index, arr) => {
    prevTask = arr[index - 1];

    let time: number;

    if (typeof lastTime === 'number') {
      if (prevTask) {
        const prevDuration = prevTask.isDone
          ? prevTask.timeEstimate > 0
            ? prevTask.timeEstimate
            : SCHEDULE_TASK_MIN_DURATION_IN_MS
          : getTimeLeftForTask(prevTask);
        time = lastTime + prevDuration;
      } else {
        throw new Error('Something weird happened');
      }
    } else {
      time = startTime;
    }

    const duration = task.isDone
      ? task.timeEstimate > 0
        ? task.timeEstimate
        : SCHEDULE_TASK_MIN_DURATION_IN_MS
      : getTimeLeftForTask(task);

    viewEntries.push({
      id: task.id,
      type: (task as TaskWithPlannedForDayIndication).plannedForDay
        ? SVEType.TaskPlannedForDay
        : SVEType.Task,
      start: time,
      data: task,
      duration,
    });

    lastTime = time;
  });

  return viewEntries;
};
