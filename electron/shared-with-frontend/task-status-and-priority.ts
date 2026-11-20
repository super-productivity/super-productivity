export const TASK_STATUSES = ['open', 'done', 'wont-do'] as const;
export type AssistantTaskStatus = (typeof TASK_STATUSES)[number];

const SUMMARY_FIELDS = [
  'id',
  'title',
  'isDone',
  'projectId',
  'tagIds',
  'parentId',
  'dueDay',
  'dueWithTime',
  'deadlineDay',
  'deadlineWithTime',
  'timeEstimate',
  'timeSpent',
] as const;

/** Shared by the renderer's IPC projection and the main process's response allowlist. */
export const pickTaskSummaryFields = (
  task: Partial<Record<(typeof SUMMARY_FIELDS)[number], unknown>>,
): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  for (const key of SUMMARY_FIELDS) {
    if (task[key] != null) fields[key] = task[key];
  }
  return fields;
};

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
