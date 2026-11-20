export const TASK_STATUSES = ['open', 'done', 'wont-do'] as const;
export type AssistantTaskStatus = (typeof TASK_STATUSES)[number];

export const getTaskStatus = (task: {
  isDone?: unknown;
  doneOn?: unknown;
  wontDoOn?: unknown;
}): AssistantTaskStatus => {
  if (!task.isDone) return 'open';
  return typeof task.wontDoOn === 'number' && task.wontDoOn === task.doneOn
    ? 'wont-do'
    : 'done';
};

/** Read either historical encoding without rewriting the persisted task. */
export const getTaskPriority = (priority: unknown): 1 | 2 | 3 | null => {
  switch (priority) {
    case 'high':
    case 3:
      return 3;
    case 'medium':
    case 2:
      return 2;
    case 'low':
    case 1:
      return 1;
    default:
      return null;
  }
};
