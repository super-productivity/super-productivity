import { TaskWithoutReminder } from '../../tasks/task.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';

export const getTasksWithinAndBeyondBudget = <T extends TaskWithoutReminder>(
  tasks: T[],
  budget: number,
): {
  beyond: T[];
  within: T[];
  isSomeTimeLeftForLastOverBudget: boolean;
} => {
  const beyond: T[] = [];
  const within: T[] = [];

  let remainingBudget = budget;
  let isOverBudget = false;

  // NOTE: for loops can sometimes be faster than forEach
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (isOverBudget) {
      beyond.push(task);
      continue;
    }

    const timeLeftForTask = getTimeLeftForTask(task);
    if (timeLeftForTask > remainingBudget) {
      isOverBudget = true;
      beyond.push(task);
    } else {
      within.push(task);
      remainingBudget -= timeLeftForTask;
    }
  }

  return { beyond, within, isSomeTimeLeftForLastOverBudget: remainingBudget > 0 };
};
