import { Task } from '../task.model';

export const isScheduledTask = (task: Task): boolean =>
  task.dueWithTime != null || !!task.dueDay || task.remindAt != null || !!task.reminderId;

export const canConvertTaskToSubTask = (task: Task): boolean =>
  !task.parentId &&
  (task.subTaskIds?.length ?? 0) === 0 &&
  !task.repeatCfgId &&
  !task.issueId &&
  !task.issueProviderId &&
  !task.issueType &&
  !isScheduledTask(task);

export const canShowEmptySubTaskDropTarget = (
  targetParent: Task,
  activeTask: Task | null,
  isInSubTaskList: boolean,
): boolean => {
  if (
    isInSubTaskList ||
    !activeTask ||
    !!targetParent.parentId ||
    targetParent.id === activeTask.id ||
    (targetParent.subTaskIds?.length ?? 0) > 0
  ) {
    return false;
  }

  return (
    canConvertTaskToSubTask(activeTask) ||
    (!!activeTask.parentId && activeTask.parentId !== targetParent.id)
  );
};
