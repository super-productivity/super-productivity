import { WorklogTask } from '../../tasks/task.model';

export interface WorklogProjectTotal {
  // null: tasks without a project (an unknown project id is counted here too)
  projectId: string | null;
  title?: string;
  timeSpent: number;
  // fraction of all time in the list, 0..1
  share: number;
}

/**
 * Sums tracked time per project for a worklog task list. The caller limits
 * `timeSpentOnDay` to the wanted range (`getTaskListForRange$` with
 * `isFilterOutTimeSpentOnOtherDays`). Like the export's date grouping, a parent
 * with subtasks is skipped: its time is the sum of its subtasks. A subtask
 * counts for its parent's project when the parent is in the list.
 */
export const getProjectTotals = (
  tasks: WorklogTask[],
  projects: { id: string; title: string }[],
): WorklogProjectTotal[] => {
  const titleById = new Map(projects.map((p) => [p.id, p.title]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const msByProject = new Map<string | null, number>();
  let total = 0;

  for (const task of tasks) {
    if (task.subTaskIds?.length || !task.timeSpentOnDay) {
      continue;
    }
    const timeSpent = Object.values(task.timeSpentOnDay).reduce((a, b) => a + b, 0);
    if (!(timeSpent > 0)) {
      continue;
    }
    // History assigns a subtask to its parent's project; do the same here
    const parent = task.parentId ? taskById.get(task.parentId) : undefined;
    const rawProjectId = parent ? parent.projectId : task.projectId;
    const projectId = rawProjectId && titleById.has(rawProjectId) ? rawProjectId : null;
    msByProject.set(projectId, (msByProject.get(projectId) ?? 0) + timeSpent);
    total += timeSpent;
  }

  return [...msByProject.entries()]
    .map(([projectId, timeSpent]) => ({
      projectId,
      title: projectId === null ? undefined : titleById.get(projectId),
      timeSpent,
      share: timeSpent / total,
    }))
    .sort(
      (a, b) => b.timeSpent - a.timeSpent || (a.title ?? '').localeCompare(b.title ?? ''),
    );
};
