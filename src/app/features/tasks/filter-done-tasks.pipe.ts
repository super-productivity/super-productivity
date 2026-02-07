import { Pipe, PipeTransform } from '@angular/core';
import { TaskWithSubTasks } from './task.model';

export const filterDoneTasks = (
  tasks: TaskWithSubTasks[],
  currentTaskId: string | null,
  isFilterDone: boolean,
  isFilterAll: boolean,
): TaskWithSubTasks[] => {
  return isFilterDone
    ? tasks.filter((task) => !task.isDone)
    : isFilterAll
      ? !!currentTaskId
        ? tasks.filter((task) => task.id === currentTaskId)
        : []
      : tasks;
};

@Pipe({ name: 'filterDoneTasks' })
export class FilterDoneTasksPipe implements PipeTransform {
  transform(
    tasks: TaskWithSubTasks[],
    currentTaskId: string | null,
    isFilterDone: boolean,
    isFilterAll: boolean,
  ): TaskWithSubTasks[] {
    return filterDoneTasks(tasks, currentTaskId, isFilterDone, isFilterAll);
  }
}
