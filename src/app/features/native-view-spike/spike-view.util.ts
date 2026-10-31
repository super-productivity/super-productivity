// SPIKE: throwaway, do not merge
import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards/boards.model';
import { IMPORTANT_TAG, IN_PROGRESS_TAG, TODAY_TAG, URGENT_TAG } from '../tag/tag.const';
import { WorkContextType } from '../work-context/work-context.model';
import { TaskCopy } from '../tasks/task.model';
import { Project } from '../project/project.model';
import { SpikeColumn } from './spike-view.model';

// The spec names SP's built-in board tags by alias; the device resolves the id.
const TAG_ALIASES = new Map<string, string>([
  ['@doing', IN_PROGRESS_TAG.id],
  ['@urgent', URGENT_TAG.id],
  ['@important', IMPORTANT_TAG.id],
]);

const resolveTag = (name: string): string => TAG_ALIASES.get(name) ?? name;

export interface SpikeScope {
  projectIds: string[];
  tagIds: string[];
}

/** TODAY is virtual (never in task.tagIds), so it cannot scope a board by tag. */
export const scopeOfContext = (type: WorkContextType, id: string): SpikeScope => {
  if (type === WorkContextType.PROJECT) return { projectIds: [id], tagIds: [] };
  if (id === TODAY_TAG.id) return { projectIds: [''], tagIds: [] };
  return { projectIds: [''], tagIds: [id] };
};

const doneState = (isDone?: boolean): BoardPanelCfgTaskDoneState =>
  isDone === undefined
    ? BoardPanelCfgTaskDoneState.All
    : isDone
      ? BoardPanelCfgTaskDoneState.Done
      : BoardPanelCfgTaskDoneState.UnDone;

/** Panel ids are namespaced so they never collide with the user's real boards. */
export const columnsToBoardCfg = (
  componentId: string,
  title: string,
  columns: SpikeColumn[],
  scope: SpikeScope,
): BoardCfg => ({
  id: `spike:${componentId}`,
  title,
  cols: columns.length,
  panels: columns.map(
    (col): BoardPanelCfg => ({
      id: `spike:${componentId}:${col.id}`,
      title: col.title,
      taskIds: [],
      includedTagIds: [...scope.tagIds, ...(col.tags ?? []).map(resolveTag)],
      excludedTagIds: (col.notTags ?? []).map(resolveTag),
      taskDoneState: doneState(col.isDone),
      scheduledState: BoardPanelCfgScheduledState.All,
      backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
      isParentTasksOnly: false,
      projectIds: scope.projectIds,
    }),
  ),
});

// A parent's estimate already sums its subtasks, so it is used as is.
const remainingOf = (t: TaskCopy): number =>
  t.subTaskIds?.length ? t.timeEstimate : Math.max(0, t.timeEstimate - t.timeSpent);

export const remainingMs = (dueToday: readonly TaskCopy[]): number =>
  dueToday.filter((t) => !t.isDone).reduce((sum, t) => sum + remainingOf(t), 0);

export interface TimePerProject {
  labels: string[];
  hours: number[];
  colors: string[];
}

/** Leaf tasks only: a parent's timeSpentOnDay already contains its subtasks. */
export const timePerProject = (
  tasks: readonly TaskCopy[],
  projects: readonly Project[],
  dayStrs: readonly string[],
): TimePerProject => {
  const msByProject = new Map<string, number>();
  for (const task of tasks) {
    if (task.subTaskIds?.length) continue;
    const ms = dayStrs.reduce((sum, d) => sum + (task.timeSpentOnDay?.[d] ?? 0), 0);
    if (ms) msByProject.set(task.projectId, (msByProject.get(task.projectId) ?? 0) + ms);
  }
  const rows = projects
    .filter((p) => msByProject.has(p.id))
    .map((p) => ({
      label: p.title,
      color: p.theme?.primary ?? '#888888',
      hours: Math.round(((msByProject.get(p.id) as number) / 3_600_000) * 100) / 100,
    }));
  return {
    labels: rows.map((r) => r.label),
    hours: rows.map((r) => r.hours),
    colors: rows.map((r) => r.color),
  };
};
